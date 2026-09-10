import type { Entity, Statement, StatementValue } from "../types";
import { mostSpecificClassLocal } from "../openExchange/typeMap";
import type { PresentationProfileDef } from "./types";

/** Stringify a KC statement value for profile matching / field display. */
export function statementToString(v: StatementValue | undefined): string | undefined {
  if (!v) return undefined;
  if (v.type === "String") return v.string;
  if (v.type === "LocalizedString") return v.langMap.cs || v.langMap.en;
  return undefined;
}

export function classLocalFromEffective(
  entity: Entity,
  classIriToLocal: Map<string, string>,
): string | undefined {
  if (!entity.effectiveClasses?.length) return undefined;
  const locals: string[] = [];
  for (const c of entity.effectiveClasses) {
    const local = classIriToLocal.get(c);
    if (local) locals.push(local);
  }
  return mostSpecificClassLocal(locals);
}

export function classLocalFromStatements(
  stmts: Statement[],
  instanceOfProperty: string,
  classIriToLocal: Map<string, string>,
): string | undefined {
  const locals: string[] = [];
  for (const s of stmts) {
    if (s.property !== instanceOfProperty) continue;
    if (s.value.type !== "EntityReference") continue;
    const local = classIriToLocal.get(s.value.entityId);
    if (local) locals.push(local);
  }
  return mostSpecificClassLocal(locals);
}

/** Prefer direct instanceOf when statements are present; else effectiveClasses. */
export function resolveClassLocalFromEmbeds(
  entity: Entity,
  stmts: Statement[] | undefined | null,
  instanceOfProperty: string,
  classIriToLocal: Map<string, string>,
): string | undefined {
  if (stmts) {
    const fromStmts = classLocalFromStatements(stmts, instanceOfProperty, classIriToLocal);
    if (fromStmts) return fromStmts;
  }
  return classLocalFromEffective(entity, classIriToLocal);
}

/** True when any profile for this class has non-empty matchProperties. */
export function classNeedsMatchProps(
  profiles: PresentationProfileDef[],
  classLocal: string,
): boolean {
  return profiles.some(
    (p) =>
      p.archimateElementType === classLocal && Object.keys(p.matchProperties).length > 0,
  );
}

/** Union of matchProperty keys for profiles of this class (hub resolve only). */
export function matchKeysForClass(
  profiles: PresentationProfileDef[],
  classLocal: string,
): Set<string> {
  const keys = new Set<string>();
  for (const p of profiles) {
    if (p.archimateElementType !== classLocal) continue;
    for (const k of Object.keys(p.matchProperties)) keys.add(k);
  }
  return keys;
}

/** Interesting keys for card detail (match + fields + common actor props). */
export function interestingKeysForClass(
  profiles: PresentationProfileDef[],
  classLocal: string,
): Set<string> {
  const keys = matchKeysForClass(profiles, classLocal);
  for (const p of profiles) {
    if (p.archimateElementType !== classLocal) continue;
    for (const k of p.fieldProperties) keys.add(k);
  }
  keys.add("actorKind");
  keys.add("organizationScope");
  return keys;
}

export function propMapFromStatements(
  stmts: Statement[],
  keys: Set<string>,
  propertyLocal: (iri: string) => string | undefined,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) out[k] = undefined;
  for (const s of stmts) {
    const local = propertyLocal(s.property);
    if (!local || !keys.has(local)) continue;
    if (out[local] !== undefined) continue;
    out[local] = statementToString(s.value);
  }
  return out;
}
