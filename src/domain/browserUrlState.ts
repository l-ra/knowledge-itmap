import { getKc } from "@/kc/client";
import { entityLabel } from "@/kc/schema";
import type { ColumnState, FocusStep } from "./traversal";
import { TraversalEngine } from "./traversal";
import {
  createEmptyFlow,
  nextFlowId,
  resetFlowIdCounter,
  type BrowserSession,
  type InspectTarget,
  type NavigationFlow,
} from "./navigationFlows";

/** Serializable focus step (no label — resolved on hydrate). */
export interface SerializedFocusStep {
  entityId: string;
  stageCode: string;
  classLocal: string;
}

export interface SerializedFlow {
  id: string;
  templateCode: string;
  focus: SerializedFocusStep[];
  hiddenStages?: string[];
  collapsed?: boolean;
}

export interface SerializedBrowserState {
  orgPackage?: string;
  activeFlowId: string;
  flows: SerializedFlow[];
  inspectTarget?: InspectTarget;
}

const FLOW_PARAM_PREFIX = "f";

export function parseBrowserStateFromSearchParams(
  params: URLSearchParams,
): SerializedBrowserState | null {
  const flowEntries: Array<{ id: string; raw: string }> = [];
  for (const [key, value] of params.entries()) {
    if (key.startsWith(FLOW_PARAM_PREFIX) && key.length > 1) {
      flowEntries.push({ id: key.slice(1), raw: value });
    }
  }
  if (flowEntries.length === 0) return null;

  flowEntries.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const flows: SerializedFlow[] = flowEntries.map(({ id, raw }) => parseFlowParam(id, raw));
  const activeFlowId = params.get("active") || flows[0]?.id || "f1";

  const inspectRaw = params.get("inspect");
  let inspectTarget: InspectTarget | undefined;
  if (inspectRaw) {
    const parsed = parseInspectParam(inspectRaw);
    if (parsed) inspectTarget = parsed;
  }

  return {
    orgPackage: params.get("pkg") || undefined,
    activeFlowId,
    flows,
    inspectTarget,
  };
}

function parseFlowParam(id: string, raw: string): SerializedFlow {
  const parts = raw.split(";");
  let templateCode = "business-exploration";
  const focus: SerializedFocusStep[] = [];
  let hiddenStages: string[] = [];

  for (const part of parts) {
    if (part.startsWith("t:")) {
      templateCode = decodeURIComponent(part.slice(2));
    } else if (part.startsWith("e:")) {
      const segments = part.slice(2).split("/");
      if (segments.length >= 3) {
        focus.push({
          entityId: decodeURIComponent(segments[0]),
          stageCode: decodeURIComponent(segments[1]),
          classLocal: decodeURIComponent(segments[2]),
        });
      }
    } else if (part.startsWith("h:")) {
      hiddenStages = part
        .slice(2)
        .split(",")
        .filter(Boolean)
        .map((s) => decodeURIComponent(s));
    } else if (part === "c") {
      /* collapsed flag handled below */
    }
  }

  return {
    id,
    templateCode,
    focus,
    hiddenStages,
    collapsed: raw.includes(";c"),
  };
}

function parseInspectParam(raw: string): InspectTarget | null {
  const segments = raw.split("/");
  if (segments.length < 2) return null;
  return {
    entityId: decodeURIComponent(segments[0]),
    classLocal: decodeURIComponent(segments[1]),
  };
}

export function serializeFlowToParam(flow: NavigationFlow): string {
  const parts = [`t:${encodeURIComponent(flow.templateCode)}`];
  for (const step of flow.focus) {
    parts.push(
      `e:${encodeURIComponent(step.entityId)}/${encodeURIComponent(step.stageCode)}/${encodeURIComponent(step.classLocal)}`,
    );
  }
  if (flow.hiddenStages.length > 0) {
    parts.push(`h:${flow.hiddenStages.map(encodeURIComponent).join(",")}`);
  }
  if (flow.collapsed) parts.push("c");
  return parts.join(";");
}

export function browserSessionToSearchParams(session: BrowserSession): URLSearchParams {
  const params = new URLSearchParams();
  params.set("pkg", session.orgPackage);
  params.set("active", session.activeFlowId);
  for (const flow of session.flows) {
    params.set(`${FLOW_PARAM_PREFIX}${flow.id}`, serializeFlowToParam(flow));
  }
  if (session.inspectTarget) {
    params.set(
      "inspect",
      `${encodeURIComponent(session.inspectTarget.entityId)}/${encodeURIComponent(session.inspectTarget.classLocal)}`,
    );
  }
  return params;
}

export async function hydrateFocusPath(
  engine: TraversalEngine,
  steps: SerializedFocusStep[],
): Promise<FocusStep[]> {
  const result: FocusStep[] = [];
  for (const step of steps) {
    try {
      const entity = await getKc().getEntity(step.entityId);
      const classLocal =
        step.classLocal || (await engine.resolveClassLocal(entity)) || step.classLocal;
      result.push({
        entityId: step.entityId,
        label: entityLabel(entity),
        stageCode: step.stageCode,
        classLocal,
      });
    } catch {
      break;
    }
  }
  return result;
}

export async function hydrateBrowserSession(
  serialized: SerializedBrowserState,
  orgPackage: string,
  engine: TraversalEngine,
  resolveTemplate: (code: string) => import("./templates").TraversalTemplate,
): Promise<BrowserSession> {
  resetFlowIdCounter(0);
  let maxFlowNum = 0;
  for (const sf of serialized.flows) {
    const num = parseInt(sf.id.replace(/^f/, ""), 10);
    if (!Number.isNaN(num)) maxFlowNum = Math.max(maxFlowNum, num);
  }
  resetFlowIdCounter(maxFlowNum);

  const flows: NavigationFlow[] = [];
  for (const sf of serialized.flows) {
    const focus = await hydrateFocusPath(engine, sf.focus);
    const template = resolveTemplate(sf.templateCode);
    let columns: ColumnState[];
    try {
      columns = await engine.expandPath(orgPackage, template, focus, {
        hiddenStages: sf.hiddenStages ?? [],
      });
    } catch {
      columns = [];
    }
    let selected: NavigationFlow["selected"] = null;
    const last = focus[focus.length - 1];
    if (last) {
      try {
        const ent = await getKc().getEntity(last.entityId);
        selected = { entity: ent, classLocal: last.classLocal };
      } catch {
        /* ignore */
      }
    }
    flows.push({
      id: sf.id || nextFlowId(),
      templateCode: sf.templateCode,
      focus,
      columns,
      selected,
      collapsed: sf.collapsed ?? false,
      hiddenStages: sf.hiddenStages ?? [],
    });
  }

  if (flows.length === 0) {
    const empty = createEmptyFlow("business-exploration");
    flows.push(empty);
  }

  const activeFlowId = flows.some((f) => f.id === serialized.activeFlowId)
    ? serialized.activeFlowId
    : flows[0].id;

  return {
    orgPackage,
    flows,
    activeFlowId,
    inspectTarget: serialized.inspectTarget ?? null,
  };
}
