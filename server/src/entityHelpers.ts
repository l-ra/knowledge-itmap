import {
  entityLabel,
  isRelationshipClassLocal,
  valueToDisplay,
  type Entity,
  type Statement,
  type StatementValue,
} from "@itmap/archimate-core";
import type { AppContext } from "./context.js";

export function summarizeEntity(
  e: {
    id: string;
    labels?: Record<string, string>;
    iriLocal?: string;
    packageCode?: string;
    status?: string;
    revisionNo?: number;
    effectiveClasses?: string[];
  },
  ctx?: AppContext,
) {
  const classLocals =
    e.effectiveClasses
      ?.map((iri) => ctx?.schema.classLocal(iri) || iri.split("/").pop() || iri)
      .filter(Boolean) ?? undefined;
  return {
    id: e.id,
    label: e.labels ? entityLabel(e as Entity) : e.iriLocal || e.id,
    iriLocal: e.iriLocal,
    packageCode: e.packageCode,
    status: e.status,
    revisionNo: e.revisionNo,
    effectiveClasses: e.effectiveClasses,
    classLocals,
    classLocal: classLocals?.[0],
  };
}

export function classLocalOf(ctx: AppContext, entity: Entity): string | undefined {
  for (const c of entity.effectiveClasses || []) {
    const local = ctx.schema.classLocal(c) || c.split("/").pop();
    if (
      local &&
      !["ArchiMateConcept", "ArchiMateElement", "ArchiMateRelationship", "ArchiMateViewConcept"].includes(
        local,
      )
    ) {
      return local;
    }
  }
  return entity.effectiveClasses?.[0]
    ? ctx.schema.classLocal(entity.effectiveClasses[0]) ||
        entity.effectiveClasses[0].split("/").pop()
    : undefined;
}

function propLocal(ctx: AppContext, property: string): string {
  return ctx.schema.propertyLocal(property) || property.split("/").pop() || property;
}

function stmtEntityId(value: StatementValue | undefined): string | undefined {
  if (value && typeof value === "object" && value.type === "EntityReference") {
    return value.entityId;
  }
  return undefined;
}

function stmtString(value: StatementValue | undefined): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (value.type === "String") return value.string;
  if (value.type === "Boolean") return String(value.bool);
  if (value.type === "EntityReference") return value.entityId;
  return valueToDisplay(value);
}

/** Extract selected property values from statements into a flat map. */
export function pickProperties(
  ctx: AppContext,
  statements: Statement[] | undefined,
  locals: string[],
): Record<string, string | boolean | null> {
  const want = new Set(locals);
  const out: Record<string, string | boolean | null> = {};
  for (const local of locals) out[local] = null;
  for (const s of statements || []) {
    const pl = propLocal(ctx, s.property);
    if (!want.has(pl)) continue;
    const v = s.value;
    if (v?.type === "Boolean") out[pl] = v.bool;
    else out[pl] = stmtString(v) ?? null;
  }
  return out;
}

export type ResolvedLink = {
  relType: string;
  direction: "out" | "in";
  relationshipId: string;
  other: {
    id: string;
    label: string;
    classLocal?: string;
    packageCode?: string;
  };
};

/**
 * Build agent-friendly neighborhood links from KC graph payload.
 */
export async function resolveNeighborhoodLinks(
  ctx: AppContext,
  selfId: string,
  graph: {
    outgoing?: Statement[];
    incoming?: Statement[];
    neighbors?: Entity[];
  },
  opts?: { relTypes?: string[]; classLocals?: string[] },
): Promise<ResolvedLink[]> {
  await ctx.ensureSchemaLoaded();
  const neighborById = new Map((graph.neighbors || []).map((n) => [n.id, n]));
  const relIds = new Set<string>();

  for (const s of [...(graph.outgoing || []), ...(graph.incoming || [])]) {
    const pl = propLocal(ctx, s.property);
    if (pl === "relSource" || pl === "relTarget" || pl === "elementRef") {
      // subject of incoming stmt is often the relationship / view node
      if (s.subject) relIds.add(s.subject);
    }
  }
  for (const n of graph.neighbors || []) {
    const local = classLocalOf(ctx, n);
    if (local && isRelationshipClassLocal(local)) relIds.add(n.id);
  }

  const links: ResolvedLink[] = [];
  const relTypeFilter = opts?.relTypes?.length ? new Set(opts.relTypes) : null;
  const classFilter = opts?.classLocals?.length ? new Set(opts.classLocals) : null;

  for (const relId of relIds) {
    let relEntity = neighborById.get(relId);
    if (!relEntity) {
      try {
        relEntity = await ctx.kc.getEntity(relId);
      } catch {
        continue;
      }
    }
    const relType = classLocalOf(ctx, relEntity);
    if (!relType || !isRelationshipClassLocal(relType)) continue;
    if (relTypeFilter && !relTypeFilter.has(relType)) continue;

    const stmts = await ctx.kc.getStatements(relId);
    let source: string | undefined;
    let target: string | undefined;
    for (const s of stmts.items) {
      const pl = propLocal(ctx, s.property);
      if (pl === "relSource") source = stmtEntityId(s.value);
      if (pl === "relTarget") target = stmtEntityId(s.value);
    }
    if (!source || !target) continue;
    if (source !== selfId && target !== selfId) continue;

    const direction: "out" | "in" = source === selfId ? "out" : "in";
    const otherId = direction === "out" ? target : source;
    let other = neighborById.get(otherId);
    if (!other) {
      try {
        other = await ctx.kc.getEntity(otherId);
      } catch {
        continue;
      }
    }
    const otherClass = classLocalOf(ctx, other);
    if (classFilter && otherClass && !classFilter.has(otherClass)) continue;
    if (classFilter && !otherClass) continue;

    links.push({
      relType,
      direction,
      relationshipId: relId,
      other: {
        id: other.id,
        label: entityLabel(other),
        classLocal: otherClass,
        packageCode: other.packageCode,
      },
    });
  }

  return links;
}

export async function enrichListedEntity(
  ctx: AppContext,
  entity: Entity,
  opts: {
    includeEffectiveClasses?: boolean;
    includeProperties?: string[];
  },
): Promise<Record<string, unknown>> {
  const base = summarizeEntity(entity, ctx);
  const out: Record<string, unknown> = { ...base };
  if (!opts.includeEffectiveClasses) {
    delete out.effectiveClasses;
    delete out.classLocals;
    // keep classLocal if we can cheaply know it from effectiveClasses on entity
    if (!entity.effectiveClasses?.length) delete out.classLocal;
  }

  if (opts.includeProperties?.length) {
    const page = await ctx.kc.getStatements(entity.id);
    out.properties = pickProperties(ctx, page.items, opts.includeProperties);
  }
  return out;
}
