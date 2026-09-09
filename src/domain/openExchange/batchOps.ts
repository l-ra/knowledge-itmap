import type { ChangeOperation, Entity, LangMap } from "@/kc/types";
import { exchangeAliasIri } from "./identity";

/** Soft chunk size (KC hard limit is 500). */
export const OE_BATCH_CHUNK_SIZE = 250;

export function oxClientKey(identifier: string): string {
  return `$ox:${identifier}`;
}

export function entityRef(identifier: string, knownId?: string): string {
  return knownId || oxClientKey(identifier);
}

export type OpBuffer = {
  ops: ChangeOperation[];
  /** identifier → public entity id (filled after flush) */
  idMap: Map<string, string>;
};

export function createOpBuffer(existingByLocal: Map<string, Entity>): OpBuffer {
  const idMap = new Map<string, string>();
  for (const [local, e] of existingByLocal) {
    if (e.id) idMap.set(local, e.id);
  }
  return { ops: [], idMap };
}

export function pushEnsureEntity(
  buf: OpBuffer,
  packageCode: string,
  identifier: string,
  labels: LangMap,
  descriptions?: LangMap,
): { created: boolean } {
  const existing = buf.idMap.get(identifier);
  if (existing) {
    buf.ops.push({
      op: "updateEntity",
      entity: existing,
      labels,
      descriptions,
    });
    return { created: false };
  }
  buf.ops.push({
    op: "createEntity",
    clientKey: oxClientKey(identifier),
    packageCode,
    labels,
    descriptions,
    iriLocal: identifier,
  });
  return { created: true };
}

export function pushStringStatement(
  buf: OpBuffer,
  packageCode: string,
  subjectRef: string,
  property: string,
  value: string | undefined,
) {
  if (value == null || value === "") return;
  buf.ops.push({
    op: "createStatement",
    packageCode,
    subject: subjectRef,
    property,
    value: { type: "String", string: value },
    upsert: true,
  });
}

export function pushBoolStatement(
  buf: OpBuffer,
  packageCode: string,
  subjectRef: string,
  property: string,
  value: boolean,
) {
  buf.ops.push({
    op: "createStatement",
    packageCode,
    subject: subjectRef,
    property,
    value: { type: "Boolean", bool: value },
    upsert: true,
  });
}

export function pushRefStatement(
  buf: OpBuffer,
  packageCode: string,
  subjectRef: string,
  property: string,
  targetId: string | undefined,
) {
  if (!targetId) return;
  buf.ops.push({
    op: "createStatement",
    packageCode,
    subject: subjectRef,
    property,
    value: { type: "EntityReference", entityId: targetId },
    upsert: true,
  });
}

export function pushInstanceOf(
  buf: OpBuffer,
  packageCode: string,
  subjectRef: string,
  instanceOfProperty: string,
  classIri: string,
) {
  buf.ops.push({
    op: "createStatement",
    packageCode,
    subject: subjectRef,
    property: instanceOfProperty,
    value: { type: "EntityReference", entityId: classIri },
    upsert: true,
  });
}

export function pushExchangeManaged(
  buf: OpBuffer,
  packageCode: string,
  subjectRef: string,
  identifier: string,
  exchangeManagedProp?: string,
) {
  buf.ops.push({
    op: "setEntityIRIAliases",
    entity: subjectRef,
    aliases: [{ iri: exchangeAliasIri(identifier), kind: "imported" }],
  });
  if (exchangeManagedProp) {
    pushBoolStatement(buf, packageCode, subjectRef, exchangeManagedProp, true);
  }
}

export function applyBatchResults(
  buf: OpBuffer,
  results: Array<{ op?: string; entity?: string; clientKey?: string }>,
) {
  for (const r of results) {
    if (r.op === "createEntity" && r.clientKey && r.entity) {
      const id = r.clientKey.startsWith("$ox:") ? r.clientKey.slice(4) : r.clientKey;
      buf.idMap.set(id, r.entity);
    }
  }
}

export function shouldFlush(buf: OpBuffer, upcomingCount: number, limit = OE_BATCH_CHUNK_SIZE): boolean {
  return buf.ops.length > 0 && buf.ops.length + upcomingCount > limit;
}
