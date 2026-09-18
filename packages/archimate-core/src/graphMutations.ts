/**
 * Graph mutation helpers: reclassify (preserve id), relation impact, update relationship.
 * Used by ModelService / MCP — no session concerns here.
 */
import {
  getClassConstraints,
  missingRequiredPropLocals,
} from "./classConstraints";
import type { KcClient } from "./kcClient";
import type { SchemaResolver } from "./schema";
import type { ChangeOperation, ChangeSet, Entity, Statement, StatementValue } from "./types";
import { isRelationshipClassLocal, mostSpecificClassLocal } from "./openExchange/typeMap";

export type StrictRelationsMode = "fail" | "warn";

export type ReclassifyWriteMode = "revise" | "create" | "normalize-multi";

export type IncidentRelationship = {
  relationshipId: string;
  typeLocal: string;
  sourceId: string;
  targetId: string;
  sourceClassLocal: string;
  targetClassLocal: string;
  /** Which end is the subject entity being reclassified. */
  role: "source" | "target";
};

export type InvalidRelationship = {
  relationshipId: string;
  typeLocal: string;
  sourceId: string;
  targetId: string;
  sourceClassLocal: string;
  targetClassLocal: string;
  reason: string;
};

export type ReclassifyEntityResult = {
  id: string;
  iriLocal?: string;
  fromClass: string | null;
  toClass: string;
  ok: boolean;
  writeMode: ReclassifyWriteMode;
  missingRequiredProps: string[];
  invalidRelationships: InvalidRelationship[];
  wouldWrite: boolean;
  written: boolean;
  changeSetId?: string;
  error?: string;
};

export type StatementValueType = "string" | "entityRef" | "boolean";

export function toStatementValue(
  valueType: StatementValueType,
  value: string | boolean,
): StatementValue {
  if (valueType === "string") {
    if (typeof value !== "string") throw new Error("string valueType requires string value");
    return { type: "String", string: value };
  }
  if (valueType === "boolean") {
    if (typeof value !== "boolean") throw new Error("boolean valueType requires boolean value");
    return { type: "Boolean", bool: value };
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("entityRef valueType requires non-empty entity id string");
  }
  return { type: "EntityReference", entityId: value.trim() };
}

export function resolveInstanceOfWriteMode(activeCount: number): ReclassifyWriteMode {
  if (activeCount <= 0) return "create";
  if (activeCount === 1) return "revise";
  return "normalize-multi";
}

/**
 * Pure projection: which incident relationships become invalid after class change.
 * Optional peerClassById projects other ends that are reclassified in the same batch.
 */
export function projectRelationImpact(
  schema: { isAllowed(typeLocal: string, sourceLocal: string, targetLocal: string): boolean },
  incidents: IncidentRelationship[],
  newClassLocal: string,
  peerClassById?: ReadonlyMap<string, string>,
): InvalidRelationship[] {
  const invalid: InvalidRelationship[] = [];
  for (const rel of incidents) {
    const peerSource = peerClassById?.get(rel.sourceId);
    const peerTarget = peerClassById?.get(rel.targetId);
    const sourceClass =
      rel.role === "source" ? newClassLocal : peerSource ?? rel.sourceClassLocal;
    const targetClass =
      rel.role === "target" ? newClassLocal : peerTarget ?? rel.targetClassLocal;
    if (schema.isAllowed(rel.typeLocal, sourceClass, targetClass)) continue;
    invalid.push({
      relationshipId: rel.relationshipId,
      typeLocal: rel.typeLocal,
      sourceId: rel.sourceId,
      targetId: rel.targetId,
      sourceClassLocal: sourceClass,
      targetClassLocal: targetClass,
      reason: `Vztah ${rel.typeLocal} není dovolen mezi ${sourceClass} → ${targetClass} (AllowedRelationship).`,
    });
  }
  return invalid;
}

export class GraphMutationService {
  constructor(
    private kc: KcClient,
    private schema: SchemaResolver,
  ) {}

  async listActiveInstanceOf(entityId: string): Promise<Statement[]> {
    const snap = this.schema.snapshot;
    const page = await this.kc.getStatements(entityId, snap.instanceOfProperty);
    return page.items || [];
  }

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

    const stmts = await this.listActiveInstanceOf(entityId);
    const fromInstanceOf: string[] = [];
    for (const s of stmts) {
      if (s.value.type !== "EntityReference") continue;
      const local = this.schema.classLocal(s.value.entityId);
      if (local) fromInstanceOf.push(local);
    }
    const fromIo = mostSpecificClassLocal(fromInstanceOf);
    if (fromIo) return fromIo;
    throw new Error(`Nelze určit třídu entity ${entityId}.`);
  }

  /**
   * Relationships where entity is relSource or relTarget.
   */
  async listIncidentRelationships(entityId: string): Promise<IncidentRelationship[]> {
    const snap = this.schema.snapshot;
    const relIds = new Set<string>();
    for (const prop of [snap.relSource, snap.relTarget]) {
      if (!prop) continue;
      const page = await this.kc.getIncoming(entityId, prop);
      for (const s of page.items || []) {
        if (s.subject) relIds.add(s.subject);
      }
    }

    const out: IncidentRelationship[] = [];
    for (const relId of relIds) {
      let relEntity: Entity;
      try {
        relEntity = await this.kc.getEntity(relId);
      } catch {
        continue;
      }
      if (relEntity.status === "deprecated") continue;

      let typeLocal: string | undefined;
      for (const iri of relEntity.effectiveClasses || []) {
        const local = this.schema.classLocal(iri);
        if (local && isRelationshipClassLocal(local)) {
          typeLocal = local;
          break;
        }
      }
      if (!typeLocal) {
        const io = await this.listActiveInstanceOf(relId);
        for (const s of io) {
          if (s.value.type !== "EntityReference") continue;
          const local = this.schema.classLocal(s.value.entityId);
          if (local && isRelationshipClassLocal(local)) {
            typeLocal = local;
            break;
          }
        }
      }
      if (!typeLocal) continue;

      const stmts = await this.kc.getStatements(relId);
      let sourceId: string | undefined;
      let targetId: string | undefined;
      for (const s of stmts.items || []) {
        if (s.property === snap.relSource && s.value.type === "EntityReference") {
          sourceId = s.value.entityId;
        }
        if (s.property === snap.relTarget && s.value.type === "EntityReference") {
          targetId = s.value.entityId;
        }
      }
      if (!sourceId || !targetId) continue;
      if (sourceId !== entityId && targetId !== entityId) continue;

      const role: "source" | "target" = sourceId === entityId ? "source" : "target";
      const otherId = role === "source" ? targetId : sourceId;
      let sourceClassLocal: string;
      let targetClassLocal: string;
      try {
        if (role === "source") {
          sourceClassLocal = "PENDING";
          targetClassLocal = await this.resolveClassLocal(otherId);
        } else {
          sourceClassLocal = await this.resolveClassLocal(otherId);
          targetClassLocal = "PENDING";
        }
      } catch {
        continue;
      }
      // Fill the entity's current class for reporting; projection will override with newClass.
      const currentClass = await this.resolveClassLocal(entityId).catch(() => "?");
      if (role === "source") sourceClassLocal = currentClass;
      else targetClassLocal = currentClass;

      out.push({
        relationshipId: relId,
        typeLocal,
        sourceId,
        targetId,
        sourceClassLocal,
        targetClassLocal,
        role,
      });
    }
    return out;
  }

  private async existingStringPropLocals(entityId: string): Promise<Set<string>> {
    const page = await this.kc.getStatements(entityId);
    const out = new Set<string>();
    for (const s of page.items || []) {
      if (s.value.type !== "String" || !s.value.string?.trim()) continue;
      const local = this.schema.propertyLocal(s.property);
      if (local) out.add(local);
    }
    return out;
  }

  /**
   * Write instanceOf via revise (preferred), create, or normalize-multi.
   * Uses snapshot.instanceOfProperty only.
   */
  private async writeInstanceOf(opts: {
    entityId: string;
    packageCode: string;
    newClassLocal: string;
  }): Promise<ReclassifyWriteMode> {
    const snap = this.schema.snapshot;
    const classIri = this.schema.classIri(opts.newClassLocal);
    const existing = await this.listActiveInstanceOf(opts.entityId);
    const mode = resolveInstanceOfWriteMode(existing.length);
    const value: StatementValue = { type: "EntityReference", entityId: classIri };

    if (mode === "create") {
      await this.kc.createStatement({
        packageCode: opts.packageCode,
        subject: opts.entityId,
        property: snap.instanceOfProperty,
        value,
        upsert: false,
      });
      return mode;
    }

    if (mode === "revise") {
      const st = existing[0]!;
      await this.kc.reviseStatement(st.id, {
        value,
        expectedRevision: st.revisionNo,
      });
      return mode;
    }

    // normalize-multi: keep first, deprecate extras, revise kept
    const [keep, ...extras] = existing;
    for (const st of extras) {
      await this.kc.deprecateStatement(st.id, { expectedRevision: st.revisionNo });
    }
    await this.kc.reviseStatement(keep!.id, {
      value,
      expectedRevision: keep!.revisionNo,
    });
    return mode;
  }

  /**
   * Upsert string props in one batch so strict shape validation sees all requireds together.
   * (Per-statement create under strict would fail mid-way on multi-required shapes.)
   */
  private async upsertPropsBatch(opts: {
    entityId: string;
    packageCode: string;
    props: Record<string, string>;
  }): Promise<void> {
    const entries = Object.entries(opts.props).filter(([, v]) => v != null && String(v).trim());
    if (!entries.length) return;

    const ops: ChangeOperation[] = [];
    for (const [local, raw] of entries) {
      const propIri = this.schema.propertyIri(local);
      const page = await this.kc.getStatements(opts.entityId, propIri);
      for (const st of page.items || []) {
        ops.push({
          op: "deprecateStatement",
          statement: st.id,
          expectedRevision: st.revisionNo,
        });
      }
      ops.push({
        op: "createStatement",
        packageCode: opts.packageCode,
        subject: opts.entityId,
        property: propIri,
        value: { type: "String", string: String(raw) },
        upsert: true,
      });
    }
    if (!ops.length) return;
    await this.kc.applyChangeSetOperations({
      operationType: "reclassifyEntity.props",
      comment: `props for ${opts.entityId}`,
      operations: ops,
    });
  }

  private async assertSingleInstanceOf(
    entityId: string,
    newClassLocal: string,
  ): Promise<void> {
    const io = await this.listActiveInstanceOf(entityId);
    if (io.length !== 1) {
      throw new Error(
        `reclassify assert failed: expected 1 active instanceOf on ${entityId}, got ${io.length}`,
      );
    }
    const v = io[0]!.value;
    if (v.type !== "EntityReference") {
      throw new Error(`reclassify assert failed: instanceOf is not EntityReference on ${entityId}`);
    }
    const local = this.schema.classLocal(v.entityId);
    if (local !== newClassLocal) {
      throw new Error(
        `reclassify assert failed: instanceOf class is ${local ?? v.entityId}, expected ${newClassLocal}`,
      );
    }
  }

  async reclassifyEntity(opts: {
    id: string;
    packageCode: string;
    newClassLocal: string;
    props?: Record<string, string>;
    strictRelations?: StrictRelationsMode;
    dryRun?: boolean;
    /** Peer id → target class for batch projection. */
    peerClassById?: ReadonlyMap<string, string>;
  }): Promise<ReclassifyEntityResult> {
    const strict = opts.strictRelations ?? "fail";
    const dryRun = opts.dryRun === true;
    const entity = await this.kc.getEntity(opts.id);
    const packageCode = opts.packageCode || entity.packageCode;
    if (!packageCode) throw new Error(`Entity ${opts.id} has no packageCode`);

    this.schema.classIri(opts.newClassLocal); // throws if unknown

    let fromClass: string | null = null;
    try {
      fromClass = await this.resolveClassLocal(opts.id);
    } catch {
      fromClass = null;
    }

    const existingIo = await this.listActiveInstanceOf(opts.id);
    const writeMode = resolveInstanceOfWriteMode(existingIo.length);

    const incidents = await this.listIncidentRelationships(opts.id);
    const peerMap = new Map<string, string>(opts.peerClassById || []);
    peerMap.set(opts.id, opts.newClassLocal);
    const invalidRelationships = projectRelationImpact(
      this.schema,
      incidents,
      opts.newClassLocal,
      peerMap,
    );

    const constraints = await getClassConstraints(this.kc, this.schema, opts.newClassLocal);
    const existingProps = await this.existingStringPropLocals(opts.id);
    const missingRequiredProps = missingRequiredPropLocals(
      constraints,
      opts.props,
      existingProps,
    );

    const relationsBlocked = strict === "fail" && invalidRelationships.length > 0;
    const propsBlocked = missingRequiredProps.length > 0;
    const blocked = relationsBlocked || propsBlocked;
    const wouldWrite = !dryRun && !blocked;

    const base: ReclassifyEntityResult = {
      id: opts.id,
      iriLocal: entity.iriLocal,
      fromClass,
      toClass: opts.newClassLocal,
      ok: !blocked,
      writeMode,
      missingRequiredProps,
      invalidRelationships,
      wouldWrite,
      written: false,
    };

    if (dryRun || blocked) {
      const errors: string[] = [];
      if (propsBlocked) {
        errors.push(`missingRequiredProps: ${missingRequiredProps.join(", ")}`);
      }
      if (relationsBlocked) {
        errors.push(
          `strictRelations=fail: ${invalidRelationships.length} invalid relationship(s) after reclassify`,
        );
      }
      if (errors.length) base.error = errors.join("; ");
      return base;
    }

    const { changeSet } = await this.kc.runLogicalChangeSet(
      {
        operationType: "reclassifyEntity",
        comment: `reclassify ${opts.id} → ${opts.newClassLocal}`,
      },
      async () => {
        await this.writeInstanceOf({
          entityId: opts.id,
          packageCode,
          newClassLocal: opts.newClassLocal,
        });
        if (opts.props && Object.keys(opts.props).length) {
          await this.upsertPropsBatch({
            entityId: opts.id,
            packageCode,
            props: opts.props,
          });
        }
        await this.assertSingleInstanceOf(opts.id, opts.newClassLocal);
      },
    );

    return {
      ...base,
      written: true,
      changeSetId: changeSet.id,
    };
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
    const strict = opts.strictRelations ?? "fail";
    const dryRun = opts.dryRun === true;

    const idSet = new Set<string>(opts.ids || []);
    if (opts.fromClassLocal) {
      const classIri = this.schema.classIri(opts.fromClassLocal);
      const listed = await this.kc.listAllEntities({
        package: opts.packageCode,
        kind: "entity",
        instanceOf: classIri,
        includeSubclasses: false,
      });
      for (const e of listed) {
        if (e.status === "deprecated") continue;
        idSet.add(e.id);
      }
    }
    if (!idSet.size) {
      throw new Error("reclassifyEntities requires ids[] and/or fromClassLocal");
    }

    const peerClassById = new Map<string, string>();
    for (const id of idSet) {
      peerClassById.set(id, opts.newClassLocal);
    }

    // Preview all first (with peer projection)
    const previews: ReclassifyEntityResult[] = [];
    for (const id of idSet) {
      const preview = await this.reclassifyEntity({
        id,
        packageCode: opts.packageCode,
        newClassLocal: opts.newClassLocal,
        props: opts.props,
        strictRelations: strict,
        dryRun: true,
        peerClassById,
      });
      previews.push(preview);
    }

    const anyBlocked = previews.some((p) => !p.ok);
    if (dryRun) {
      return { results: previews, writtenCount: 0 };
    }
    if (anyBlocked) {
      // Fail entire batch when any entity missing required props or (strict=fail) invalid rels
      return {
        results: previews.map((p) => ({
          ...p,
          wouldWrite: false,
          written: false,
          error:
            p.error ||
            "batch blocked: at least one entity has missingRequiredProps or invalid relationships",
        })),
        writtenCount: 0,
      };
    }

    const results: ReclassifyEntityResult[] = [];
    let writtenCount = 0;
    for (const id of idSet) {
      const r = await this.reclassifyEntity({
        id,
        packageCode: opts.packageCode,
        newClassLocal: opts.newClassLocal,
        props: opts.props,
        strictRelations: "warn", // already gated above
        dryRun: false,
        peerClassById,
      });
      if (r.written) writtenCount += 1;
      results.push(r);
    }
    return { results, writtenCount };
  }

  /**
   * Update relationship ends and/or type while preserving entity id / iriLocal.
   */
  async updateRelationship(opts: {
    id: string;
    packageCode: string;
    sourceId?: string;
    targetId?: string;
    typeLocal?: string;
  }): Promise<{ entity: Entity; changeSet: ChangeSet; iriLocal?: string }> {
    const snap = this.schema.snapshot;
    const entity = await this.kc.getEntity(opts.id);
    const packageCode = opts.packageCode || entity.packageCode;
    if (!packageCode) throw new Error(`Relationship ${opts.id} has no packageCode`);

    const stmts = await this.kc.getStatements(opts.id);
    let sourceStmt: Statement | undefined;
    let targetStmt: Statement | undefined;
    let currentSource: string | undefined;
    let currentTarget: string | undefined;
    for (const s of stmts.items || []) {
      if (s.property === snap.relSource && s.value.type === "EntityReference") {
        sourceStmt = s;
        currentSource = s.value.entityId;
      }
      if (s.property === snap.relTarget && s.value.type === "EntityReference") {
        targetStmt = s;
        currentTarget = s.value.entityId;
      }
    }

    const nextSource = opts.sourceId ?? currentSource;
    const nextTarget = opts.targetId ?? currentTarget;
    if (!nextSource || !nextTarget) {
      throw new Error(`Relationship ${opts.id} missing source/target`);
    }

    let typeLocal = opts.typeLocal;
    if (!typeLocal) {
      typeLocal = await this.resolveClassLocal(opts.id);
    }

    const sourceClass = await this.resolveClassLocal(nextSource);
    const targetClass = await this.resolveClassLocal(nextTarget);
    if (!this.schema.isAllowed(typeLocal, sourceClass, targetClass)) {
      throw new Error(
        `Vztah ${typeLocal} není dovolen mezi ${sourceClass} → ${targetClass} (AllowedRelationship).`,
      );
    }

    const { changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "updateRelationship", comment: opts.id },
      async () => {
        if (opts.typeLocal) {
          await this.writeInstanceOf({
            entityId: opts.id,
            packageCode,
            newClassLocal: opts.typeLocal,
          });
        }

        if (opts.sourceId && opts.sourceId !== currentSource) {
          if (sourceStmt) {
            await this.kc.reviseStatement(sourceStmt.id, {
              value: { type: "EntityReference", entityId: opts.sourceId },
              expectedRevision: sourceStmt.revisionNo,
            });
          } else {
            await this.kc.createStatement({
              packageCode,
              subject: opts.id,
              property: snap.relSource,
              value: { type: "EntityReference", entityId: opts.sourceId },
            });
          }
        }

        if (opts.targetId && opts.targetId !== currentTarget) {
          if (targetStmt) {
            await this.kc.reviseStatement(targetStmt.id, {
              value: { type: "EntityReference", entityId: opts.targetId },
              expectedRevision: targetStmt.revisionNo,
            });
          } else {
            await this.kc.createStatement({
              packageCode,
              subject: opts.id,
              property: snap.relTarget,
              value: { type: "EntityReference", entityId: opts.targetId },
            });
          }
        }
      },
    );

    const updated = await this.kc.getEntity(opts.id);
    return { entity: updated, changeSet, iriLocal: updated.iriLocal || entity.iriLocal };
  }

  /**
   * Retarget ViewNode.elementRef from one element id to another (same package scope optional).
   */
  async retargetViewNodes(opts: {
    packageCode: string;
    fromElementId: string;
    toElementId: string;
    viewId?: string;
  }): Promise<{ updated: number; nodeIds: string[]; changeSet: ChangeSet }> {
    const elementRef = this.schema.tryPropertyIri("elementRef");
    if (!elementRef) throw new Error("Schema missing elementRef property");
    const inView = this.schema.tryPropertyIri("inView");

    const incoming = await this.kc.getIncoming(opts.fromElementId, elementRef);
    const nodeIds: string[] = [];
    for (const s of incoming.items || []) {
      if (!s.subject) continue;
      if (opts.viewId && inView) {
        const viewStmts = await this.kc.getStatements(s.subject, inView);
        const matches = viewStmts.items.some(
          (v) => v.value.type === "EntityReference" && v.value.entityId === opts.viewId,
        );
        if (!matches) continue;
      }
      if (opts.packageCode) {
        try {
          const node = await this.kc.getEntity(s.subject);
          if (node.packageCode && node.packageCode !== opts.packageCode) continue;
        } catch {
          continue;
        }
      }
      nodeIds.push(s.subject);
    }

    const { changeSet } = await this.kc.runLogicalChangeSet(
      {
        operationType: "retargetViewNodes",
        comment: `${opts.fromElementId} → ${opts.toElementId}`,
      },
      async () => {
        for (const nodeId of nodeIds) {
          const page = await this.kc.getStatements(nodeId, elementRef);
          for (const st of page.items || []) {
            await this.kc.deprecateStatement(st.id, { expectedRevision: st.revisionNo });
          }
          await this.kc.createStatement({
            packageCode: opts.packageCode,
            subject: nodeId,
            property: elementRef,
            value: { type: "EntityReference", entityId: opts.toElementId },
          });
        }
      },
    );

    return { updated: nodeIds.length, nodeIds, changeSet };
  }
}
