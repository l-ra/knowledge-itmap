import { entityLabel, type SchemaResolver } from "../kc/schema";
import type { PropertyEntity, Statement, StatementValue, ValueType } from "../kc/types";

/** Structural properties that must not be edited in the inspector. */
export const READONLY_PROPERTY_LOCALS = new Set([
  "instanceOf",
  "relSource",
  "relTarget",
]);

export interface PropertyEditRules {
  minCount: number;
  maxCount: number | null;
  enumValues: string[];
  appliesToClass: boolean;
  datatype: ValueType;
  /** Class locals allowed as EntityReference targets (empty = unrestricted). */
  rangeClassLocals: string[];
}

export interface PropertyValueGroup {
  propertyLocal: string;
  propertyIri: string;
  propertyLabel: string;
  statements: Statement[];
  rules: PropertyEditRules;
  readonly: boolean;
}

export interface PropertySearchHit {
  propertyLocal: string;
  propertyIri: string;
  label: string;
  datatype: ValueType;
  rules: PropertyEditRules;
}

export function stringFromValue(v: StatementValue | undefined): string {
  if (!v) return "";
  switch (v.type) {
    case "String":
      return v.string;
    case "Boolean":
      return String(v.bool);
    case "Integer":
      return String(v.int64);
    case "URI":
      return v.uri;
    case "EntityReference":
      return v.entityId;
    case "LocalizedString":
      return v.langMap.cs || v.langMap.en || "";
    default:
      return JSON.stringify(v);
  }
}

export function stringValuesEqual(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

export function propertyEditRules(
  schema: SchemaResolver,
  propertyLocal: string,
  classLocal?: string,
): PropertyEditRules {
  const prop = schema.snapshot.propertiesByLocal.get(propertyLocal);
  const constraints = prop?.constraints;
  return {
    minCount: constraints?.minCount ?? 0,
    maxCount: constraints?.maxCount ?? null,
    enumValues: schema.enumValues(propertyLocal),
    appliesToClass: propertyAppliesToClass(schema, prop, classLocal),
    datatype: prop?.datatype ?? "String",
    rangeClassLocals: rangeClassLocals(schema, prop),
  };
}

export function rangeClassLocals(
  schema: SchemaResolver,
  prop: PropertyEntity | undefined,
): string[] {
  const ranges = prop?.constraints?.rangeClasses ?? [];
  const out: string[] = [];
  for (const r of ranges) {
    const local =
      schema.snapshot.classIriToLocal.get(r) ||
      (r.includes("/") ? r.slice(r.lastIndexOf("/") + 1) : r);
    if (local && !out.includes(local)) out.push(local);
  }
  return out;
}

/** Search schema properties by label (cs/en) or iriLocal. */
export function searchSchemaProperties(
  schema: SchemaResolver,
  query: string,
  opts?: { classLocal?: string; excludeLocals?: Iterable<string>; limit?: number },
): PropertySearchHit[] {
  const needle = query.trim().toLocaleLowerCase("cs");
  const exclude = new Set(opts?.excludeLocals ?? []);
  const limit = opts?.limit ?? 20;
  const hits: PropertySearchHit[] = [];

  for (const [local, prop] of schema.snapshot.propertiesByLocal) {
    if (exclude.has(local) || READONLY_PROPERTY_LOCALS.has(local)) continue;
    const rules = propertyEditRules(schema, local, opts?.classLocal);
    if (!rules.appliesToClass) continue;

    const label = entityLabel(prop);
    if (needle) {
      const hay = `${local} ${label} ${prop.labels?.en || ""}`.toLocaleLowerCase("cs");
      if (!hay.includes(needle)) continue;
    }

    hits.push({
      propertyLocal: local,
      propertyIri: prop.id,
      label,
      datatype: prop.datatype,
      rules,
    });
  }

  hits.sort((a, b) => a.label.localeCompare(b.label, "cs"));
  return hits.slice(0, limit);
}

export function statementValueFromInput(
  rules: PropertyEditRules,
  raw: string,
): StatementValue {
  const trimmed = raw.trim();
  if (rules.datatype === "EntityReference") {
    return { type: "EntityReference", entityId: trimmed };
  }
  if (rules.datatype === "Boolean") {
    return { type: "Boolean", bool: trimmed === "true" || trimmed === "1" };
  }
  if (rules.datatype === "Integer") {
    const n = Number.parseInt(trimmed, 10);
    return { type: "Integer", int64: Number.isFinite(n) ? n : 0 };
  }
  if (rules.datatype === "URI") {
    return { type: "URI", uri: trimmed };
  }
  return { type: "String", string: trimmed };
}

export function propertyAppliesToClass(
  schema: SchemaResolver,
  prop: PropertyEntity | undefined,
  classLocal?: string,
): boolean {
  if (!classLocal || !prop?.constraints?.domainClasses?.length) return true;
  const cls = schema.snapshot.classesByLocal.get(classLocal);
  if (!cls) return false;
  const ids = new Set([cls.id, cls.iri].filter(Boolean) as string[]);
  return prop.constraints.domainClasses.some(
    (dc) => ids.has(dc) || dc.endsWith(`/${classLocal}`),
  );
}

export function canRemoveValue(rules: PropertyEditRules, currentCount: number): boolean {
  return currentCount - 1 >= rules.minCount;
}

export function canAddValue(rules: PropertyEditRules, currentCount: number): boolean {
  if (rules.maxCount === null) return true;
  return currentCount < rules.maxCount;
}

export function groupStatementsByProperty(
  schema: SchemaResolver,
  statements: Statement[],
  classLocal?: string,
): PropertyValueGroup[] {
  const byProp = new Map<string, Statement[]>();
  for (const st of statements) {
    const pl = schema.propertyLocal(st.property) || st.property;
    const list = byProp.get(pl) || [];
    list.push(st);
    byProp.set(pl, list);
  }

  return [...byProp.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "cs"))
    .map(([propertyLocal, stmts]) => {
      const prop = schema.snapshot.propertiesByLocal.get(propertyLocal);
      return {
        propertyLocal,
        propertyIri: stmts[0]!.property,
        propertyLabel: prop ? entityLabel(prop) : propertyLocal,
        statements: stmts,
        rules: propertyEditRules(schema, propertyLocal, classLocal),
        readonly: READONLY_PROPERTY_LOCALS.has(propertyLocal),
      };
    });
}
