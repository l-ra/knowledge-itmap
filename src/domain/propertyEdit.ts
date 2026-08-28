import type { SchemaResolver } from "../kc/schema";
import type { PropertyEntity, Statement, StatementValue } from "../kc/types";

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
}

export interface PropertyValueGroup {
  propertyLocal: string;
  propertyIri: string;
  statements: Statement[];
  rules: PropertyEditRules;
  readonly: boolean;
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
  };
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
    .map(([propertyLocal, stmts]) => ({
      propertyLocal,
      propertyIri: stmts[0]!.property,
      statements: stmts,
      rules: propertyEditRules(schema, propertyLocal, classLocal),
      readonly: READONLY_PROPERTY_LOCALS.has(propertyLocal),
    }));
}
