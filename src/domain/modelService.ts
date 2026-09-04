import { getKc, type KcClient } from "../kc/client";
import { getSchema, type SchemaResolver } from "../kc/schema";
import type { ChangeSet, Entity, Statement, StatementValue } from "../kc/types";
import { stringFromValue, stringValuesEqual } from "./propertyEdit";
import type { AddActionDef } from "./templates";

export interface CreateElementInput {
  packageCode: string;
  name: string;
  description?: string;
  iriLocal?: string;
  action: AddActionDef;
  /** Selected entity in previous column (context for relationship) */
  selectedId?: string;
  extraProps?: Record<string, string>;
  /** Flow requires flowLabel */
  flowLabel?: string;
}

export interface LinkElementInput {
  packageCode: string;
  action: AddActionDef;
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
  constructor(
    private kc: KcClient = getKc(),
    private schema: SchemaResolver = getSchema(),
  ) {}

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

        const created = await this.kc.createEntity({
          packageCode: input.packageCode,
          labels: { en: input.name, cs: input.name },
          descriptions: input.description
            ? { en: input.description, cs: input.description }
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
  }): Promise<Entity> {
    const snap = this.schema.snapshot;
    const typeIri = this.schema.classIri(opts.typeLocal);

    const rel = await this.kc.createEntity({
      packageCode: opts.packageCode,
      labels: { en: `${opts.typeLocal}` },
      iriLocal: `rel-${opts.typeLocal.toLowerCase()}-${Date.now().toString(36)}`,
    });

    await this.kc.createStatement({
      packageCode: opts.packageCode,
      subject: rel.data.id,
      property: snap.instanceOfProperty,
      value: { type: "EntityReference", entityId: typeIri },
      upsert: true,
    });

    await this.kc.createStatement({
      packageCode: opts.packageCode,
      subject: rel.data.id,
      property: snap.relSource,
      value: { type: "EntityReference", entityId: opts.sourceId },
      upsert: true,
    });

    await this.kc.createStatement({
      packageCode: opts.packageCode,
      subject: rel.data.id,
      property: snap.relTarget,
      value: { type: "EntityReference", entityId: opts.targetId },
      upsert: true,
    });

    for (const [local, value] of Object.entries(opts.props || {})) {
      const propIri = this.schema.tryPropertyIri(local);
      if (!propIri) continue;
      await this.kc.createStatement({
        packageCode: opts.packageCode,
        subject: rel.data.id,
        property: propIri,
        value: { type: "String", string: value },
        upsert: true,
      });
    }

    return rel.data;
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
    const existing = opts.existingStatement;
    if (existing && stringValuesEqual(stringFromValue(existing.value), opts.newValue)) {
      return null;
    }

    const { changeSet } = await this.kc.runLogicalChangeSet(
      {
        operationType: "replaceProperty",
        comment: `${opts.propertyLocal}=${opts.newValue}`,
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
          value: { type: "String", string: opts.newValue },
        });
      },
    );
    return changeSet;
  }

  /** Add another value for a multi-valued property. */
  async addStringPropertyValue(opts: {
    packageCode: string;
    subject: string;
    propertyLocal: string;
    value: string;
  }): Promise<ChangeSet> {
    const propIri = this.schema.propertyIri(opts.propertyLocal);
    const res = await this.kc.createStatement({
      packageCode: opts.packageCode,
      subject: opts.subject,
      property: propIri,
      value: { type: "String", string: opts.value },
    });
    return res.changeSet;
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
}

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
