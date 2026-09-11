import type { ModelService, CreateResult, ModelAddAction } from "../modelService";
import type { SchemaResolver } from "../schema";
import type { RelationSlotDef, SlotDirection } from "./types";

export type ModelRelDirection = "from-selected-to-new" | "from-new-to-selected";

export interface ResolvedEndpoints {
  sourceId: string;
  targetId: string;
  /** ModelService relationshipDirection when selected = subject, new/linked = neighbor. */
  modelDirection: ModelRelDirection;
}

/** One AllowedRelationship row from the subject's perspective. */
export interface AllowedEdgeOption {
  typeLocal: string;
  direction: SlotDirection;
  otherClassLocal: string;
  /** Short UI label: type · otherClass · směr */
  label: string;
}

export function resolveSlotEndpoints(
  subjectId: string,
  neighborId: string,
  direction: SlotDirection,
): ResolvedEndpoints {
  if (direction === "incoming") {
    return {
      sourceId: neighborId,
      targetId: subjectId,
      modelDirection: "from-new-to-selected",
    };
  }
  return {
    sourceId: subjectId,
    targetId: neighborId,
    modelDirection: "from-selected-to-new",
  };
}

export function listAllowedForSubject(
  schema: SchemaResolver,
  classLocal: string,
): AllowedEdgeOption[] {
  const out: AllowedEdgeOption[] = [];
  for (const row of schema.snapshot.allowed) {
    if (row.sourceLocal === classLocal) {
      out.push({
        typeLocal: row.typeLocal,
        direction: "outgoing",
        otherClassLocal: row.targetLocal,
        label: `${schema.classLabel(row.typeLocal)} → ${schema.classLabel(row.targetLocal)}`,
      });
    }
    if (row.targetLocal === classLocal) {
      out.push({
        typeLocal: row.typeLocal,
        direction: "incoming",
        otherClassLocal: row.sourceLocal,
        label: `${schema.classLabel(row.sourceLocal)} → ${schema.classLabel(row.typeLocal)}`,
      });
    }
  }
  out.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === "outgoing" ? -1 : 1;
    return (
      a.typeLocal.localeCompare(b.typeLocal) ||
      a.otherClassLocal.localeCompare(b.otherClassLocal)
    );
  });
  return out;
}

/** Pick create class from slot targetClasses (or explicit override). */
export function pickCreateClass(
  targetClasses: string[],
  explicit?: string,
): string {
  if (explicit?.trim()) return explicit.trim();
  if (targetClasses.length === 1) return targetClasses[0];
  if (targetClasses.length === 0) {
    throw new Error("Vyberte třídu nové entity (slot nemá targetClasses).");
  }
  throw new Error("Vyberte třídu nové entity — slot má více cílových tříd.");
}

export function modelActionForEdge(opts: {
  createsClass: string;
  relationshipType: string;
  direction: SlotDirection;
  relationshipDefaults?: Record<string, string>;
  elementDefaults?: Record<string, string>;
}): ModelAddAction {
  const endpoints = resolveSlotEndpoints("subject", "neighbor", opts.direction);
  return {
    createsClass: opts.createsClass,
    defaults: opts.elementDefaults,
    derivesRelationship: opts.relationshipType,
    relationshipDirection: endpoints.modelDirection,
    relationshipDefaults: opts.relationshipDefaults,
  };
}

export type SlotNeighborLinkInput = {
  packageCode: string;
  subjectId: string;
  subjectClassLocal: string;
  slot: RelationSlotDef;
  neighborId: string;
  relExtras?: Record<string, string>;
};

export type SlotNeighborCreateInput = {
  packageCode: string;
  subjectId: string;
  subjectClassLocal: string;
  slot: RelationSlotDef;
  name: string;
  descriptions?: Record<string, string>;
  createClassLocal?: string;
  elementDefaults?: Record<string, string>;
  relExtras?: Record<string, string>;
};

export type ExpertNeighborLinkInput = {
  packageCode: string;
  subjectId: string;
  subjectClassLocal: string;
  typeLocal: string;
  direction: SlotDirection;
  otherClassLocal: string;
  neighborId: string;
  relExtras?: Record<string, string>;
};

export type ExpertNeighborCreateInput = {
  packageCode: string;
  subjectId: string;
  subjectClassLocal: string;
  typeLocal: string;
  direction: SlotDirection;
  otherClassLocal: string;
  name: string;
  descriptions?: Record<string, string>;
  elementDefaults?: Record<string, string>;
  relExtras?: Record<string, string>;
};

function mergeRelProps(
  defaults: Record<string, string> | undefined,
  extras: Record<string, string> | undefined,
): Record<string, string> {
  return { ...(defaults || {}), ...(extras || {}) };
}

export async function addSlotNeighborLink(
  model: ModelService,
  input: SlotNeighborLinkInput,
): Promise<CreateResult> {
  const action = modelActionForEdge({
    createsClass: input.subjectClassLocal,
    relationshipType: input.slot.relationshipType,
    direction: input.slot.direction,
    relationshipDefaults: mergeRelProps(input.slot.relationshipDefaults, input.relExtras),
  });
  return model.linkElement({
    packageCode: input.packageCode,
    action,
    existingEntityId: input.neighborId,
    selectedId: input.subjectId,
    extraProps: input.relExtras,
    flowLabel: input.relExtras?.flowLabel,
  });
}

export async function addSlotNeighborCreate(
  model: ModelService,
  input: SlotNeighborCreateInput,
): Promise<CreateResult> {
  const createClass = pickCreateClass(input.slot.targetClasses, input.createClassLocal);
  const link = resolveSlotEndpoints(input.subjectId, "new", input.slot.direction);
  return model.createTypedElement({
    packageCode: input.packageCode,
    classLocal: createClass,
    name: input.name,
    descriptions: input.descriptions,
    extraProps: input.elementDefaults,
    link: {
      typeLocal: input.slot.relationshipType,
      otherId: input.subjectId,
      direction: link.modelDirection,
      props: mergeRelProps(input.slot.relationshipDefaults, input.relExtras),
    },
  });
}

export async function addExpertNeighborLink(
  model: ModelService,
  input: ExpertNeighborLinkInput,
): Promise<CreateResult> {
  const action = modelActionForEdge({
    createsClass: input.otherClassLocal,
    relationshipType: input.typeLocal,
    direction: input.direction,
    relationshipDefaults: input.relExtras,
  });
  return model.linkElement({
    packageCode: input.packageCode,
    action,
    existingEntityId: input.neighborId,
    selectedId: input.subjectId,
    extraProps: input.relExtras,
    flowLabel: input.relExtras?.flowLabel,
  });
}

export async function addExpertNeighborCreate(
  model: ModelService,
  input: ExpertNeighborCreateInput,
): Promise<CreateResult> {
  const link = resolveSlotEndpoints(input.subjectId, "new", input.direction);
  return model.createTypedElement({
    packageCode: input.packageCode,
    classLocal: input.otherClassLocal,
    name: input.name,
    descriptions: input.descriptions,
    extraProps: input.elementDefaults,
    link: {
      typeLocal: input.typeLocal,
      otherId: input.subjectId,
      direction: link.modelDirection,
      props: input.relExtras,
    },
  });
}
