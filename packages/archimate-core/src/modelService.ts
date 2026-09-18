import { assertAllowed } from "./allowedRelationship";
import { getClassConstraints } from "./classConstraints";
import type { KcClient } from "./kcClient";
import type { SchemaResolver } from "./schema";
import type { ChangeSet, Entity, Statement, StatementValue } from "./types";
import { stringFromValue, stringValuesEqual } from "./propertyEdit";
import { mostSpecificClassLocal } from "./openExchange/typeMap";
import {
  GraphMutationService,
  toStatementValue,
  type ReclassifyEntityResult,
  type StatementValueType,
  type StrictRelationsMode,
} from "./graphMutations";

/** Structural action shape used by create/link (compatible with UI AddActionDef). */
export interface ModelAddAction {
  createsClass: string;
  defaults?: Record<string, string>;
  derivesRelationship?: string;
  relationshipDirection?: "from-selected-to-new" | "from-new-to-selected";
  relationshipDefaults?: Record<string, string>;
}

export interface CreateElementInput {
  packageCode: string;
  name: string;
  /** @deprecated Prefer `descriptions` */
  description?: string;
  descriptions?: Record<string, string>;
  iriLocal?: string;
  action: ModelAddAction;
  /** Selected entity in previous column (context for relationship) */
  selectedId?: string;
  extraProps?: Record<string, string>;
  /** Flow requires flowLabel */
  flowLabel?: string;
}

export interface LinkElementInput {
  packageCode: string;
  action: ModelAddAction;
  existingEntityId: string;
  selectedId?: string;
  extraProps?: Record<string, string>;
  flowLabel?: string;
}

export interface CreateResult {
  entity: Entity;
  relationship?: Entity;
  changeSet: ChangeSet;
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export class ModelService {
  readonly graph: GraphMutationService;

  constructor(
    private kc: KcClient,
    private schema: SchemaResolver,
  ) {
    this.graph = new GraphMutationService(kc, schema);
  }

  /**
   * Create a typed ArchiMate element without an AddActionDef (MCP / simple API).
   * Optional `link` creates a relationship to an existing entity.
   */
  async createTypedElement(opts: {
    packageCode: string;
    classLocal: string;
    name: string;
    descriptions?: Record<string, string>;
    iriLocal?: string;
    extraProps?: Record<string, string>;
    link?: {
      typeLocal: string;
      otherId: string;
      direction: "from-new-to-selected" | "from-selected-to-new";
      props?: Record<string, string>;
    };
  }): Promise<CreateResult> {
    return this.createElement({
      packageCode: opts.packageCode,
      name: opts.name,
      descriptions: opts.descriptions,
      iriLocal: opts.iriLocal,
      extraProps: opts.extraProps,
      selectedId: opts.link?.otherId,
      flowLabel: opts.link?.props?.flowLabel ?? opts.extraProps?.flowLabel,
      action: {
        createsClass: opts.classLocal,
        derivesRelationship: opts.link?.typeLocal,
        relationshipDirection: opts.link?.direction,
        relationshipDefaults: opts.link?.props,
      },
    });
  }

  async createElement(input: CreateElementInput): Promise<CreateResult> {
    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      {
        operationType: "createElement",
        comment: `${input.action.createsClass}: ${input.name}`,
      },
      async () => {
        const snap = this.schema.snapshot;
        const classIri = this.schema.classIri(input.action.createsClass);
        const iriLocal = input.iriLocal || `${slugify(input.name)}-${Date.now().toString(36)}`;

        const descriptions =
          input.descriptions &&
          Object.fromEntries(
            Object.entries(input.descriptions)
              .map(([lang, text]) => [lang.trim().toLowerCase(), text.trim()] as const)
              .filter(([lang, text]) => lang && text),
          );
        const legacyDescription = input.description?.trim();
        const created = await this.kc.createEntity({
          packageCode: input.packageCode,
          labels: { en: input.name, cs: input.name },
          descriptions:
            descriptions && Object.keys(descriptions).length
              ? descriptions
              : legacyDescription
                ? { en: legacyDescription, cs: legacyDescription }
                : undefined,
          iriLocal,
        });
        const entity = created.data;

        await this.kc.createStatement({
          packageCode: input.packageCode,
          subject: entity.id,
          property: snap.instanceOfProperty,
          value: { type: "EntityReference", entityId: classIri },
          upsert: true,
        });

        const relOnly = new Set(["flowLabel", "associationKind"]);
        const props = { ...input.action.defaults, ...input.extraProps };
        for (const [local, value] of Object.entries(props)) {
          if (relOnly.has(local)) continue;
          const propIri = this.schema.tryPropertyIri(local);
          if (!propIri) continue;
          await this.kc.createStatement({
            packageCode: input.packageCode,
            subject: entity.id,
            property: propIri,
            value: { type: "String", string: value },
            upsert: true,
          });
        }

        let relationship: Entity | undefined;
        if (input.action.derivesRelationship && input.selectedId) {
          const relProps: Record<string, string> = {
            ...input.action.relationshipDefaults,
            ...(input.extraProps?.associationKind
              ? { associationKind: input.extraProps.associationKind }
              : {}),
            ...(input.flowLabel ? { flowLabel: input.flowLabel } : {}),
          };
          relationship = await this.createRelationshipInChangeSet({
            packageCode: input.packageCode,
            typeLocal: input.action.derivesRelationship,
            sourceId:
              input.action.relationshipDirection === "from-new-to-selected"
                ? entity.id
                : input.selectedId,
            targetId:
              input.action.relationshipDirection === "from-new-to-selected"
                ? input.selectedId
                : entity.id,
            props: relProps,
            sourceClassLocal: input.action.relationshipDirection === "from-new-to-selected"
              ? input.action.createsClass
              : undefined,
            targetClassLocal: input.action.relationshipDirection === "from-new-to-selected"
              ? undefined
              : input.action.createsClass,
          });
        }

        return { entity, relationship };
      },
    );
    return { ...result, changeSet };
  }

  async linkElement(input: LinkElementInput): Promise<CreateResult> {
    if (!input.action.derivesRelationship) {
      throw new Error("Tato akce neumožňuje připojení existující entity.");
    }
    if (!input.selectedId) {
      throw new Error("Vyberte kontext v předchozím sloupci (položku vlevo).");
    }

    const exists = await this.relationshipExists(
      input.selectedId,
      input.existingEntityId,
      input.action.derivesRelationship,
    );
    if (exists) {
      throw new Error("Vztah mezi vybraným kontextem a touto entitou už existuje.");
    }

    const relProps: Record<string, string> = {
      ...input.action.relationshipDefaults,
      ...(input.extraProps?.associationKind
        ? { associationKind: input.extraProps.associationKind }
        : {}),
      ...(input.flowLabel ? { flowLabel: input.flowLabel } : {}),
    };

    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      {
        operationType: "linkElement",
        comment: `link ${input.action.derivesRelationship}`,
      },
      async () => {
        const entity = await this.kc.getEntity(input.existingEntityId);
        const relationship = await this.createRelationshipInChangeSet({
          packageCode: input.packageCode,
          typeLocal: input.action.derivesRelationship!,
          sourceId:
            input.action.relationshipDirection === "from-new-to-selected"
              ? input.existingEntityId
              : input.selectedId!,
          targetId:
            input.action.relationshipDirection === "from-new-to-selected"
              ? input.selectedId!
              : input.existingEntityId,
          props: relProps,
        });
        return { entity, relationship };
      },
    );
    return { ...result, changeSet };
  }

  private async relationshipExists(
    entityA: string,
    entityB: string,
    typeLocal: string,
  ): Promise<boolean> {
    const snap = this.schema.snapshot;
    const typeIri = this.schema.classIri(typeLocal);

    const checkSide = async (entityId: string, role: "source" | "target") => {
      const prop = role === "source" ? snap.relSource : snap.relTarget;
      const incoming = await this.kc.getIncoming(entityId, prop);
      for (const stmt of incoming.items) {
        const relId = stmt.subject;
        const relEntity = await this.kc.getEntity(relId);
        const classes = relEntity.effectiveClasses || [];
        const isType =
          classes.includes(typeIri) || (await this.entityIsInstanceOf(relId, typeIri));
        if (!isType) continue;

        const stmts = await this.kc.getStatements(relId);
        const src = stmts.items.find((s) => s.property === snap.relSource);
        const tgt = stmts.items.find((s) => s.property === snap.relTarget);
        if (src?.value.type !== "EntityReference" || tgt?.value.type !== "EntityReference") {
          continue;
        }
        const pair = [src.value.entityId, tgt.value.entityId];
        if (pair.includes(entityA) && pair.includes(entityB)) return true;
      }
      return false;
    };

    return (await checkSide(entityA, "source")) || (await checkSide(entityB, "source"));
  }

  private async entityIsInstanceOf(entityId: string, classIri: string): Promise<boolean> {
    const snap = this.schema.snapshot;
    const stmts = await this.kc.getStatements(entityId, snap.instanceOfProperty);
    return stmts.items.some(
      (s) => s.value.type === "EntityReference" && s.value.entityId === classIri,
    );
  }

  /** Resolve concrete ArchiMate class local for an entity. */
  async resolveClassLocal(entityId: string, hintLocal?: string): Promise<string> {
    if (hintLocal) return hintLocal;
    const entity = await this.kc.getEntity(entityId);
    const fromEffective: string[] = [];
    for (const iri of entity.effectiveClasses || []) {
      const local = this.schema.classLocal(iri);
      if (local) fromEffective.push(local);
    }
    const specific = mostSpecificClassLocal(fromEffective);
    if (specific) return specific;

    const snap = this.schema.snapshot;
    const stmts = await this.kc.getStatements(entityId, snap.instanceOfProperty);
    const fromInstanceOf: string[] = [];
    for (const s of stmts.items) {
      if (s.value.type !== "EntityReference") continue;
      const local = this.schema.classLocal(s.value.entityId);
      if (local) fromInstanceOf.push(local);
    }
    const fromIo = mostSpecificClassLocal(fromInstanceOf);
    if (fromIo) return fromIo;
    throw new Error(`Nelze určit třídu entity ${entityId} pro kontrolu AllowedRelationship.`);
  }

  async createRelationship(opts: {
    packageCode: string;
    typeLocal: string;
    sourceId: string;
    targetId: string;
    props?: Record<string, string>;
  }): Promise<Entity> {
    if (opts.typeLocal === "Flow" && !opts.props?.flowLabel) {
      throw new Error("Flow vyžaduje flowLabel (co teče)");
    }

    const { result } = await this.kc.runLogicalChangeSet(
      {
        operationType: "createRelationship",
        comment: opts.typeLocal,
      },
      async () => {
        return await this.createRelationshipInChangeSet(opts);
      },
    );
    return result;
  }

  private async createRelationshipInChangeSet(opts: {
    packageCode: string;
    typeLocal: string;
    sourceId: string;
    targetId: string;
    props?: Record<string, string>;
    /** Optional known class locals (avoids extra reads for newly created elements). */
    sourceClassLocal?: string;
    targetClassLocal?: string;
  }): Promise<Entity> {
    const snap = this.schema.snapshot;
    const typeIri = this.schema.classIri(opts.typeLocal);

    const sourceLocal = await this.resolveClassLocal(opts.sourceId, opts.sourceClassLocal);
    const targetLocal = await this.resolveClassLocal(opts.targetId, opts.targetClassLocal);
    assertAllowed(this.schema, opts.typeLocal, sourceLocal, targetLocal);

    const iriLocal = `rel-${opts.typeLocal.toLowerCase()}-${Date.now().toString(36)}`;
    const clientKey = `$rel:${iriLocal}`;

    const operations: import("./types").ChangeOperation[] = [
      {
        op: "createEntity",
        clientKey,
        packageCode: opts.packageCode,
        labels: { en: `${opts.typeLocal}` },
        iriLocal,
      },
      {
        op: "createStatement",
        packageCode: opts.packageCode,
        subject: clientKey,
        property: snap.instanceOfProperty,
        value: { type: "EntityReference", entityId: typeIri },
        upsert: true,
      },
      {
        op: "createStatement",
        packageCode: opts.packageCode,
        subject: clientKey,
        property: snap.relSource,
        value: { type: "EntityReference", entityId: opts.sourceId },
        upsert: true,
      },
      {
        op: "createStatement",
        packageCode: opts.packageCode,
        subject: clientKey,
        property: snap.relTarget,
        value: { type: "EntityReference", entityId: opts.targetId },
        upsert: true,
      },
    ];

    for (const [local, value] of Object.entries(opts.props || {})) {
      const propIri = this.schema.tryPropertyIri(local);
      if (!propIri) continue;
      operations.push({
        op: "createStatement",
        packageCode: opts.packageCode,
        subject: clientKey,
        property: propIri,
        value: { type: "String", string: value },
        upsert: true,
      });
    }

    const batch = await this.kc.applyChangeSetOperations({
      operationType: "createRelationship",
      comment: opts.typeLocal,
      operations,
    });
    const createdId =
      batch.data?.results?.find((r) => r.op === "createEntity" && r.entity)?.entity ||
      batch.data?.results?.find((r) => r.clientKey === clientKey && r.entity)?.entity;
    if (!createdId) {
      // Fallback: resolve by iriLocal
      const listed = await this.kc.listEntities({
        package: opts.packageCode,
        iriLocal,
        limit: 1,
      });
      if (!listed.items[0]) {
        throw new Error(`createRelationship batch did not return entity id for ${iriLocal}`);
      }
      return listed.items[0];
    }
    return await this.kc.getEntity(createdId);
  }

  async updateLabels(
    id: string,
    labels: Record<string, string>,
    descriptions?: Record<string, string>,
    revision?: number,
  ): Promise<ChangeSet> {
    const res = await this.kc.patchEntity(id, {
      labels,
      descriptions,
      expectedRevision: revision,
    });
    return res.changeSet;
  }

  async setStringProperty(
    packageCode: string,
    subject: string,
    propertyLocal: string,
    value: string,
  ): Promise<ChangeSet> {
    const cs = await this.replaceStringProperty({
      packageCode,
      subject,
      propertyLocal,
      newValue: value,
    });
    if (!cs) throw new Error("Property value unchanged");
    return cs;
  }

  /** Deprecate a statement (remove value from active graph). */
  async deprecatePropertyStatement(statement: Statement): Promise<ChangeSet> {
    const res = await this.kc.deprecateStatement(statement.id, {
      expectedRevision: statement.revisionNo,
    });
    return res.changeSet;
  }

  /**
   * Replace property value: deprecate existing statement when needed, create new.
   * Returns null when newValue equals existing (no-op).
   */
  async replacePropertyValue(opts: {
    packageCode: string;
    subject: string;
    propertyLocal: string;
    newValue: StatementValue;
    existingStatement?: Statement;
  }): Promise<ChangeSet | null> {
    const existing = opts.existingStatement;
    if (
      existing &&
      stringValuesEqual(stringFromValue(existing.value), stringFromValue(opts.newValue))
    ) {
      return null;
    }

    const { changeSet } = await this.kc.runLogicalChangeSet(
      {
        operationType: "replaceProperty",
        comment: `${opts.propertyLocal}`,
      },
      async () => {
        if (existing) {
          await this.kc.deprecateStatement(existing.id, {
            expectedRevision: existing.revisionNo,
          });
        }
        const propIri = this.schema.propertyIri(opts.propertyLocal);
        await this.kc.createStatement({
          packageCode: opts.packageCode,
          subject: opts.subject,
          property: propIri,
          value: opts.newValue,
        });
      },
    );
    return changeSet;
  }

  /**
   * Replace string property value: deprecate existing statement(s) when needed, create new.
   * Returns null when newValue equals existing (no-op).
   */
  async replaceStringProperty(opts: {
    packageCode: string;
    subject: string;
    propertyLocal: string;
    newValue: string;
    existingStatement?: Statement;
  }): Promise<ChangeSet | null> {
    return this.replacePropertyValue({
      packageCode: opts.packageCode,
      subject: opts.subject,
      propertyLocal: opts.propertyLocal,
      newValue: { type: "String", string: opts.newValue },
      existingStatement: opts.existingStatement,
    });
  }

  /** Add another value for a multi-valued (or empty) property. */
  async addPropertyValue(opts: {
    packageCode: string;
    subject: string;
    propertyLocal: string;
    value: StatementValue;
  }): Promise<ChangeSet> {
    const propIri = this.schema.propertyIri(opts.propertyLocal);
    const res = await this.kc.createStatement({
      packageCode: opts.packageCode,
      subject: opts.subject,
      property: propIri,
      value: opts.value,
    });
    return res.changeSet;
  }

  /** Add another string value for a multi-valued property. */
  async addStringPropertyValue(opts: {
    packageCode: string;
    subject: string;
    propertyLocal: string;
    value: string;
  }): Promise<ChangeSet> {
    return this.addPropertyValue({
      packageCode: opts.packageCode,
      subject: opts.subject,
      propertyLocal: opts.propertyLocal,
      value: { type: "String", string: opts.value },
    });
  }

  /** Labels (+ optional actorKind / organizationScope) as one logical ChangeSet. */
  async saveEntityBasics(opts: {
    id: string;
    labels?: Record<string, string>;
    descriptions?: Record<string, string> | null;
    revision?: number;
    packageCode?: string;
    actorKind?: {
      newValue?: string;
      existingStatement?: Statement;
      remove?: boolean;
    };
    organizationScope?: {
      newValue?: string;
      existingStatement?: Statement;
      remove?: boolean;
    };
  }): Promise<ChangeSet | null> {
    const hasLabels = opts.labels !== undefined;
    const hasDescriptions = opts.descriptions !== undefined;
    const hasActorKind = opts.actorKind !== undefined;
    const hasOrganizationScope = opts.organizationScope !== undefined;

    if (!hasLabels && !hasDescriptions && !hasActorKind && !hasOrganizationScope) {
      return null;
    }

    const { changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "saveEntityBasics", comment: opts.labels?.cs || opts.labels?.en },
      async () => {
        if (hasLabels || hasDescriptions) {
          const patch: {
            labels?: Record<string, string>;
            descriptions?: Record<string, string>;
            expectedRevision?: number;
          } = { expectedRevision: opts.revision };
          if (hasLabels) patch.labels = opts.labels;
          if (hasDescriptions) {
            if (opts.descriptions) patch.descriptions = opts.descriptions;
          }
          await this.kc.patchEntity(opts.id, patch);
        }
        if (hasActorKind && opts.packageCode && opts.actorKind) {
          if (opts.actorKind.remove && opts.actorKind.existingStatement) {
            await this.kc.deprecateStatement(opts.actorKind.existingStatement.id, {
              expectedRevision: opts.actorKind.existingStatement.revisionNo,
            });
          } else if (opts.actorKind.newValue) {
            await this.replaceStringProperty({
              packageCode: opts.packageCode,
              subject: opts.id,
              propertyLocal: "actorKind",
              newValue: opts.actorKind.newValue,
              existingStatement: opts.actorKind.existingStatement,
            });
          }
        }
        if (hasOrganizationScope && opts.packageCode && opts.organizationScope) {
          if (opts.organizationScope.remove && opts.organizationScope.existingStatement) {
            await this.kc.deprecateStatement(opts.organizationScope.existingStatement.id, {
              expectedRevision: opts.organizationScope.existingStatement.revisionNo,
            });
          } else if (opts.organizationScope.newValue) {
            await this.replaceStringProperty({
              packageCode: opts.packageCode,
              subject: opts.id,
              propertyLocal: "organizationScope",
              newValue: opts.organizationScope.newValue,
              existingStatement: opts.organizationScope.existingStatement,
            });
          }
        }
      },
    );
    return changeSet;
  }

  async addOpenWorldProperty(opts: {
    packageCode: string;
    iriLocal: string;
    label: string;
    datatype?: string;
    subjectId: string;
    value: string;
  }): Promise<{ propertyId: string; changeSet: ChangeSet }> {
    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "addOpenWorldProperty", comment: opts.iriLocal },
      async () => {
        const created = await this.kc.createProperty({
          packageCode: opts.packageCode,
          datatype: opts.datatype || "String",
          labels: { en: opts.label, cs: opts.label },
          iriLocal: opts.iriLocal,
        });
        await this.kc.createStatement({
          packageCode: opts.packageCode,
          subject: opts.subjectId,
          property: created.data.id,
          value: { type: "String", string: opts.value },
          upsert: true,
        });
        await this.schema.load(true);
        return { propertyId: created.data.id };
      },
    );
    return { ...result, changeSet };
  }

  async ensureOrgPackage(
    code: string,
    iriPrefix = "https://example.org/",
    opts?: { label?: string; description?: string },
  ): Promise<Entity | PackageLike> {
    try {
      return await this.kc.getPackage(code);
    } catch {
      const base = iriPrefix.replace(/\/+$/, "");
      const iriBase = `${base}/${code}/`;
      const label = (opts?.label || code).trim() || code;
      const description = opts?.description?.trim();
      const res = await this.kc.createPackage({
        code,
        lifecycle: "continuous",
        iriBase,
        // Labels land on package-root entity (class Package); KC syncs package.labels.
        labels: { en: label, cs: label },
        descriptions: description ? { en: description, cs: description } : undefined,
        dependencies: [
          { dependsOnCode: "archimate-lite", versionRange: "^3.0.0" },
          { dependsOnCode: "archimate-ui-traversal", versionRange: "^1.0.0" },
        ],
      });
      return res.data;
    }
  }

  // ── Graph mutation surface (MCP / agents) ───────────────────────────────

  async createTypedStatement(opts: {
    packageCode: string;
    subjectId: string;
    propertyLocal: string;
    valueType: StatementValueType;
    value: string | boolean;
    upsert?: boolean;
  }): Promise<{ statement: Statement; changeSet: ChangeSet }> {
    const propIri =
      opts.propertyLocal === "instanceOf"
        ? this.schema.snapshot.instanceOfProperty
        : this.schema.propertyIri(opts.propertyLocal);
    const statementValue = toStatementValue(opts.valueType, opts.value);
    const res = await this.kc.createStatement({
      packageCode: opts.packageCode,
      subject: opts.subjectId,
      property: propIri,
      value: statementValue,
      upsert: opts.upsert,
    });
    return { statement: res.data, changeSet: res.changeSet };
  }

  async deprecateStatementById(
    statementId: string,
    expectedRevision?: number,
  ): Promise<ChangeSet> {
    const res = await this.kc.deprecateStatement(statementId, { expectedRevision });
    return res.changeSet;
  }

  async listStatementsForSubject(
    subjectId: string,
    propertyLocal?: string,
  ): Promise<Statement[]> {
    if (propertyLocal) {
      const propIri =
        propertyLocal === "instanceOf"
          ? this.schema.snapshot.instanceOfProperty
          : this.schema.propertyIri(propertyLocal);
      const page = await this.kc.getStatements(subjectId, propIri);
      return page.items || [];
    }
    // Unfiltered: merge model typing property when KC omits it from the default list.
    const page = await this.kc.getStatements(subjectId);
    const items = [...(page.items || [])];
    const ioProp = this.schema.snapshot.instanceOfProperty;
    const hasIo = items.some((s) => s.property === ioProp);
    if (!hasIo) {
      const ioPage = await this.kc.getStatements(subjectId, ioProp);
      items.push(...(ioPage.items || []));
    }
    return items;
  }

  async clearPropertyStatements(opts: {
    subjectId: string;
    propertyLocal: string;
  }): Promise<{ deprecated: number; changeSetIds: string[] }> {
    const propIri =
      opts.propertyLocal === "instanceOf"
        ? this.schema.snapshot.instanceOfProperty
        : this.schema.propertyIri(opts.propertyLocal);
    const page = await this.kc.getStatements(opts.subjectId, propIri);
    const changeSetIds: string[] = [];
    for (const st of page.items || []) {
      const cs = await this.deprecatePropertyStatement(st);
      changeSetIds.push(cs.id);
    }
    return { deprecated: page.items?.length || 0, changeSetIds };
  }

  async reclassifyEntity(opts: {
    id: string;
    packageCode: string;
    newClassLocal: string;
    props?: Record<string, string>;
    strictRelations?: StrictRelationsMode;
    dryRun?: boolean;
  }): Promise<ReclassifyEntityResult> {
    return this.graph.reclassifyEntity(opts);
  }

  async reclassifyEntities(opts: {
    ids?: string[];
    packageCode: string;
    fromClassLocal?: string;
    newClassLocal: string;
    props?: Record<string, string>;
    strictRelations?: StrictRelationsMode;
    dryRun?: boolean;
  }): Promise<{ results: ReclassifyEntityResult[]; writtenCount: number }> {
    return this.graph.reclassifyEntities(opts);
  }

  async getClassConstraints(classLocal: string) {
    return getClassConstraints(this.kc, this.schema, classLocal);
  }

  async updateRelationship(opts: {
    id: string;
    packageCode: string;
    sourceId?: string;
    targetId?: string;
    typeLocal?: string;
  }): Promise<{ entity: Entity; changeSet: ChangeSet; iriLocal?: string }> {
    return this.graph.updateRelationship(opts);
  }

  async retargetViewNodes(opts: {
    packageCode: string;
    fromElementId: string;
    toElementId: string;
    viewId?: string;
  }): Promise<{ updated: number; nodeIds: string[]; changeSet: ChangeSet }> {
    return this.graph.retargetViewNodes(opts);
  }

  /**
   * High-level ops append into the active ChangeSet (soft limit enforced by caller).
   */
  async applyGraphOperations(
    packageCode: string,
    operations: GraphApplyOperation[],
  ): Promise<{ applied: number; results: Array<Record<string, unknown>>; changeSetId?: string }> {
    const results: Array<Record<string, unknown>> = [];
    let changeSetId: string | undefined;

    const { changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "applyGraphOperations", comment: `${operations.length} ops` },
      async () => {
        for (let i = 0; i < operations.length; i++) {
          const op = operations[i];
          const tag = { index: i, op: op.op };
          switch (op.op) {
            case "createEntity": {
              const created = await this.createTypedElement({
                packageCode: op.packageCode || packageCode,
                classLocal: op.classLocal,
                name: op.name,
                descriptions: op.description
                  ? { en: op.description, cs: op.description }
                  : op.descriptions,
                iriLocal: op.iriLocal,
                extraProps: op.props,
              });
              results.push({
                ...tag,
                entityId: created.entity.id,
                iriLocal: created.entity.iriLocal,
              });
              changeSetId = created.changeSet.id;
              break;
            }
            case "updateEntity": {
              const cs = await this.saveEntityBasics({
                id: op.id,
                labels: op.labels,
                descriptions: op.descriptions,
                revision: op.expectedRevision,
              });
              results.push({ ...tag, changeSetId: cs?.id ?? null, noop: cs === null });
              if (cs) changeSetId = cs.id;
              break;
            }
            case "deprecateEntity": {
              const res = await this.kc.deprecateEntity(op.id, {
                expectedRevision: op.expectedRevision,
              });
              results.push({ ...tag, entityId: res.data.id, changeSetId: res.changeSet.id });
              changeSetId = res.changeSet.id;
              break;
            }
            case "createStatement": {
              const res = await this.createTypedStatement({
                packageCode: op.packageCode || packageCode,
                subjectId: op.subjectId,
                propertyLocal: op.propertyLocal,
                valueType: op.valueType,
                value: op.value,
                upsert: op.upsert,
              });
              results.push({
                ...tag,
                statementId: res.statement.id,
                changeSetId: res.changeSet.id,
              });
              changeSetId = res.changeSet.id;
              break;
            }
            case "deprecateStatement": {
              const cs = await this.deprecateStatementById(op.statementId, op.expectedRevision);
              results.push({ ...tag, changeSetId: cs.id });
              changeSetId = cs.id;
              break;
            }
            case "createRelationship": {
              const entity = await this.createRelationship({
                packageCode: op.packageCode || packageCode,
                typeLocal: op.typeLocal,
                sourceId: op.sourceId,
                targetId: op.targetId,
                props: op.props,
              });
              results.push({ ...tag, relationshipId: entity.id });
              break;
            }
            case "setProperty": {
              const existingPage = await this.kc.getStatements(
                op.id,
                this.schema.propertyIri(op.propertyLocal),
              );
              const cs = await this.replaceStringProperty({
                packageCode: op.packageCode || packageCode,
                subject: op.id,
                propertyLocal: op.propertyLocal,
                newValue: op.value,
                existingStatement: existingPage.items[0],
              });
              results.push({ ...tag, changeSetId: cs?.id ?? null, noop: cs === null });
              if (cs) changeSetId = cs.id;
              break;
            }
            case "clearProperty": {
              const cleared = await this.clearPropertyStatements({
                subjectId: op.id,
                propertyLocal: op.propertyLocal,
              });
              results.push({ ...tag, deprecated: cleared.deprecated });
              break;
            }
            case "reclassifyEntity": {
              const r = await this.reclassifyEntity({
                id: op.id,
                packageCode: op.packageCode || packageCode,
                newClassLocal: op.newClassLocal,
                props: op.props,
                strictRelations: op.strictRelations,
                dryRun: op.dryRun,
              });
              results.push({ ...tag, ...r });
              if (r.changeSetId) changeSetId = r.changeSetId;
              break;
            }
            default: {
              throw new Error(`Unknown apply op: ${(op as { op: string }).op}`);
            }
          }
        }
      },
    );

    return {
      applied: results.length,
      results,
      changeSetId: changeSetId || changeSet.id,
    };
  }
}

/** Soft limit for MCP apply_operations. */
export const APPLY_OPERATIONS_SOFT_LIMIT = 300;

export type GraphApplyOperation =
  | {
      op: "createEntity";
      packageCode?: string;
      classLocal: string;
      name: string;
      description?: string;
      descriptions?: Record<string, string>;
      iriLocal?: string;
      props?: Record<string, string>;
    }
  | {
      op: "updateEntity";
      id: string;
      labels?: Record<string, string>;
      descriptions?: Record<string, string> | null;
      expectedRevision?: number;
    }
  | {
      op: "deprecateEntity";
      id: string;
      expectedRevision?: number;
    }
  | {
      op: "createStatement";
      packageCode?: string;
      subjectId: string;
      propertyLocal: string;
      valueType: StatementValueType;
      value: string | boolean;
      upsert?: boolean;
    }
  | {
      op: "deprecateStatement";
      statementId: string;
      expectedRevision?: number;
    }
  | {
      op: "createRelationship";
      packageCode?: string;
      typeLocal: string;
      sourceId: string;
      targetId: string;
      props?: Record<string, string>;
    }
  | {
      op: "setProperty";
      packageCode?: string;
      id: string;
      propertyLocal: string;
      value: string;
    }
  | {
      op: "clearProperty";
      id: string;
      propertyLocal: string;
    }
  | {
      op: "reclassifyEntity";
      packageCode?: string;
      id: string;
      newClassLocal: string;
      props?: Record<string, string>;
      strictRelations?: StrictRelationsMode;
      dryRun?: boolean;
    };

type PackageLike = { code: string; labels?: Record<string, string>; rootEntityId?: string };

export function valueToDisplay(v: StatementValue): string {
  switch (v.type) {
    case "String":
      return v.string;
    case "EntityReference":
      return v.entityId;
    case "Boolean":
      return String(v.bool);
    case "Integer":
      return String(v.int64);
    case "LocalizedString":
      return v.langMap.cs || v.langMap.en || JSON.stringify(v.langMap);
    case "URI":
      return v.uri;
    default:
      return JSON.stringify(v);
  }
}
