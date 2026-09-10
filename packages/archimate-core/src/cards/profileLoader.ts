import type { KcClient } from "../kcClient";
import type { SchemaResolver } from "../schema";
import type { Entity, Statement, StatementValue } from "../types";
import { UI_CARDS_PKG } from "./types";
import type {
  PresentationProfileDef,
  RelationSlotDef,
  SlotDirection,
  SlotImportance,
} from "./types";

function stringVal(v: StatementValue | undefined): string | undefined {
  if (!v) return undefined;
  if (v.type === "String") return v.string;
  if (v.type === "LocalizedString") return v.langMap.cs || v.langMap.en;
  return undefined;
}

function boolVal(v: StatementValue | undefined): boolean | undefined {
  if (!v || v.type !== "Boolean") return undefined;
  return v.bool;
}

function intVal(v: StatementValue | undefined): number | undefined {
  if (!v || v.type !== "Integer") return undefined;
  return v.int64;
}

function parseJsonRecord(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Loads PresentationProfile + RelationSlot from archimate-ui-cards.
 * Resolves property IRIs from that package (does not share lookup with ui-traversal).
 */
export class CardsProfileLoader {
  private propCache = new Map<string, string>();
  private classIdCache = new Map<string, string>();
  private stmtCache = new Map<string, Statement[]>();
  private profilesCache: PresentationProfileDef[] | null = null;

  constructor(
    private kc: KcClient,
    private schema: SchemaResolver,
  ) {}

  clearCache(): void {
    this.propCache.clear();
    this.classIdCache.clear();
    this.stmtCache.clear();
    this.profilesCache = null;
  }

  async loadAllProfiles(force = false): Promise<PresentationProfileDef[]> {
    if (this.profilesCache && !force) return this.profilesCache;

    const cls = await this.classId("PresentationProfile");
    if (!cls) {
      this.profilesCache = [];
      return [];
    }

    const page = await this.kc.listEntities({
      package: UI_CARDS_PKG,
      instanceOf: cls,
      includeSubclasses: true,
      limit: 100,
    });

    const profiles: PresentationProfileDef[] = [];
    for (const ent of page.items) {
      profiles.push(await this.loadProfile(ent));
    }
    profiles.sort((a, b) => a.sortOrder - b.sortOrder || a.profileCode.localeCompare(b.profileCode));
    this.profilesCache = profiles;
    return profiles;
  }

  async loadProfile(entityOrId: Entity | string): Promise<PresentationProfileDef> {
    const ent = typeof entityOrId === "string" ? await this.kc.getEntity(entityOrId) : entityOrId;
    const stmts = await this.statements(ent.id);
    const byProp = this.byPropertyLocal(stmts);
    const slots = await this.loadSlotsForProfile(ent.id);

    return {
      id: ent.id,
      iriLocal: ent.iriLocal,
      packageCode: ent.packageCode,
      profileCode: stringVal(byProp.get("profileCode")?.[0]?.value) || ent.iriLocal || ent.id,
      profileVersion: stringVal(byProp.get("profileVersion")?.[0]?.value),
      minCatalogVersion: stringVal(byProp.get("minCatalogVersion")?.[0]?.value),
      isSystemDefault: boolVal(byProp.get("isSystemDefault")?.[0]?.value),
      archimateElementType:
        stringVal(byProp.get("archimateElementType")?.[0]?.value) || "ArchiMateElement",
      matchProperties: parseJsonRecord(stringVal(byProp.get("matchProperties")?.[0]?.value)),
      fieldProperties: parseCsv(stringVal(byProp.get("fieldProperties")?.[0]?.value)),
      labelCs:
        stringVal(byProp.get("labelCs")?.[0]?.value) ||
        ent.labels?.cs ||
        ent.labels?.en ||
        ent.iriLocal ||
        "",
      labelEn: stringVal(byProp.get("labelEn")?.[0]?.value) || ent.labels?.en,
      descriptionCs: ent.descriptions?.cs || ent.descriptions?.en,
      sortOrder: intVal(byProp.get("sortOrder")?.[0]?.value) ?? 0,
      slots,
    };
  }

  private async loadSlotsForProfile(profileId: string): Promise<RelationSlotDef[]> {
    const prop = await this.propId("parentProfile");
    if (!prop) return [];
    const incoming = await this.kc.getIncoming(profileId, prop);
    const slots: RelationSlotDef[] = [];
    for (const stmt of incoming.items) {
      const ent = await this.kc.getEntity(stmt.subject);
      const classLocal = await this.entityClassLocal(ent);
      if (classLocal !== "RelationSlot") continue;
      slots.push(await this.loadSlot(ent));
    }
    slots.sort((a, b) => a.sortOrder - b.sortOrder || a.slotCode.localeCompare(b.slotCode));
    return slots;
  }

  private async loadSlot(ent: Entity): Promise<RelationSlotDef> {
    const stmts = await this.statements(ent.id);
    const byProp = this.byPropertyLocal(stmts);
    const dirRaw = stringVal(byProp.get("traverseDirection")?.[0]?.value);
    const direction: SlotDirection = dirRaw === "incoming" ? "incoming" : "outgoing";
    const impRaw = stringVal(byProp.get("importance")?.[0]?.value);
    const importance: SlotImportance = impRaw === "optional" ? "optional" : "recommended";

    return {
      id: ent.id,
      iriLocal: ent.iriLocal,
      slotCode: stringVal(byProp.get("slotCode")?.[0]?.value) || ent.iriLocal || "",
      labelCs: stringVal(byProp.get("slotLabelCs")?.[0]?.value) || "",
      relationshipType: stringVal(byProp.get("relationshipType")?.[0]?.value) || "",
      direction,
      targetClasses: parseCsv(stringVal(byProp.get("targetClasses")?.[0]?.value)),
      targetProfileCodes: parseCsv(stringVal(byProp.get("targetProfileCodes")?.[0]?.value)),
      importance,
      sortOrder: intVal(byProp.get("sortOrder")?.[0]?.value) ?? 0,
    };
  }

  private byPropertyLocal(stmts: Statement[]): Map<string, Statement[]> {
    const map = new Map<string, Statement[]>();
    const cardsBase = `https://knowledge-core.local/${UI_CARDS_PKG}/`;
    for (const s of stmts) {
      let local = this.schema.propertyLocal(s.property);
      if (!local && s.property.startsWith(cardsBase)) {
        local = s.property.slice(cardsBase.length);
      }
      if (!local) continue;
      const list = map.get(local) || [];
      list.push(s);
      map.set(local, list);
    }
    return map;
  }

  private async statements(entityId: string): Promise<Statement[]> {
    const cached = this.stmtCache.get(entityId);
    if (cached) return cached;
    const page = await this.kc.getStatements(entityId);
    this.stmtCache.set(entityId, page.items);
    return page.items;
  }

  /** Resolve property IRI from archimate-ui-cards package only. */
  private async propId(local: string): Promise<string | undefined> {
    const cached = this.propCache.get(local);
    if (cached) return cached;
    const page = await this.kc.listEntities({
      package: UI_CARDS_PKG,
      iriLocal: local,
      kind: "property",
      limit: 1,
    });
    const id = page.items[0]?.id;
    if (id) this.propCache.set(local, id);
    return id;
  }

  private async classId(local: string): Promise<string | undefined> {
    const cached = this.classIdCache.get(local);
    if (cached) return cached;
    try {
      const id = this.schema.classIri(local);
      this.classIdCache.set(local, id);
      return id;
    } catch {
      const page = await this.kc.listEntities({
        package: UI_CARDS_PKG,
        iriLocal: local,
        kind: "class",
        limit: 1,
      });
      const id = page.items[0]?.id;
      if (id) this.classIdCache.set(local, id);
      return id;
    }
  }

  private async entityClassLocal(ent: Entity): Promise<string | undefined> {
    const snap = this.schema.snapshot;
    if (ent.effectiveClasses?.length) {
      for (const c of ent.effectiveClasses) {
        const local = snap.classIriToLocal.get(c);
        if (local) return local;
      }
    }
    const stmts = await this.statements(ent.id);
    for (const s of stmts) {
      if (s.property !== snap.instanceOfProperty) continue;
      if (s.value.type !== "EntityReference") continue;
      return snap.classIriToLocal.get(s.value.entityId);
    }
    return ent.iriLocal;
  }
}

/** Optional host-bound singleton (SPA / MCP sets via bindCardsProfileLoader). */
let loaderSingleton: CardsProfileLoader | null = null;
let loaderFactory: (() => CardsProfileLoader) | null = null;

export function bindCardsProfileLoader(factory: () => CardsProfileLoader): void {
  loaderFactory = factory;
  loaderSingleton = null;
}

export function getCardsProfileLoader(): CardsProfileLoader {
  if (!loaderSingleton) {
    if (!loaderFactory) {
      throw new Error(
        "CardsProfileLoader not bound — call bindCardsProfileLoader() or pass loader explicitly",
      );
    }
    loaderSingleton = loaderFactory();
  }
  return loaderSingleton;
}

export function resetCardsProfileLoader(): void {
  loaderSingleton = null;
}
