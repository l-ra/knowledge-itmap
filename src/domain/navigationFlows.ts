import type { Entity } from "@/kc/types";
import type { ColumnState, FocusStep } from "./traversal";

let flowIdCounter = 0;

export function nextFlowId(): string {
  flowIdCounter += 1;
  return `f${flowIdCounter}`;
}

export function resetFlowIdCounter(maxNum = 0): void {
  flowIdCounter = maxNum;
}

export interface FlowSpawnOrigin {
  flowId: string;
  colIndex: number;
  entityId: string;
}

export interface NavigationFlow {
  id: string;
  templateCode: string;
  focus: FocusStep[];
  columns: ColumnState[];
  selected: { entity: Entity; classLocal: string } | null;
  collapsed: boolean;
  spawnedFrom?: FlowSpawnOrigin;
}

export interface InspectTarget {
  entityId: string;
  classLocal: string;
}

export interface BrowserSession {
  orgPackage: string;
  flows: NavigationFlow[];
  activeFlowId: string;
  inspectTarget: InspectTarget | null;
}

export function flowDisplayLabel(flow: NavigationFlow, orgPackageLabel: string): string {
  if (flow.focus.length === 0) return orgPackageLabel;
  return flow.focus.map((s) => s.label).join(" › ");
}

export function createEmptyFlow(templateCode: string, id?: string): NavigationFlow {
  return {
    id: id ?? nextFlowId(),
    templateCode,
    focus: [],
    columns: [],
    selected: null,
    collapsed: false,
  };
}

/** Insert new flow immediately below the active flow in the stack. */
export function insertFlowBelowActive(
  flows: NavigationFlow[],
  activeFlowId: string,
  newFlow: NavigationFlow,
): NavigationFlow[] {
  const activeIdx = flows.findIndex((f) => f.id === activeFlowId);
  if (activeIdx < 0) return [...flows, newFlow];
  const next = [...flows];
  next.splice(activeIdx + 1, 0, newFlow);
  return next;
}

/** Move flow to top of stack (promote). */
export function promoteFlow(flows: NavigationFlow[], flowId: string): NavigationFlow[] {
  const idx = flows.findIndex((f) => f.id === flowId);
  if (idx <= 0) return flows;
  const next = [...flows];
  const [flow] = next.splice(idx, 1);
  next.unshift(flow);
  return next;
}

export function removeFlow(
  flows: NavigationFlow[],
  flowId: string,
  defaultTemplateCode: string,
): { flows: NavigationFlow[]; activeFlowId: string } {
  if (flows.length <= 1) {
    const fresh = createEmptyFlow(defaultTemplateCode);
    return { flows: [fresh], activeFlowId: fresh.id };
  }
  const idx = flows.findIndex((f) => f.id === flowId);
  const next = flows.filter((f) => f.id !== flowId);
  const activeIdx = Math.max(0, idx - 1);
  return { flows: next, activeFlowId: next[activeIdx]?.id ?? next[0].id };
}

export function updateFlow(
  flows: NavigationFlow[],
  flowId: string,
  patch: Partial<NavigationFlow>,
): NavigationFlow[] {
  return flows.map((f) => (f.id === flowId ? { ...f, ...patch } : f));
}
