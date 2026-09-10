import type { SchemaResolver } from "../schema";
import type { ImportWarning } from "./types";

const VIEW_LOCALS = new Set(["DiagramView", "ViewNode", "ViewConnection", "ArchiMateViewConcept"]);
const META_LOCALS = new Set([
  "ArchiMateLiteMeta",
  "AllowedRelationship",
  "ExchangeSpec",
  "ArchiMateConcept",
  "ArchiMateElement",
  "ArchiMateRelationship",
  "ExchangeForeignElement",
  "ExchangeForeignRelationship",
]);

const RELATIONSHIP_LOCALS = new Set([
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
]);

export type ResolvedElementType = {
  classLocal: string;
  classIri: string;
  foreign: boolean;
  exchangeXsiType?: string;
};

export type ResolvedRelationshipType = {
  classLocal: string;
  classIri: string;
  foreign: boolean;
  exchangeXsiType: string;
};

export function knownElementXsiTypes(schema: SchemaResolver): Set<string> {
  const out = new Set<string>();
  for (const local of schema.snapshot.classesByLocal.keys()) {
    if (META_LOCALS.has(local) || VIEW_LOCALS.has(local) || RELATIONSHIP_LOCALS.has(local)) continue;
    out.add(local);
  }
  return out;
}

export function knownRelationshipXsiTypes(schema: SchemaResolver): Map<string, string> {
  const map = new Map<string, string>();
  for (const local of RELATIONSHIP_LOCALS) {
    if (local === "DeployedOn") continue;
    if (schema.snapshot.classesByLocal.has(local)) map.set(local, local);
  }
  return map;
}

export function resolveElementType(
  schema: SchemaResolver,
  xsiType: string,
  warnings: ImportWarning[],
  identifier?: string,
): ResolvedElementType {
  const elements = knownElementXsiTypes(schema);
  if (elements.has(xsiType) && schema.snapshot.classesByLocal.has(xsiType)) {
    return { classLocal: xsiType, classIri: schema.classIri(xsiType), foreign: false };
  }
  warnings.push({
    level: "warning",
    code: "foreign_element",
    message: `Unknown element xsi:type "${xsiType}" → ExchangeForeignElement`,
    identifier,
  });
  return {
    classLocal: "ExchangeForeignElement",
    classIri: schema.classIri("ExchangeForeignElement"),
    foreign: true,
    exchangeXsiType: xsiType,
  };
}

export function resolveRelationshipType(
  schema: SchemaResolver,
  xsiType: string,
  warnings: ImportWarning[],
  identifier?: string,
): ResolvedRelationshipType {
  const map = knownRelationshipXsiTypes(schema);
  const local = map.get(xsiType);
  if (local) {
    return {
      classLocal: local,
      classIri: schema.classIri(local),
      foreign: false,
      exchangeXsiType: xsiType,
    };
  }
  warnings.push({
    level: "warning",
    code: "foreign_relationship",
    message: `Unknown relationship xsi:type "${xsiType}" → ExchangeForeignRelationship`,
    identifier,
  });
  return {
    classLocal: "ExchangeForeignRelationship",
    classIri: schema.classIri("ExchangeForeignRelationship"),
    foreign: true,
    exchangeXsiType: xsiType,
  };
}

/** Map KC class local → Exchange xsi:type for export. */
export function exportXsiType(opts: {
  classLocal: string;
  exchangeXsiTypeStmt?: string;
}): string {
  if (opts.exchangeXsiTypeStmt) return opts.exchangeXsiTypeStmt;
  if (opts.classLocal === "ExchangeForeignElement" || opts.classLocal === "ExchangeForeignRelationship") {
    return "Unknown";
  }
  if (opts.classLocal === "DeployedOn") return "Assignment";
  if (opts.classLocal === "DiagramView") return "Diagram";
  if (opts.classLocal === "ViewNode") return "Element";
  if (opts.classLocal === "ViewConnection") return "Relationship";
  return opts.classLocal;
}

export function archiLayerFolderName(layer: string | undefined): string {
  switch (layer) {
    case "business":
      return "Business";
    case "application":
      return "Application";
    case "technology":
    case "physical":
      return "Technology & Physical";
    case "motivation":
      return "Motivation";
    case "strategy":
      return "Strategy";
    case "implementation":
      return "Implementation & Migration";
    default:
      return "Other";
  }
}

export function isRelationshipClassLocal(local: string): boolean {
  return RELATIONSHIP_LOCALS.has(local) || local === "ExchangeForeignRelationship";
}

export function isViewClassLocal(local: string): boolean {
  return VIEW_LOCALS.has(local);
}

/** Abstract / layer roots — never prefer these over a concrete subclass. */
const ABSTRACT_ARCHIMATE_CLASS_LOCALS = new Set([
  "ArchiMateConcept",
  "ArchiMateElement",
  "ArchiMateRelationship",
  "ArchiMateViewConcept",
  "ArchiMateLiteMeta",
]);

export function isAbstractArchimateClassLocal(local: string): boolean {
  return ABSTRACT_ARCHIMATE_CLASS_LOCALS.has(local);
}

/**
 * Prefer a concrete ArchiMate class over abstract ancestors.
 * `effectiveClasses` is an unordered ancestor closure, so the first mapped
 * local is often ArchiMateConcept / ArchiMateElement.
 */
export function mostSpecificClassLocal(locals: Iterable<string>): string | undefined {
  let fallback: string | undefined;
  for (const local of locals) {
    if (!local) continue;
    if (!isAbstractArchimateClassLocal(local)) return local;
    if (!fallback) fallback = local;
  }
  return fallback;
}
