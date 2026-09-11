import type { KcClient } from "../kcClient";
import { entityLabel, type SchemaResolver } from "../schema";
import type { Entity, Statement } from "../types";
import {
  isAbstractArchimateClassLocal,
  isRelationshipClassLocal,
  isViewClassLocal,
} from "../openExchange/typeMap";
import {
  classLocalFromStatements,
  classNeedsMatchProps,
  interestingKeysForClass,
  matchKeysForClass,
  propMapFromStatements,
  resolveClassLocalFromEmbeds,
  statementToString,
} from "./hubResolve";
import { resolvePresentationProfile } from "./profileResolver";
import { getCardsProfileLoader, type CardsProfileLoader } from "./profileLoader";
import type {
  CardFieldView,
  CardNeighbor,
  CardSlotView,
  CardViewModel,
  PresentationProfileDef,
  RelationSlotDef,
} from "./types";

export type CardsHubRow = {
  entity: Entity;
  classLocal: string;
  profile: PresentationProfileDef | null;
};

export type CardsHubPage = {
  items: CardsHubRow[];
  pageSize: number;
  /**
   * From KC facets (B2) when available and no text query;
   * null means UI should not show exact "X z Y".
   */
  total: number | null;
  hasMore: boolean;
  /** Pass as `cursor` on the next hub request (keyset after last scanned entity). */
  nextCursor?: string;
  /** Package-wide type counts from facets (browsable only); empty if facets unavailable. */
  typeFacets: Array<{ classLocal: string; count: number }>;
};

const PAGE_SIZE = 50;
/** Over-fetch KC list chunks so client-side browsable filter can fill a page. */
const LIST_CHUNK = 100;
const BATCH_READ_LIMIT = 200;

/**
 * Builds card view-models and queries neighbors for relation slots.
 * Does not import TraversalEngine / navigation profiles.
 */
export class CardsService {
  constructor(
    private kc: KcClient,
    private schema: SchemaResolver,
    private loader: CardsProfileLoader = getCardsProfileLoader(),
  ) {}

  /**
   * Cursor-paged hub list. Does not scan the whole package.
   * Fills up to `pageSize` browsable rows, advancing the KC cursor as needed.
   */
  async listBrowsableEntities(
    packageCode: string,
    opts?: {
      query?: string;
      classLocal?: string;
      pageSize?: number;
      /** Keyset cursor from a previous page (`nextCursor`). */
      cursor?: string;
    },
  ): Promise<CardsHubPage> {
    const query = opts?.query?.trim() || undefined;
    const typeFilter = opts?.classLocal?.trim() || undefined;
    const pageSize = Math.max(1, opts?.pageSize ?? PAGE_SIZE);

    const profiles = await this.loader.loadAllProfiles(false, packageCode);
    const classIri = typeFilter
      ? this.schema.snapshot.classesByLocal.get(typeFilter)?.id
      : undefined;

    const matchPropLocals = new Set<string>();
    for (const p of profiles) {
      for (const k of Object.keys(p.matchProperties)) matchPropLocals.add(k);
    }
    const matchPropIris = [...matchPropLocals]
      .map((local) => this.schema.tryPropertyIri(local))
      .filter((iri): iri is string => !!iri);

    const listInclude =
      matchPropIris.length > 0 ? "effectiveClasses,statements" : "effectiveClasses";
    const listProperties = matchPropIris.length > 0 ? matchPropIris.join(",") : undefined;

    const items: CardsHubRow[] = [];
    const typeCounts = new Map<string, number>();
    let cursor = opts?.cursor;
    let lastScannedId: string | undefined;
    let kcHasMore = false;
    let leftoverInBatch = false;

    while (items.length < pageSize) {
      const batch = await this.kc.listEntities({
        package: packageCode,
        q: query,
        instanceOf: classIri,
        includeSubclasses: classIri ? true : undefined,
        limit: LIST_CHUNK,
        cursor,
        include: listInclude,
        properties: listProperties,
      });

      if (batch.items.length === 0) {
        kcHasMore = false;
        break;
      }

      for (let i = 0; i < batch.items.length; i++) {
        const entity = batch.items[i];
        lastScannedId = entity.id;
        const row = await this.resolveHubRow(entity, profiles, typeFilter);
        if (!row) continue;

        items.push(row);
        typeCounts.set(row.classLocal, (typeCounts.get(row.classLocal) || 0) + 1);

        if (items.length >= pageSize) {
          leftoverInBatch = i < batch.items.length - 1;
          kcHasMore = leftoverInBatch || !!batch.nextCursor;
          break;
        }
      }

      if (items.length >= pageSize) break;

      cursor = batch.nextCursor;
      kcHasMore = !!batch.nextCursor;
      if (!batch.nextCursor) break;
    }

    items.sort((a, b) => entityLabel(a.entity).localeCompare(entityLabel(b.entity), "cs"));

    const { typeFacets, total } = await this.resolveHubFacets(packageCode, {
      query,
      typeFilter,
      pageFallback: typeCounts,
    });

    const hasMore = items.length > 0 && kcHasMore;
    return {
      items,
      pageSize,
      total,
      hasMore,
      nextCursor: hasMore && lastScannedId ? lastScannedId : undefined,
      typeFacets,
    };
  }

  /**
   * C3: package facets → browsable type counts + total (skipped when text query active).
   */
  private async resolveHubFacets(
    packageCode: string,
    opts: {
      query?: string;
      typeFilter?: string;
      pageFallback: Map<string, number>;
    },
  ): Promise<{
    typeFacets: Array<{ classLocal: string; count: number }>;
    total: number | null;
  }> {
    const pageFacets = [...opts.pageFallback.entries()]
      .map(([classLocal, count]) => ({ classLocal, count }))
      .sort((a, b) => a.classLocal.localeCompare(b.classLocal, "cs"));

    try {
      const res = await this.kc.listEntityFacets({
        package: packageCode,
        groupBy: "instanceOf",
      });
      const byLocal = new Map<string, number>();
      for (const f of res.facets || []) {
        const local = this.schema.snapshot.classIriToLocal.get(f.classId);
        if (!local || !this.isBrowsableElement(local)) continue;
        byLocal.set(local, (byLocal.get(local) || 0) + f.count);
      }
      const typeFacets = [...byLocal.entries()]
        .map(([classLocal, count]) => ({ classLocal, count }))
        .sort((a, b) => a.classLocal.localeCompare(b.classLocal, "cs"));

      // Text query is not reflected in facets → keep total unknown.
      if (opts.query) {
        return { typeFacets, total: null };
      }
      if (opts.typeFilter) {
        return { typeFacets, total: byLocal.get(opts.typeFilter) ?? 0 };
      }
      const total = typeFacets.reduce((sum, f) => sum + f.count, 0);
      return { typeFacets, total };
    } catch {
      return { typeFacets: pageFacets, total: null };
    }
  }

  /** Element types for quick filters — from presentation profiles (no entity scan). */
  async listQuickFilterTypes(orgPackage?: string): Promise<string[]> {
    const profiles = await this.loader.loadAllProfiles(false, orgPackage);
    const set = new Set<string>();
    for (const p of profiles) {
      if (p.archimateElementType && this.isBrowsableElement(p.archimateElementType)) {
        set.add(p.archimateElementType);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "cs"));
  }

  private isBrowsableElement(classLocal: string): boolean {
    if (classLocal.startsWith("Ui")) return false;
    if (classLocal === "AllowedRelationship") return false;
    if (isAbstractArchimateClassLocal(classLocal)) return false;
    if (isRelationshipClassLocal(classLocal)) return false;
    if (isViewClassLocal(classLocal)) return false;
    if (!this.schema.snapshot.classesByLocal.has(classLocal)) return false;
    return true;
  }

  /**
   * Hub row resolve: prefer list embeds (effectiveClasses / statements), else
   * fetch statements at most once; only matchProperties (never fieldProperties).
   */
  private async resolveHubRow(
    entity: Entity,
    profiles: PresentationProfileDef[],
    typeFilter?: string,
  ): Promise<CardsHubRow | null> {
    const snap = this.schema.snapshot;
    // Prefer list embed when present (including empty array — do not re-fetch).
    let stmts: Statement[] | null = entity.statements !== undefined ? entity.statements : null;
    let classLocal = resolveClassLocalFromEmbeds(
      entity,
      stmts,
      snap.instanceOfProperty,
      snap.classIriToLocal,
    );
    if (!classLocal) {
      if (!stmts) {
        stmts = (await this.kc.getStatements(entity.id)).items;
      }
      classLocal = classLocalFromStatements(
        stmts,
        snap.instanceOfProperty,
        snap.classIriToLocal,
      );
    }
    if (!classLocal) return null;
    if (!this.isBrowsableElement(classLocal)) return null;
    if (typeFilter && classLocal !== typeFilter) return null;

    let props: Record<string, string | undefined> = {};
    if (classNeedsMatchProps(profiles, classLocal)) {
      const keys = matchKeysForClass(profiles, classLocal);
      if (!stmts) {
        stmts = (await this.kc.getStatements(entity.id)).items;
      }
      props = propMapFromStatements(stmts, keys, (iri) => this.schema.propertyLocal(iri));
    }

    const profile = resolvePresentationProfile(classLocal, props, profiles);
    return { entity, classLocal, profile };
  }

  /**
   * Search candidate entities as values for an EntityReference property.
   */
  async searchPropertyTargets(
    packageCode: string,
    rangeClassLocals: string[],
    query: string,
    limit = 15,
  ): Promise<Array<{ id: string; label: string; classLocal: string }>> {
    const needle = query.trim().toLocaleLowerCase("cs");
    const out: Array<{ id: string; label: string; classLocal: string }> = [];
    const seen = new Set<string>();

    if (rangeClassLocals.length === 0) {
      const page = await this.kc.listEntities({
        package: packageCode,
        q: query.trim() || undefined,
        limit: 80,
      });
      for (const entity of page.items) {
        const classLocal = (await this.resolveClassLocal(entity)) || "?";
        if (!this.isBrowsableElement(classLocal)) continue;
        const label = entityLabel(entity);
        if (needle && !label.toLocaleLowerCase("cs").includes(needle)) continue;
        if (seen.has(entity.id)) continue;
        seen.add(entity.id);
        out.push({ id: entity.id, label, classLocal });
        if (out.length >= limit) break;
      }
      return out;
    }

    for (const classLocal of rangeClassLocals) {
      if (out.length >= limit) break;
      const classIri = this.schema.snapshot.classesByLocal.get(classLocal)?.id;
      if (!classIri) continue;

      const page = await this.kc.listEntities({
        package: packageCode,
        instanceOf: classIri,
        includeSubclasses: true,
        q: query.trim() || undefined,
        limit: 50,
      });

      for (const entity of page.items) {
        if (seen.has(entity.id)) continue;
        const resolved = (await this.resolveClassLocal(entity)) || classLocal;
        if (!this.isBrowsableElement(resolved)) continue;
        const label = entityLabel(entity);
        if (needle && !label.toLocaleLowerCase("cs").includes(needle)) continue;
        seen.add(entity.id);
        out.push({ id: entity.id, label, classLocal: resolved });
        if (out.length >= limit) break;
      }
    }

    out.sort((a, b) => a.label.localeCompare(b.label, "cs"));
    return out.slice(0, limit);
  }

  async resolveEntityLabels(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return map;

    for (let i = 0; i < unique.length; i += BATCH_READ_LIMIT) {
      const chunk = unique.slice(i, i + BATCH_READ_LIMIT);
      try {
        const res = await this.kc.batchReadEntities({ ids: chunk });
        for (const row of res.results) {
          if (row.entity) map.set(row.id, entityLabel(row.entity));
          else map.set(row.id, row.id);
        }
      } catch {
        await Promise.all(
          chunk.map(async (id) => {
            try {
              const ent = await this.kc.getEntity(id);
              map.set(id, entityLabel(ent));
            } catch {
              map.set(id, id);
            }
          }),
        );
      }
    }
    return map;
  }

  async loadCard(entityId: string, options?: { expert?: boolean }): Promise<CardViewModel> {
    const expert = options?.expert ?? false;
    const entity = await this.kc.getEntity(entityId);
    const classLocal = (await this.resolveClassLocal(entity)) || "?";
    const profiles = await this.loader.loadAllProfiles(false, entity.packageCode);
    const props = await this.readInterestingProps(entityId, profiles, classLocal);
    const profile = resolvePresentationProfile(classLocal, props, profiles);

    const fields: CardFieldView[] = [];
    if (profile) {
      for (const propLocal of profile.fieldProperties) {
        const value = props[propLocal] ?? (await this.readStringProp(entityId, propLocal)) ?? "";
        fields.push({
          propertyLocal: propLocal,
          label: this.schema.snapshot.propertiesByLocal.get(propLocal)
            ? entityLabel(this.schema.snapshot.propertiesByLocal.get(propLocal)!)
            : propLocal,
          value,
        });
      }
    }

    const slots: CardSlotView[] = [];
    const claimedRelIds = new Set<string>();

    if (profile) {
      for (const slot of profile.slots) {
        const neighbors = await this.querySlotNeighbors(entityId, slot, profiles);
        for (const n of neighbors) claimedRelIds.add(n.relationshipId);
        const empty = neighbors.length === 0;
        if (!empty || slot.importance === "recommended" || expert) {
          slots.push({ slot, neighbors, empty });
        }
      }
    }

    let expertNeighbors: CardNeighbor[] = [];
    if (expert) {
      const all = await this.queryAllNeighbors(entityId, profiles);
      expertNeighbors = all.filter((n) => !claimedRelIds.has(n.relationshipId));
    }

    return {
      entityId: entity.id,
      entityLabel: entityLabel(entity),
      classLocal,
      description: entity.descriptions?.cs || entity.descriptions?.en,
      descriptions: entity.descriptions,
      profile,
      raw: !profile,
      fields,
      slots,
      expertNeighbors,
      system: {
        id: entity.id,
        canonicalId: entity.canonicalId,
        iri: entity.iri,
        iriLocal: entity.iriLocal,
        iriAliases: (entity.iriAliases || []).map((a) => ({ iri: a.iri, kind: a.kind })),
        packageCode: entity.packageCode,
        status: entity.status,
        kind: entity.kind,
        revisionNo: entity.revisionNo,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        effectiveClassLocals: (entity.effectiveClasses || [])
          .map((c) => this.schema.snapshot.classIriToLocal.get(c))
          .filter((x): x is string => Boolean(x)),
      },
    };
  }

  async querySlotNeighbors(
    entityId: string,
    slot: RelationSlotDef,
    profiles?: PresentationProfileDef[],
  ): Promise<CardNeighbor[]> {
    const allProfiles = profiles ?? (await this.loader.loadAllProfiles());
    const relClass = this.schema.snapshot.classesByLocal.get(slot.relationshipType);
    if (!relClass) return [];

    const pairs = await this.neighborsViaRel(entityId, relClass.id, slot.direction);
    if (pairs.length === 0) return [];

    const neighborIds = [...new Set(pairs.map((p) => p.neighborId))];
    const byId = await this.batchReadEntitiesMap(neighborIds, {
      include: ["effectiveClasses", "statements"],
      properties: this.interestingPropIris(allProfiles),
    });

    const out: CardNeighbor[] = [];
    for (const { neighborId, relId } of pairs) {
      const packed = byId.get(neighborId);
      if (!packed) continue;
      const entity = packed.entity;
      const classLocal =
        resolveClassLocalFromEmbeds(
          entity,
          packed.statements,
          this.schema.snapshot.instanceOfProperty,
          this.schema.snapshot.classIriToLocal,
        ) || "?";
      if (slot.targetClasses.length && !slot.targetClasses.includes(classLocal)) continue;

      const keys = interestingKeysForClass(allProfiles, classLocal);
      const props = propMapFromStatements(packed.statements, keys, (iri) =>
        this.schema.propertyLocal(iri),
      );
      const neighborProfile = resolvePresentationProfile(classLocal, props, allProfiles);
      if (
        slot.targetProfileCodes.length &&
        (!neighborProfile || !slot.targetProfileCodes.includes(neighborProfile.profileCode))
      ) {
        continue;
      }

      out.push({
        entityId: entity.id,
        entityLabel: entityLabel(entity),
        classLocal,
        profileCode: neighborProfile?.profileCode,
        profileLabelCs: neighborProfile?.labelCs,
        relationshipId: relId,
        relationshipType: slot.relationshipType,
      });
    }

    out.sort((a, b) => a.entityLabel.localeCompare(b.entityLabel, "cs"));
    return out;
  }

  private async queryAllNeighbors(
    entityId: string,
    profiles: PresentationProfileDef[],
  ): Promise<CardNeighbor[]> {
    const snap = this.schema.snapshot;
    const [asSource, asTarget] = await Promise.all([
      this.kc.getIncoming(entityId, snap.relSource),
      this.kc.getIncoming(entityId, snap.relTarget),
    ]);

    const roles = [
      ...asSource.items.map((s) => ({ stmt: s, as: "source" as const })),
      ...asTarget.items.map((s) => ({ stmt: s, as: "target" as const })),
    ];
    const relIds = [...new Set(roles.map((r) => r.stmt.subject))];
    if (relIds.length === 0) return [];

    const relProps = [snap.relSource, snap.relTarget].filter(Boolean);
    const relMap = await this.batchReadEntitiesMap(relIds, {
      include: ["effectiveClasses", "statements"],
      properties: relProps,
    });

    type Pending = {
      neighborId: string;
      relId: string;
      relationshipType: string;
    };
    const pending: Pending[] = [];
    const seen = new Set<string>();

    for (const role of roles) {
      const relId = role.stmt.subject;
      if (seen.has(relId)) continue;
      seen.add(relId);
      const packed = relMap.get(relId);
      if (!packed) continue;
      const relClassLocal = resolveClassLocalFromEmbeds(
        packed.entity,
        packed.statements,
        snap.instanceOfProperty,
        snap.classIriToLocal,
      );
      if (!relClassLocal) continue;

      const src = packed.statements.find((s) => s.property === snap.relSource);
      const tgt = packed.statements.find((s) => s.property === snap.relTarget);
      if (src?.value.type !== "EntityReference" || tgt?.value.type !== "EntityReference") continue;

      const neighborId =
        role.as === "source" ? tgt.value.entityId : src.value.entityId;
      if (neighborId === entityId) continue;
      pending.push({ neighborId, relId, relationshipType: relClassLocal });
    }

    const neighborIds = [...new Set(pending.map((p) => p.neighborId))];
    const neighborMap = await this.batchReadEntitiesMap(neighborIds, {
      include: ["effectiveClasses", "statements"],
      properties: this.interestingPropIris(profiles),
    });

    const out: CardNeighbor[] = [];
    for (const p of pending) {
      const packed = neighborMap.get(p.neighborId);
      if (!packed) continue;
      const classLocal =
        resolveClassLocalFromEmbeds(
          packed.entity,
          packed.statements,
          snap.instanceOfProperty,
          snap.classIriToLocal,
        ) || "?";
      const keys = interestingKeysForClass(profiles, classLocal);
      const props = propMapFromStatements(packed.statements, keys, (iri) =>
        this.schema.propertyLocal(iri),
      );
      const neighborProfile = resolvePresentationProfile(classLocal, props, profiles);
      out.push({
        entityId: packed.entity.id,
        entityLabel: entityLabel(packed.entity),
        classLocal,
        profileCode: neighborProfile?.profileCode,
        profileLabelCs: neighborProfile?.labelCs,
        relationshipId: p.relId,
        relationshipType: p.relationshipType,
      });
    }

    out.sort((a, b) => a.entityLabel.localeCompare(b.entityLabel, "cs"));
    return out;
  }

  private async neighborsViaRel(
    entityId: string,
    relClassIri: string,
    direction: "outgoing" | "incoming",
  ): Promise<Array<{ neighborId: string; relId: string }>> {
    const snap = this.schema.snapshot;
    const [asSource, asTarget] = await Promise.all([
      this.kc.getIncoming(entityId, snap.relSource),
      this.kc.getIncoming(entityId, snap.relTarget),
    ]);

    const candidateRels = [
      ...asSource.items.map((s) => ({ stmt: s, role: "source" as const })),
      ...asTarget.items.map((s) => ({ stmt: s, role: "target" as const })),
    ];
    const relIds = [...new Set(candidateRels.map((c) => c.stmt.subject))];
    if (relIds.length === 0) return [];

    const relProps = [snap.relSource, snap.relTarget].filter(Boolean);
    const relMap = await this.batchReadEntitiesMap(relIds, {
      include: ["effectiveClasses", "statements"],
      properties: relProps,
    });

    const out: Array<{ neighborId: string; relId: string }> = [];

    for (const { stmt, role } of candidateRels) {
      const relId = stmt.subject;
      const packed = relMap.get(relId);
      if (!packed) continue;

      const classLocal = resolveClassLocalFromEmbeds(
        packed.entity,
        packed.statements,
        snap.instanceOfProperty,
        snap.classIriToLocal,
      );
      const classIri = classLocal ? snap.classesByLocal.get(classLocal)?.id : undefined;
      const matchesClass =
        classIri === relClassIri ||
        !!packed.entity.effectiveClasses?.includes(relClassIri) ||
        packed.statements.some(
          (s) =>
            s.property === snap.instanceOfProperty &&
            s.value.type === "EntityReference" &&
            s.value.entityId === relClassIri,
        );
      if (!matchesClass) continue;

      const src = packed.statements.find((s) => s.property === snap.relSource);
      const tgt = packed.statements.find((s) => s.property === snap.relTarget);
      if (src?.value.type !== "EntityReference" || tgt?.value.type !== "EntityReference") {
        continue;
      }

      if (direction === "outgoing" && role === "source") {
        out.push({ neighborId: tgt.value.entityId, relId });
      } else if (direction === "incoming" && role === "target") {
        out.push({ neighborId: src.value.entityId, relId });
      }
    }

    return out;
  }

  /** C4 helper: chunked batch-read with getEntity fallback. */
  private async batchReadEntitiesMap(
    ids: string[],
    opts?: { include?: string[]; properties?: string[] },
  ): Promise<Map<string, { entity: Entity; statements: Statement[] }>> {
    const out = new Map<string, { entity: Entity; statements: Statement[] }>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return out;

    const include = opts?.include?.length ? opts.include : undefined;
    const properties =
      include?.includes("statements") && opts?.properties?.length
        ? opts.properties
        : include?.includes("statements")
          ? undefined
          : opts?.properties;

    for (let i = 0; i < unique.length; i += BATCH_READ_LIMIT) {
      const chunk = unique.slice(i, i + BATCH_READ_LIMIT);
      try {
        const body: { ids: string[]; include?: string[]; properties?: string[] } = {
          ids: chunk,
        };
        if (include) body.include = include;
        if (properties?.length) body.properties = properties;
        // statements require properties — if we only want effectiveClasses, omit statements
        if (include?.includes("statements") && !properties?.length) {
          body.include = include.filter((x) => x !== "statements");
          if (body.include.length === 0) delete body.include;
        }
        const res = await this.kc.batchReadEntities(body);
        for (const row of res.results) {
          if (!row.entity) continue;
          const entity = {
            ...row.entity,
            statements: row.statements,
          };
          out.set(row.id, {
            entity,
            statements: row.statements ?? row.entity.statements ?? [],
          });
        }
      } catch {
        await Promise.all(
          chunk.map(async (id) => {
            try {
              const entity = await this.kc.getEntity(id);
              let statements: Statement[] = entity.statements ?? [];
              if (include?.includes("statements")) {
                const page = await this.kc.getStatements(id);
                statements = page.items;
              }
              out.set(id, { entity: { ...entity, statements }, statements });
            } catch {
              /* skip missing */
            }
          }),
        );
      }
    }
    return out;
  }

  private interestingPropIris(profiles: PresentationProfileDef[]): string[] {
    const keys = new Set<string>();
    for (const p of profiles) {
      for (const k of Object.keys(p.matchProperties)) keys.add(k);
      for (const k of p.fieldProperties) keys.add(k);
    }
    keys.add("actorKind");
    keys.add("organizationScope");
    return [...keys]
      .map((local) => this.schema.tryPropertyIri(local))
      .filter((iri): iri is string => !!iri);
  }

  /** One statements GET; map match + field keys (detail / neighbors). */
  private async readInterestingProps(
    entityId: string,
    profiles: PresentationProfileDef[],
    classLocal: string,
  ): Promise<Record<string, string | undefined>> {
    const keys = interestingKeysForClass(profiles, classLocal);
    if (keys.size === 0) return {};
    const page = await this.kc.getStatements(entityId);
    return propMapFromStatements(page.items, keys, (iri) => this.schema.propertyLocal(iri));
  }

  private async readStringProp(entityId: string, propertyLocal: string): Promise<string | undefined> {
    const propIri = this.schema.tryPropertyIri(propertyLocal);
    if (!propIri) return undefined;
    const page = await this.kc.getStatements(entityId, propIri);
    return statementToString(page.items[0]?.value);
  }

  private async resolveClassLocal(entity: Entity): Promise<string | undefined> {
    const snap = this.schema.snapshot;
    const fromEmbed = resolveClassLocalFromEmbeds(
      entity,
      entity.statements,
      snap.instanceOfProperty,
      snap.classIriToLocal,
    );
    if (fromEmbed) return fromEmbed;
    const stmts = await this.kc.getStatements(entity.id);
    return classLocalFromStatements(stmts.items, snap.instanceOfProperty, snap.classIriToLocal);
  }
}
