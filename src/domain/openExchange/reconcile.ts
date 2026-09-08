import type { Entity } from "@/kc/types";
import { isExchangeManagedAlias } from "./identity";
import type { OrphanCandidate } from "./types";

function entityLabel(e: Entity): string {
  return e.labels?.cs || e.labels?.en || e.iriLocal || e.id;
}

function classifyKind(
  classLocal: string | undefined,
): OrphanCandidate["kind"] {
  if (!classLocal) return "other";
  if (classLocal === "DiagramView") return "view";
  if (classLocal === "ViewNode") return "viewNode";
  if (classLocal === "ViewConnection") return "viewConnection";
  if (
    classLocal === "ExchangeForeignRelationship" ||
    [
      "Composition",
      "Aggregation",
      "Assignment",
      "Realization",
      "Serving",
      "Access",
      "Flow",
      "Triggering",
      "Specialization",
      "Association",
      "Influence",
      "DeployedOn",
    ].includes(classLocal)
  ) {
    return "relationship";
  }
  if (classLocal === "ExchangeForeignElement" || classLocal) return "element";
  return "other";
}

const KIND_ORDER: Record<OrphanCandidate["kind"], number> = {
  viewConnection: 0,
  viewNode: 1,
  relationship: 2,
  view: 3,
  element: 4,
  other: 5,
};

export function findOrphans(opts: {
  packageEntities: Entity[];
  xmlIdentifiers: Set<string>;
  classLocalOf: (entityId: string, effectiveClasses?: string[]) => string | undefined;
  exchangeManagedIds: Set<string>;
}): OrphanCandidate[] {
  const orphans: OrphanCandidate[] = [];
  for (const e of opts.packageEntities) {
    if (e.status && e.status !== "active") continue;
    if (e.iriLocal === ".package") continue;
    const iriLocal = e.iriLocal?.trim();
    if (!iriLocal) continue;
    if (opts.xmlIdentifiers.has(iriLocal)) continue;

    const managed =
      opts.exchangeManagedIds.has(e.id) || isExchangeManagedAlias(e.iriAliases);
    if (!managed) continue;

    const classLocal = opts.classLocalOf(e.id, e.effectiveClasses);
    orphans.push({
      entityId: e.id,
      iriLocal,
      label: entityLabel(e),
      kind: classifyKind(classLocal),
    });
  }
  orphans.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label));
  return orphans;
}
