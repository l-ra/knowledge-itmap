import type { SchemaResolver } from "../kc/schema";
import type { ArchiClassLocal, RelClassLocal } from "../kc/types";
import type {
  TemplateBundle,
  ValidationIssue,
} from "./navigationProfileTypes";
import type {
  AddActionDef,
  StageDef,
  TraversalTemplate,
  TransitionDef,
} from "./templates";

const ACTOR_KINDS = new Set(["person", "organizationalUnit", "organization"]);

function asArchiClass(local: string): ArchiClassLocal | null {
  if (!local || local.startsWith("Ui") || local.startsWith("ArchiMate")) return null;
  return local as ArchiClassLocal;
}

function asRelClass(local: string): RelClassLocal | null {
  if (!local) return null;
  return local as RelClassLocal;
}

export function mapTemplateBundle(
  bundle: TemplateBundle,
  schema: SchemaResolver,
): { template: TraversalTemplate | null; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const stageById = new Map(bundle.stages.map((s) => [s.id, s]));
  const stageCodeById = new Map(bundle.stages.map((s) => [s.id, s.stageCode]));

  const stages: StageDef[] = [];
  for (const stage of [...bundle.stages].sort((a, b) => a.stageOrder - b.stageOrder)) {
    const classes: ArchiClassLocal[] = [];
    for (const local of stage.targetClassLocals) {
      const archi = asArchiClass(local);
      if (!archi) {
        issues.push({
          severity: "warning",
          code: "unknown-target-class",
          message: `Stage ${stage.stageCode}: neznámá třída ${local}`,
          entityId: stage.id,
        });
        continue;
      }
      if (!schema.snapshot.classesByLocal.has(archi)) {
        issues.push({
          severity: "warning",
          code: "missing-class",
          message: `Stage ${stage.stageCode}: třída ${local} není v metamodelu`,
          entityId: stage.id,
        });
        continue;
      }
      classes.push(archi);
    }
    if (!classes.length) {
      issues.push({
        severity: "error",
        code: "empty-stage",
        message: `Stage ${stage.stageCode} nemá platné targetClasses`,
        entityId: stage.id,
      });
      continue;
    }

    const actorKinds = stage.actorKinds?.filter(
      (k): k is "person" | "organizationalUnit" | "organization" => ACTOR_KINDS.has(k),
    );

    const filterProp = stage.instanceFilter
      ? Object.entries(stage.instanceFilter)[0]
      : undefined;

    stages.push({
      code: stage.stageCode,
      labelCs: stage.columnLabelCs || stage.stageCode,
      classes,
      ...(actorKinds?.length ? { actorKinds } : {}),
      ...(filterProp
        ? { filter: { property: filterProp[0], value: filterProp[1] } }
        : {}),
    });
  }

  const transitions: TransitionDef[] = [];
  for (const tr of bundle.transitions) {
    const fromCode = stageCodeById.get(tr.fromStageId);
    const toCode = stageCodeById.get(tr.toStageId);
    if (!fromCode || !toCode) {
      issues.push({
        severity: "error",
        code: "broken-transition",
        message: `Transition: neplatný from/to stage`,
        entityId: tr.id,
      });
      continue;
    }
    const rel = asRelClass(tr.relationshipClassLocal);
    if (!rel || !schema.snapshot.classesByLocal.has(rel)) {
      issues.push({
        severity: "warning",
        code: "unknown-relationship",
        message: `Transition ${fromCode}→${toCode}: neznámý vztah ${tr.relationshipClassLocal}`,
        entityId: tr.id,
      });
      continue;
    }
    if (tr.traverseDirection !== "model" && tr.traverseDirection !== "inverse") {
      issues.push({
        severity: "error",
        code: "invalid-direction",
        message: `Transition ${fromCode}→${toCode}: neplatný traverseDirection`,
        entityId: tr.id,
      });
      continue;
    }
    transitions.push({
      from: fromCode,
      to: toCode,
      relationship: rel,
      direction: tr.traverseDirection,
      edgeLabelCs: tr.uiEdgeLabelCs || rel,
      ...(tr.requireProperty ? { requireProperty: tr.requireProperty } : {}),
    });
  }

  const addActions: AddActionDef[] = [];
  for (const act of bundle.addActions) {
    const stage = stageById.get(act.stageId);
    if (!stage) {
      issues.push({
        severity: "error",
        code: "broken-add-action",
        message: `Add action ${act.actionCode}: neplatný stage`,
        entityId: act.id,
      });
      continue;
    }
    const creates = asArchiClass(act.createsClassLocal);
    if (!creates) {
      issues.push({
        severity: "error",
        code: "invalid-creates-class",
        message: `Add action ${act.actionCode}: neplatná createsClass`,
        entityId: act.id,
      });
      continue;
    }
    const derives = act.derivesRelationship
      ? asRelClass(act.derivesRelationship)
      : undefined;
    addActions.push({
      stage: stage.stageCode,
      code: act.actionCode,
      labelCs: act.domainLabelCs || act.actionCode,
      createsClass: creates,
      ...(act.defaultProperties ? { defaults: act.defaultProperties } : {}),
      ...(derives ? { derivesRelationship: derives } : {}),
      ...(act.relationshipDirection
        ? { relationshipDirection: act.relationshipDirection }
        : {}),
      ...(act.relationshipDefaults
        ? { relationshipDefaults: act.relationshipDefaults }
        : {}),
    });
  }

  if (!stages.length) {
    return {
      template: null,
      issues: [
        ...issues,
        {
          severity: "error",
          code: "no-stages",
          message: `Šablona ${bundle.meta.templateCode} nemá žádné platné stages`,
          entityId: bundle.meta.id,
        },
      ],
    };
  }

  const template: TraversalTemplate = {
    code: bundle.meta.templateCode,
    labelCs: bundle.meta.labelCs || bundle.meta.templateCode,
    ...(bundle.meta.isDefault ? { isDefault: true } : {}),
    stages,
    transitions,
    addActions,
  };

  return { template, issues };
}

export function compareStageOrders(stages: StageDef[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const orders = stages.map((_, i) => i + 1);
  // informational only — KC stageOrder already applied
  void orders;
  return issues;
}
