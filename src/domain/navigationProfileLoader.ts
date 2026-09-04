import { getKc, type KcClient } from "../kc/client";
import { getSchema, type SchemaResolver } from "../kc/schema";
import type { Entity, Statement, StatementValue } from "../kc/types";
import {
  ARCHIMATE_LITE_PKG,
  UI_TRAVERSAL_PKG,
  rewriteUiTraversalIri,
} from "../kc/uiTraversalIriMigration";
import type {
  ProfileBundle,
  TemplateBundle,
  UiAddActionMeta,
  UiNavigationProfileMeta,
  UiStageMeta,
  UiTraversalTemplateMeta,
  UiTransitionMeta,
} from "./navigationProfileTypes";

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

function refVal(v: StatementValue | undefined): string | undefined {
  if (!v || v.type !== "EntityReference") return undefined;
  return v.entityId;
}

function parseJsonRecord(raw: string | undefined): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

function parseRequireProperty(
  raw: string | undefined,
): { property: string; value?: string } | undefined {
  const rec = parseJsonRecord(raw);
  if (!rec?.property) return undefined;
  return { property: rec.property, value: rec.value };
}

function parseActorKinds(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const kinds = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return kinds.length ? kinds : undefined;
}

export class NavigationProfileLoader {
  private propCache = new Map<string, string>();
  private classIdCache = new Map<string, string>();
  private stmtCache = new Map<string, Statement[]>();

  constructor(
    private kc: KcClient = getKc(),
    private schema: SchemaResolver = getSchema(),
  ) {}

  async findSystemProfile(): Promise<UiNavigationProfileMeta | null> {
    const cls = await this.classId("UiNavigationProfile");
    if (!cls) return null;
    // Prefer archimate-ui-traversal (1.0.0+); fall back to legacy archimate-lite seed.
    for (const pkg of [UI_TRAVERSAL_PKG, ARCHIMATE_LITE_PKG]) {
      const page = await this.kc.listEntities({
        package: pkg,
        instanceOf: cls,
        includeSubclasses: true,
        limit: 50,
      });
      for (const ent of page.items) {
        const meta = await this.loadProfileMeta(ent);
        if (meta.isSystemDefault) return meta;
      }
    }
    return null;
  }

  async listProfiles(packageCode?: string): Promise<UiNavigationProfileMeta[]> {
    const cls = await this.classId("UiNavigationProfile");
    if (!cls) return [];
    const params: Parameters<KcClient["listEntities"]>[0] = {
      instanceOf: cls,
      includeSubclasses: true,
      limit: 200,
    };
    if (packageCode) params.package = packageCode;
    const page = await this.kc.listEntities(params);
    const out: UiNavigationProfileMeta[] = [];
    for (const ent of page.items) {
      out.push(await this.loadProfileMeta(ent));
    }
    return out.sort((a, b) => (a.labelCs || a.profileCode).localeCompare(b.labelCs || b.profileCode, "cs"));
  }

  async loadProfileMeta(entityOrId: Entity | string): Promise<UiNavigationProfileMeta> {
    const ent =
      typeof entityOrId === "string" ? await this.getEntityMaybeMigrated(entityOrId) : entityOrId;
    const stmts = await this.statements(ent.id);
    const byProp = this.byPropertyLocal(stmts);

    return {
      id: ent.id,
      iriLocal: ent.iriLocal,
      packageCode: ent.packageCode,
      labels: ent.labels || {},
      profileCode: stringVal(byProp.get("profileCode")?.[0]?.value) || ent.iriLocal || ent.id,
      profileVersion: stringVal(byProp.get("profileVersion")?.[0]?.value),
      minCatalogVersion: stringVal(byProp.get("minCatalogVersion")?.[0]?.value),
      isSystemDefault: boolVal(byProp.get("isSystemDefault")?.[0]?.value),
      labelCs: stringVal(byProp.get("labelCs")?.[0]?.value),
      labelEn: stringVal(byProp.get("labelEn")?.[0]?.value),
      parentProfileId: refVal(byProp.get("parentProfile")?.[0]?.value),
    };
  }

  async loadProfileBundle(profileId: string): Promise<ProfileBundle> {
    const meta = await this.loadProfileMeta(profileId);
    const templates = await this.loadTemplatesForProfile(profileId);
    return { meta, templates };
  }

  async loadTemplatesForProfile(profileId: string): Promise<TemplateBundle[]> {
    const prop = await this.propId("parentProfile");
    if (!prop) return [];
    const resolvedProfileId = (await this.getEntityMaybeMigrated(profileId)).id;
    const incoming = await this.kc.getIncoming(resolvedProfileId, prop);
    const bundles: TemplateBundle[] = [];
    for (const stmt of incoming.items) {
      const tplEnt = await this.getEntityMaybeMigrated(stmt.subject);
      bundles.push(await this.loadTemplateBundle(tplEnt));
    }
    bundles.sort((a, b) => (a.meta.sortOrder ?? 0) - (b.meta.sortOrder ?? 0));
    return bundles;
  }

  async loadTemplateBundle(entityOrId: Entity | string): Promise<TemplateBundle> {
    const ent =
      typeof entityOrId === "string" ? await this.getEntityMaybeMigrated(entityOrId) : entityOrId;
    const meta = await this.loadTemplateMeta(ent);
    const [stages, transitions, addActions] = await Promise.all([
      this.loadStagesForTemplate(ent.id),
      this.loadTransitionsForTemplate(ent.id),
      this.loadAddActionsForTemplate(ent.id),
    ]);
    return { meta, stages, transitions, addActions };
  }

  async loadTemplateMeta(entityOrId: Entity | string): Promise<UiTraversalTemplateMeta> {
    const ent =
      typeof entityOrId === "string" ? await this.getEntityMaybeMigrated(entityOrId) : entityOrId;
    const stmts = await this.statements(ent.id);
    const byProp = this.byPropertyLocal(stmts);

    return {
      id: ent.id,
      iriLocal: ent.iriLocal,
      packageCode: ent.packageCode,
      parentProfileId: refVal(byProp.get("parentProfile")?.[0]?.value) || "",
      templateCode: stringVal(byProp.get("templateCode")?.[0]?.value) || ent.iriLocal || "",
      labelCs: stringVal(byProp.get("labelCs")?.[0]?.value) || ent.labels?.cs || ent.labels?.en || "",
      isDefault: boolVal(byProp.get("isDefault")?.[0]?.value),
      sortOrder: intVal(byProp.get("sortOrder")?.[0]?.value),
      startStageId: refVal(byProp.get("startStage")?.[0]?.value),
    };
  }

  async loadStagesForTemplate(templateId: string): Promise<UiStageMeta[]> {
    const prop = await this.propId("parentTemplate");
    if (!prop) return [];
    const resolvedTemplateId = (await this.getEntityMaybeMigrated(templateId)).id;
    const incoming = await this.kc.getIncoming(resolvedTemplateId, prop);
    const stages: UiStageMeta[] = [];
    for (const stmt of incoming.items) {
      const ent = await this.getEntityMaybeMigrated(stmt.subject);
      const classLocal = await this.entityClassLocal(ent);
      if (classLocal !== "UiStage") continue;
      stages.push(await this.loadStageMeta(ent));
    }
    stages.sort((a, b) => a.stageOrder - b.stageOrder);
    return stages;
  }

  async loadStageMeta(entityOrId: Entity | string): Promise<UiStageMeta> {
    const ent =
      typeof entityOrId === "string" ? await this.getEntityMaybeMigrated(entityOrId) : entityOrId;
    const stmts = await this.statements(ent.id);
    const byProp = this.byPropertyLocal(stmts);

    const targetClassLocals: string[] = [];
    for (const stmt of byProp.get("targetClasses") || []) {
      const ref = refVal(stmt.value);
      if (!ref) continue;
      const local = await this.classLocalFromRef(ref);
      if (local) targetClassLocals.push(local);
    }

    return {
      id: ent.id,
      iriLocal: ent.iriLocal,
      packageCode: ent.packageCode,
      parentTemplateId: refVal(byProp.get("parentTemplate")?.[0]?.value) || "",
      stageCode: stringVal(byProp.get("stageCode")?.[0]?.value) || "",
      stageOrder: intVal(byProp.get("stageOrder")?.[0]?.value) ?? 0,
      columnLabelCs: stringVal(byProp.get("columnLabelCs")?.[0]?.value) || "",
      targetClassLocals,
      actorKinds: parseActorKinds(stringVal(byProp.get("actorKinds")?.[0]?.value)),
      instanceFilter: parseJsonRecord(stringVal(byProp.get("instanceFilter")?.[0]?.value)),
    };
  }

  async loadTransitionsForTemplate(templateId: string): Promise<UiTransitionMeta[]> {
    const prop = await this.propId("parentTemplate");
    if (!prop) return [];
    const resolvedTemplateId = (await this.getEntityMaybeMigrated(templateId)).id;
    const incoming = await this.kc.getIncoming(resolvedTemplateId, prop);
    const transitions: UiTransitionMeta[] = [];
    for (const stmt of incoming.items) {
      const ent = await this.getEntityMaybeMigrated(stmt.subject);
      const classLocal = await this.entityClassLocal(ent);
      if (classLocal !== "UiTransition") continue;
      transitions.push(await this.loadTransitionMeta(ent));
    }
    return transitions;
  }

  async loadTransitionMeta(entityOrId: Entity | string): Promise<UiTransitionMeta> {
    const ent =
      typeof entityOrId === "string" ? await this.getEntityMaybeMigrated(entityOrId) : entityOrId;
    const stmts = await this.statements(ent.id);
    const byProp = this.byPropertyLocal(stmts);

    const relRef = refVal(byProp.get("relationshipClass")?.[0]?.value);
    const relLocal = relRef ? await this.classLocalFromRef(relRef) : "";
    const dir = stringVal(byProp.get("traverseDirection")?.[0]?.value);

    return {
      id: ent.id,
      iriLocal: ent.iriLocal,
      packageCode: ent.packageCode,
      parentTemplateId: refVal(byProp.get("parentTemplate")?.[0]?.value) || "",
      fromStageId: refVal(byProp.get("fromStage")?.[0]?.value) || "",
      toStageId: refVal(byProp.get("toStage")?.[0]?.value) || "",
      relationshipClassLocal: relLocal || "",
      traverseDirection: dir === "inverse" ? "inverse" : "model",
      uiEdgeLabelCs: stringVal(byProp.get("uiEdgeLabelCs")?.[0]?.value) || "",
      requireProperty: parseRequireProperty(stringVal(byProp.get("requireProperty")?.[0]?.value)),
    };
  }

  async loadAddActionsForTemplate(templateId: string): Promise<UiAddActionMeta[]> {
    const prop = await this.propId("parentTemplate");
    if (!prop) return [];
    const resolvedTemplateId = (await this.getEntityMaybeMigrated(templateId)).id;
    const incoming = await this.kc.getIncoming(resolvedTemplateId, prop);
    const actions: UiAddActionMeta[] = [];
    for (const stmt of incoming.items) {
      const ent = await this.getEntityMaybeMigrated(stmt.subject);
      const classLocal = await this.entityClassLocal(ent);
      if (classLocal !== "UiAddAction") continue;
      actions.push(await this.loadAddActionMeta(ent));
    }
    actions.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return actions;
  }

  async loadAddActionMeta(entityOrId: Entity | string): Promise<UiAddActionMeta> {
    const ent =
      typeof entityOrId === "string" ? await this.getEntityMaybeMigrated(entityOrId) : entityOrId;
    const stmts = await this.statements(ent.id);
    const byProp = this.byPropertyLocal(stmts);

    const createsRef = refVal(byProp.get("createsClass")?.[0]?.value);
    const createsLocal = createsRef ? await this.classLocalFromRef(createsRef) : "";
    const derivesRef = refVal(byProp.get("derivesRelationship")?.[0]?.value);
    const derivesLocal = derivesRef ? await this.classLocalFromRef(derivesRef) : undefined;
    const relDir = stringVal(byProp.get("relationshipDirection")?.[0]?.value);

    return {
      id: ent.id,
      iriLocal: ent.iriLocal,
      packageCode: ent.packageCode,
      parentTemplateId: refVal(byProp.get("parentTemplate")?.[0]?.value) || "",
      stageId: refVal(byProp.get("stage")?.[0]?.value) || "",
      actionCode: stringVal(byProp.get("actionCode")?.[0]?.value) || "",
      domainLabelCs: stringVal(byProp.get("domainLabelCs")?.[0]?.value) || "",
      createsClassLocal: createsLocal || "",
      sortOrder: intVal(byProp.get("sortOrder")?.[0]?.value),
      defaultProperties: parseJsonRecord(stringVal(byProp.get("defaultProperties")?.[0]?.value)),
      derivesRelationship: derivesLocal,
      relationshipDirection:
        relDir === "from-new-to-selected" ? "from-new-to-selected" : "from-selected-to-new",
      relationshipDefaults: parseJsonRecord(
        stringVal(byProp.get("relationshipDefaults")?.[0]?.value),
      ),
    };
  }

  async getOrgProfileLinkId(orgPackageCode: string): Promise<string | null> {
    const pkg = await this.kc.getPackage(orgPackageCode);
    if (!pkg.rootEntityId) return null;
    const prop = await this.propId("orgNavigationProfile");
    if (!prop) return null;
    const stmts = await this.kc.getStatements(pkg.rootEntityId, prop);
    const ref = stmts.items[0]?.value;
    return ref?.type === "EntityReference" ? ref.entityId : null;
  }

  async resolveProfileChain(startProfileId: string): Promise<string[]> {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = startProfileId;
    while (current && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      const meta = await this.loadProfileMeta(current);
      current = meta.parentProfileId;
    }
    return chain.reverse();
  }

  clearCache(): void {
    this.stmtCache.clear();
  }

  /** Resolve entity; if missing, retry after UI-traversal IRI migration rewrite. */
  private async getEntityMaybeMigrated(id: string): Promise<Entity> {
    try {
      return await this.kc.getEntity(id);
    } catch (first) {
      const rewritten = rewriteUiTraversalIri(id);
      if (rewritten === id) throw first;
      return await this.kc.getEntity(rewritten);
    }
  }

  private async statements(entityId: string): Promise<Statement[]> {
    const cached = this.stmtCache.get(entityId);
    if (cached) return cached;
    const res = await this.kc.getStatements(entityId);
    this.stmtCache.set(entityId, res.items);
    return res.items;
  }

  private byPropertyLocal(stmts: Statement[]): Map<string, Statement[]> {
    const map = new Map<string, Statement[]>();
    for (const s of stmts) {
      const local = this.schema.propertyLocal(s.property);
      if (!local) continue;
      const list = map.get(local) || [];
      list.push(s);
      map.set(local, list);
    }
    return map;
  }

  private async propId(local: string): Promise<string | undefined> {
    const cached = this.propCache.get(local);
    if (cached) return cached;
    const id = this.schema.tryPropertyIri(local);
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
      return undefined;
    }
  }

  private async classLocalFromRef(entityId: string): Promise<string | undefined> {
    const snap = this.schema.snapshot;
    const rewritten = rewriteUiTraversalIri(entityId);
    const direct = snap.classIriToLocal.get(entityId) || snap.classIriToLocal.get(rewritten);
    if (direct) return direct;
    try {
      const ent = await this.kc.getEntity(rewritten !== entityId ? rewritten : entityId);
      if (ent.iriLocal && snap.classesByLocal.has(ent.iriLocal)) return ent.iriLocal;
      return ent.iriLocal;
    } catch {
      if (rewritten !== entityId) {
        try {
          const ent = await this.kc.getEntity(entityId);
          return ent.iriLocal;
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  }

  private async entityClassLocal(ent: Entity): Promise<string | undefined> {
    const snap = this.schema.snapshot;
    if (ent.effectiveClasses?.length) {
      for (const c of ent.effectiveClasses) {
        const local =
          snap.classIriToLocal.get(c) || snap.classIriToLocal.get(rewriteUiTraversalIri(c));
        if (local?.startsWith("Ui")) return local;
      }
    }
    const stmts = await this.statements(ent.id);
    for (const s of stmts) {
      if (s.property !== snap.instanceOfProperty) continue;
      if (s.value.type !== "EntityReference") continue;
      const id = s.value.entityId;
      const local =
        snap.classIriToLocal.get(id) || snap.classIriToLocal.get(rewriteUiTraversalIri(id));
      if (local) return local;
    }
    return undefined;
  }
}

let loaderSingleton: NavigationProfileLoader | null = null;

export function getNavigationLoader(): NavigationProfileLoader {
  if (!loaderSingleton) loaderSingleton = new NavigationProfileLoader();
  return loaderSingleton;
}

export function resetNavigationLoader(): void {
  loaderSingleton = null;
}
