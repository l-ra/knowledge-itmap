import { getKc, type KcClient } from "../kc/client";
import { entityLabel, getSchema, type SchemaResolver } from "../kc/schema";
import type { Entity, Statement } from "../kc/types";
import type { AddActionDef } from "./templates";
import {
  type StageDef,
  type TraversalTemplate,
  type TransitionDef,
} from "./templates";

export interface ColumnItem {
  entity: Entity;
  classLocal: string;
  domainLabel: string;
  edgeLabelCs?: string;
  relationshipId?: string;
  relationshipClass?: string;
}

export interface ColumnState {
  stage: StageDef;
  items: ColumnItem[];
  loading: boolean;
  error?: string;
}

export interface FocusStep {
  entityId: string;
  label: string;
  stageCode: string;
  classLocal: string;
}

export function domainLabelFor(
  classLocal: string,
  actorKind?: string,
): string {
  if (classLocal === "BusinessActor") {
    if (actorKind === "person") return "Osoba";
    if (actorKind === "external") return "Externí subjekt";
    return "Organizační jednotka";
  }
  const map: Record<string, string> = {
    BusinessRole: "Role",
    BusinessFunction: "Oblast odpovědnosti",
    BusinessProcess: "Proces",
    BusinessService: "Business služba",
    ApplicationService: "Aplikační služba",
    ApplicationComponent: "Aplikace",
    DataObject: "Datový objekt",
    SystemSoftware: "System software",
    TechnologyService: "Technologická služba",
    Node: "Uzel",
    Device: "Zařízení",
    CommunicationNetwork: "Síť",
    Path: "Path",
    Facility: "Areál",
    Location: "Lokace",
  };
  return map[classLocal] || classLocal;
}

export class TraversalEngine {
  constructor(
    private kc: KcClient = getKc(),
    private schema: SchemaResolver = getSchema(),
  ) {}

  async loadRootColumn(
    packageCode: string,
    template: TraversalTemplate,
  ): Promise<ColumnState> {
    const stage = template.stages[0];
    const items = await this.loadStageRoots(packageCode, stage);
    return { stage, items, loading: false };
  }

  /** Candidates for "link existing" in add dialog — same class/filter rules as the column. */
  async searchStageCandidates(
    packageCode: string,
    stage: StageDef,
    action: AddActionDef,
    query: string,
    limit = 15,
  ): Promise<ColumnItem[]> {
    const snap = this.schema.snapshot;
    const classLocal = action.createsClass;
    const classIri = snap.classesByLocal.get(classLocal)?.id;
    if (!classIri) return [];

    const page = await this.kc.listEntities({
      package: packageCode,
      instanceOf: classIri,
      includeSubclasses: true,
      q: query.trim() || undefined,
      limit: 200,
    });

    const needle = query.trim().toLocaleLowerCase("cs");
    const items: ColumnItem[] = [];

    for (const entity of page.items) {
      const actorKind = await this.readStringProp(entity.id, "actorKind");
      if (stage.actorKinds && classLocal === "BusinessActor") {
        if (!actorKind || !stage.actorKinds.includes(actorKind as never)) continue;
      }
      if (action.defaults?.actorKind && classLocal === "BusinessActor") {
        if (actorKind !== action.defaults.actorKind) continue;
      }
      if (needle) {
        const label = entityLabel(entity).toLocaleLowerCase("cs");
        if (!label.includes(needle)) continue;
      }
      items.push({
        entity,
        classLocal,
        domainLabel: domainLabelFor(classLocal, actorKind),
      });
    }

    items.sort((a, b) => entityLabel(a.entity).localeCompare(entityLabel(b.entity), "cs"));
    return items.slice(0, limit);
  }

  async loadNextColumn(
    packageCode: string,
    template: TraversalTemplate,
    selected: Entity,
    selectedClassLocal: string,
    fromStageCode: string,
  ): Promise<ColumnState | null> {
    const fromIdx = template.stages.findIndex((s) => s.code === fromStageCode);
    if (fromIdx < 0 || fromIdx >= template.stages.length - 1) return null;

    // Find next stage that has a transition from current
    for (let i = fromIdx + 1; i < template.stages.length; i++) {
      const toStage = template.stages[i];
      const transitions = template.transitions.filter(
        (t) => t.from === fromStageCode && t.to === toStage.code,
      );
      // Also allow transitions from earlier stages that match selected class
      const allTo = template.transitions.filter((t) => t.to === toStage.code);
      const applicable =
        transitions.length > 0
          ? transitions
          : allTo.filter((t) => {
              const fromStage = template.stages.find((s) => s.code === t.from);
              return fromStage?.classes.includes(selectedClassLocal as never);
            });

      if (applicable.length === 0 && i === fromIdx + 1) {
        // try walking with transitions that start from this stage to any later
        continue;
      }

      const items = await this.collectViaTransitions(
        packageCode,
        selected,
        selectedClassLocal,
        toStage,
        applicable.length ? applicable : transitions,
      );

      // Always return the immediate next stage even if empty (progressive disclosure)
      if (i === fromIdx + 1 || items.length > 0) {
        return { stage: toStage, items, loading: false };
      }
    }
    return null;
  }

  /** Expand immediate next stages along the template path. */
  async expandPath(
    packageCode: string,
    template: TraversalTemplate,
    focus: FocusStep[],
  ): Promise<ColumnState[]> {
    const columns: ColumnState[] = [];

    // Root
    const root = await this.loadRootColumn(packageCode, template);
    columns.push(root);

    for (let i = 0; i < focus.length; i++) {
      const step = focus[i];
      const fromStage = step.stageCode;
      const entity = await this.kc.getEntity(step.entityId);
      const next = await this.loadNextColumn(
        packageCode,
        template,
        entity,
        step.classLocal,
        fromStage,
      );
      if (!next) break;
      columns.push(next);
    }
    return columns;
  }

  private async loadStageRoots(packageCode: string, stage: StageDef): Promise<ColumnItem[]> {
    const snap = this.schema.snapshot;
    const items: ColumnItem[] = [];

    for (const classLocal of stage.classes) {
      const classIri = snap.classesByLocal.get(classLocal)?.id;
      if (!classIri) continue;
      const page = await this.kc.listEntities({
        package: packageCode,
        instanceOf: classIri,
        includeSubclasses: true,
        limit: 200,
      });
      for (const entity of page.items) {
        const actorKind = await this.readStringProp(entity.id, "actorKind");
        if (stage.actorKinds && classLocal === "BusinessActor") {
          if (!actorKind || !stage.actorKinds.includes(actorKind as never)) continue;
        }
        items.push({
          entity,
          classLocal,
          domainLabel: domainLabelFor(classLocal, actorKind),
        });
      }
    }

    items.sort((a, b) => entityLabel(a.entity).localeCompare(entityLabel(b.entity), "cs"));
    return items;
  }

  private async collectViaTransitions(
    packageCode: string,
    selected: Entity,
    selectedClassLocal: string,
    toStage: StageDef,
    transitions: TransitionDef[],
  ): Promise<ColumnItem[]> {
    void packageCode;
    void selectedClassLocal;
    const snap = this.schema.snapshot;
    const found = new Map<string, ColumnItem>();

    for (const tr of transitions) {
      const relClass = snap.classesByLocal.get(tr.relationship);
      if (!relClass) continue;

      // Relationships where selected is source or target depending on direction
      const neighborIds = await this.neighborsViaRel(
        selected.id,
        relClass.id,
        tr.direction,
      );

      for (const { neighborId, relId } of neighborIds) {
        if (found.has(neighborId)) continue;
        if (tr.requireProperty) {
          const propVal = await this.readStringProp(relId, tr.requireProperty.property);
          if (tr.requireProperty.value !== undefined) {
            if (propVal !== tr.requireProperty.value) continue;
          } else if (!propVal) {
            continue;
          }
        }
        const entity = await this.kc.getEntity(neighborId);
        const classLocal = await this.resolveClassLocal(entity);
        if (!classLocal) continue;
        if (!toStage.classes.includes(classLocal as never)) continue;

        if (toStage.actorKinds && classLocal === "BusinessActor") {
          const actorKind = await this.readStringProp(entity.id, "actorKind");
          if (!actorKind || !toStage.actorKinds.includes(actorKind as never)) continue;
        }

        found.set(neighborId, {
          entity,
          classLocal,
          domainLabel: domainLabelFor(
            classLocal,
            await this.readStringProp(entity.id, "actorKind"),
          ),
          edgeLabelCs: tr.edgeLabelCs,
          relationshipId: relId,
          relationshipClass: tr.relationship,
        });
      }
    }

    return [...found.values()].sort((a, b) =>
      entityLabel(a.entity).localeCompare(entityLabel(b.entity), "cs"),
    );
  }

  private async neighborsViaRel(
    entityId: string,
    relClassIri: string,
    direction: "model" | "inverse",
  ): Promise<Array<{ neighborId: string; relId: string }>> {
    const snap = this.schema.snapshot;
    const out: Array<{ neighborId: string; relId: string }> = [];

    // Find relationship entities that reference this entity as source or target
    const [asSource, asTarget] = await Promise.all([
      this.kc.getIncoming(entityId, snap.relSource),
      this.kc.getIncoming(entityId, snap.relTarget),
    ]);

    const candidateRels = [
      ...asSource.items.map((s) => ({ stmt: s, role: "source" as const })),
      ...asTarget.items.map((s) => ({ stmt: s, role: "target" as const })),
    ];

    for (const { stmt, role } of candidateRels) {
      const relEntityId = stmt.subject;
      const relEntity = await this.kc.getEntity(relEntityId);
      const classes = relEntity.effectiveClasses || [];
      const isType =
        classes.includes(relClassIri) ||
        (await this.entityIsInstanceOf(relEntityId, relClassIri));
      if (!isType) continue;

      const stmts = await this.kc.getStatements(relEntityId);
      const src = stmts.items.find((s) => s.property === snap.relSource);
      const tgt = stmts.items.find((s) => s.property === snap.relTarget);
      if (src?.value.type !== "EntityReference" || tgt?.value.type !== "EntityReference") {
        continue;
      }

      // model: follow source→target; if we are source, neighbor is target
      // inverse: navigate opposite — if we are target of Serving, neighbor is source
      if (direction === "model") {
        if (role === "source" && src.value.entityId === entityId) {
          out.push({ neighborId: tgt.value.entityId, relId: relEntityId });
        }
      } else {
        if (role === "target" && tgt.value.entityId === entityId) {
          out.push({ neighborId: src.value.entityId, relId: relEntityId });
        }
      }
    }
    return out;
  }

  private async entityIsInstanceOf(entityId: string, classIri: string): Promise<boolean> {
    const snap = this.schema.snapshot;
    const stmts = await this.kc.getStatements(entityId, snap.instanceOfProperty);
    return stmts.items.some(
      (s) => s.value.type === "EntityReference" && s.value.entityId === classIri,
    );
  }

  async resolveClassLocal(entity: Entity): Promise<string | undefined> {
    const snap = this.schema.snapshot;
    if (entity.effectiveClasses?.length) {
      for (const c of entity.effectiveClasses) {
        const local = snap.classIriToLocal.get(c);
        if (local && local !== "ArchiMateElement" && local !== "ArchiMateConcept") {
          return local;
        }
      }
    }
    const stmts = await this.kc.getStatements(entity.id, snap.instanceOfProperty);
    for (const s of stmts.items) {
      if (s.value.type === "EntityReference") {
        return snap.classIriToLocal.get(s.value.entityId);
      }
    }
    return undefined;
  }

  async readStringProp(entityId: string, propLocal: string): Promise<string | undefined> {
    const propIri = this.schema.tryPropertyIri(propLocal);
    if (!propIri) return undefined;
    const stmts = await this.kc.getStatements(entityId, propIri);
    const v = stmts.items[0]?.value;
    return v?.type === "String" ? v.string : undefined;
  }

  async loadAllStatements(entityId: string): Promise<Statement[]> {
    const res = await this.kc.getStatements(entityId);
    return res.items;
  }

  async loadPropertyStatements(entityId: string, propLocal: string): Promise<Statement[]> {
    const propIri = this.schema.tryPropertyIri(propLocal);
    if (!propIri) return [];
    const res = await this.kc.getStatements(entityId, propIri);
    return res.items;
  }
}
