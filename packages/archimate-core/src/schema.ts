import type { KcClient } from "./kcClient";
import {
  hydrateSnapshot,
  MemorySchemaCache,
  serializeSnapshot,
  type SchemaCachePort,
  type SchemaCachePayload,
} from "./schemaCache";
import type { Entity, PropertyEntity, SchemaConfig, Statement } from "./types";
import {
  ARCHIMATE_LITE_PKG,
  UI_TRAVERSAL_PKG,
  indexWithUiTraversalAliases,
  rewriteUiTraversalIri,
} from "./uiTraversalIriMigration";

const AML = ARCHIMATE_LITE_PKG;
const UI_TRAV = UI_TRAVERSAL_PKG;
const UI_CARDS = "archimate-ui-cards";
const KC_BASE = "kc-base";
const BATCH_READ_LIMIT = 200;

export interface SchemaSnapshot {
  instanceOfProperty: string;
  classesByLocal: Map<string, Entity>;
  propertiesByLocal: Map<string, PropertyEntity>;
  classIriToLocal: Map<string, string>;
  propertyIriToLocal: Map<string, string>;
  relSource: string;
  relTarget: string;
  allowed: AllowedRel[];
  enums: Map<string, string[]>;
  loadedAt: number;
}

export interface AllowedRel {
  typeLocal: string;
  typeIri: string;
  sourceLocal: string;
  sourceIri: string;
  targetLocal: string;
  targetIri: string;
}

export interface SchemaLoadOptions {
  /** Bypass memory + cache port and re-fetch from KC. */
  force?: boolean;
  /** When set, skip network if memory/cache snapshot matches. */
  fingerprint?: string;
  /** Optional pre-fetched schema-config (avoids a duplicate GET). */
  config?: SchemaConfig;
}

export type SchemaResolverOptions = {
  kc: KcClient;
  cache?: SchemaCachePort;
};

function label(e: Entity, _lang = "en"): string {
  return e.labels?.cs || e.labels?.en || e.iriLocal || e.id;
}

/** Display name for a package: root-entity labels, else package code. */
function packageLabel(
  pkg: { code: string; labels?: Record<string, string> } | null | undefined,
  fallbackCode?: string,
): string {
  const code = pkg?.code || fallbackCode || "";
  if (!pkg?.labels) return code;
  return pkg.labels.cs || pkg.labels.en || Object.values(pkg.labels).find((v) => v?.trim()) || code;
}

function stmtByProp(stmts: Statement[], propId: string): Statement | undefined {
  return stmts.find((s) => s.property === propId);
}

export class SchemaResolver {
  private snap: SchemaSnapshot | null = null;
  private fingerprint: string | null = null;
  /** In-flight load — dedupes StrictMode double-mount and parallel callers. */
  private inflight: Promise<SchemaSnapshot> | null = null;
  private kc: KcClient;
  private cache: SchemaCachePort;

  constructor(opts: SchemaResolverOptions) {
    this.kc = opts.kc;
    this.cache = opts.cache ?? new MemorySchemaCache();
  }

  get snapshot(): SchemaSnapshot {
    if (!this.snap) throw new Error("Schema not loaded — call load() first");
    return this.snap;
  }

  isLoaded(): boolean {
    return this.snap !== null;
  }

  get loadedFingerprint(): string | null {
    return this.fingerprint;
  }

  /** Drop memory snapshot (persisted cache kept unless clearPersisted). */
  clearMemory(): void {
    this.snap = null;
    this.fingerprint = null;
  }

  async clearPersisted(): Promise<void> {
    await this.cache.clear();
  }

  /** Clear memory + persisted cache (e.g. before forced reload / auth change). */
  async invalidate(): Promise<void> {
    this.clearMemory();
    await this.clearPersisted();
  }

  async load(forceOrOpts: boolean | SchemaLoadOptions = false): Promise<SchemaSnapshot> {
    const opts: SchemaLoadOptions =
      typeof forceOrOpts === "boolean" ? { force: forceOrOpts } : forceOrOpts;

    if (this.inflight) return this.inflight;

    this.inflight = this.loadInner(opts).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async loadInner(opts: SchemaLoadOptions): Promise<SchemaSnapshot> {
    const force = opts.force === true;
    const fp = opts.fingerprint;

    if (!force && this.snap && (!fp || this.fingerprint === fp)) {
      return this.snap;
    }

    if (!force && fp) {
      const cached = await this.cache.read();
      if (cached && cached.fingerprint === fp) {
        this.snap = hydrateSnapshot(cached) as SchemaSnapshot;
        this.fingerprint = fp;
        return this.snap;
      }
    }

    const config = opts.config ?? (await this.kc.getSchemaConfig());
    if (!config.instanceOfProperty) {
      throw new Error(
        "schema-config.instanceOfProperty is empty — import kc-base and set instanceOf",
      );
    }

    // Assert typing property entity exists (do not fall back to package-local instanceOf).
    try {
      await this.kc.getEntity(config.instanceOfProperty);
    } catch (e) {
      throw new Error(
        `schema-config.instanceOfProperty entity not found: ${config.instanceOfProperty}` +
          (e instanceof Error ? ` (${e.message})` : ""),
      );
    }
    console.info(`[SchemaResolver] instanceOfProperty=${config.instanceOfProperty}`);

    const [amlClasses, amlProperties, uiClasses, uiProperties, cardClasses, cardProperties] =
      await Promise.all([
        this.loadAllKind(AML, "class"),
        this.loadAllKind(AML, "property") as Promise<PropertyEntity[]>,
        this.loadAllKind(UI_TRAV, "class").catch((e) => {
          console.warn("archimate-ui-traversal classes load skipped:", e);
          return [] as Entity[];
        }),
        this.loadAllKind(UI_TRAV, "property").catch((e) => {
          console.warn("archimate-ui-traversal properties load skipped:", e);
          return [] as PropertyEntity[];
        }) as Promise<PropertyEntity[]>,
        this.loadAllKind(UI_CARDS, "class").catch((e) => {
          console.warn("archimate-ui-cards classes load skipped:", e);
          return [] as Entity[];
        }),
        this.loadAllKind(UI_CARDS, "property").catch((e) => {
          console.warn("archimate-ui-cards properties load skipped:", e);
          return [] as PropertyEntity[];
        }) as Promise<PropertyEntity[]>,
      ]);

    // Also load kc-base properties for instanceOf / usage
    const baseProps = (await this.loadAllKind(KC_BASE, "property")) as PropertyEntity[];

    const classesByLocal = new Map<string, Entity>();
    const classIriToLocal = new Map<string, string>();
    for (const c of [...amlClasses, ...uiClasses, ...cardClasses]) {
      if (c.iriLocal) {
        classesByLocal.set(c.iriLocal, c);
        indexWithUiTraversalAliases(classIriToLocal, c.iriLocal, c.id);
        if (c.iri) indexWithUiTraversalAliases(classIriToLocal, c.iriLocal, c.iri);
        classIriToLocal.set(c.id, c.iriLocal);
        if (c.iri) classIriToLocal.set(c.iri, c.iriLocal);
      }
    }

    const propertiesByLocal = new Map<string, PropertyEntity>();
    const propertyIriToLocal = new Map<string, string>();
    for (const p of [...amlProperties, ...uiProperties, ...baseProps]) {
      if (p.iriLocal) {
        propertiesByLocal.set(p.iriLocal, p);
        indexWithUiTraversalAliases(propertyIriToLocal, p.iriLocal, p.id);
        if (p.iri) indexWithUiTraversalAliases(propertyIriToLocal, p.iriLocal, p.iri);
      }
    }
    // Cards properties: index IRI→local for statement reading; do not overwrite
    // shared locals (profileCode, sortOrder, …) used by ui-traversal.
    for (const p of cardProperties) {
      if (!p.iriLocal) continue;
      if (!propertiesByLocal.has(p.iriLocal)) {
        propertiesByLocal.set(p.iriLocal, p);
      }
      propertyIriToLocal.set(p.id, p.iriLocal);
      if (p.iri) propertyIriToLocal.set(p.iri, p.iriLocal);
    }

    const relSource = propertiesByLocal.get("relSource")?.id;
    const relTarget = propertiesByLocal.get("relTarget")?.id;
    if (!relSource || !relTarget) {
      throw new Error("archimate-lite missing relSource/relTarget properties");
    }

    let allowedRows: AllowedRel[] = [];
    try {
      allowedRows = await this.loadAllowed(classesByLocal, propertiesByLocal);
    } catch (e) {
      console.warn("AllowedRelationship load skipped:", e);
    }

    const enums = await this.loadEnums(propertiesByLocal);

    const packageLocalInstanceOf = propertiesByLocal.get("instanceOf")?.id;
    if (
      packageLocalInstanceOf &&
      packageLocalInstanceOf !== config.instanceOfProperty
    ) {
      console.warn(
        `[SchemaResolver] ignoring package-local instanceOf=${packageLocalInstanceOf}; ` +
          `using schema-config instanceOfProperty=${config.instanceOfProperty}`,
      );
    }

    // Index config IRI → local "instanceOf" for propertyLocal() lookups (list_statements display).
    propertyIriToLocal.set(config.instanceOfProperty, "instanceOf");

    this.snap = {
      instanceOfProperty: config.instanceOfProperty,
      classesByLocal,
      propertiesByLocal,
      classIriToLocal,
      propertyIriToLocal,
      relSource,
      relTarget,
      allowed: allowedRows,
      enums,
      loadedAt: Date.now(),
    };
    this.fingerprint = fp ?? null;

    if (fp) {
      await this.cache.write(serializeSnapshot(fp, this.snap));
    }

    return this.snap;
  }

  classIri(local: string): string {
    const c = this.snapshot.classesByLocal.get(local);
    if (!c) throw new Error(`Unknown class iriLocal: ${local}`);
    return c.id;
  }

  /**
   * Resolve property IRI by local name.
   * Never use this for typing — callers must use snapshot.instanceOfProperty for instanceOf.
   */
  propertyIri(local: string): string {
    if (local === "instanceOf") {
      return this.snapshot.instanceOfProperty;
    }
    const p = this.snapshot.propertiesByLocal.get(local);
    if (!p) throw new Error(`Unknown property iriLocal: ${local}`);
    return p.id;
  }

  tryPropertyIri(local: string): string | undefined {
    if (local === "instanceOf") return this.snapshot.instanceOfProperty;
    return this.snapshot.propertiesByLocal.get(local)?.id;
  }

  classLocal(iri: string): string | undefined {
    const snap = this.snapshot;
    return snap.classIriToLocal.get(iri) || snap.classIriToLocal.get(rewriteUiTraversalIri(iri));
  }

  propertyLocal(iri: string): string | undefined {
    const snap = this.snapshot;
    return (
      snap.propertyIriToLocal.get(iri) || snap.propertyIriToLocal.get(rewriteUiTraversalIri(iri))
    );
  }

  classLabel(local: string): string {
    const c = this.snapshot.classesByLocal.get(local);
    return c ? label(c) : local;
  }

  isAllowed(typeLocal: string, sourceLocal: string, targetLocal: string): boolean {
    return this.snapshot.allowed.some(
      (a) =>
        a.typeLocal === typeLocal &&
        a.sourceLocal === sourceLocal &&
        a.targetLocal === targetLocal,
    );
  }

  enumValues(propertyLocal: string): string[] {
    return this.snapshot.enums.get(propertyLocal) || [];
  }

  private async loadAllKind(pkg: string, kind: string): Promise<Entity[]> {
    const items: Entity[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kc.listEntities({
        package: pkg,
        kind,
        limit: 200,
        cursor,
      });
      items.push(...page.items);
      cursor = page.nextCursor || undefined;
    } while (cursor);
    return items;
  }

  /**
   * Load AllowedRelationship matrix via phase-22 include=statements + batch-read
   * (avoids N× getStatements + 3N× getEntity).
   */
  private async loadAllowed(
    classesByLocal: Map<string, Entity>,
    propertiesByLocal: Map<string, PropertyEntity>,
  ): Promise<AllowedRel[]> {
    const allowedClass = classesByLocal.get("AllowedRelationship");
    if (!allowedClass) return [];

    const typeProp = propertiesByLocal.get("allowedRelType");
    const srcProp = propertiesByLocal.get("allowedSourceClass");
    const tgtProp = propertiesByLocal.get("allowedTargetClass");
    if (!typeProp || !srcProp || !tgtProp) return [];

    const propKeys = [
      typeProp.iriLocal || typeProp.id,
      srcProp.iriLocal || srcProp.id,
      tgtProp.iriLocal || tgtProp.id,
    ].join(",");

    const rows: Entity[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kc.listEntities({
        package: AML,
        instanceOf: allowedClass.id,
        includeSubclasses: true,
        limit: 200,
        cursor,
        include: "statements",
        properties: propKeys,
      });
      rows.push(...page.items);
      cursor = page.nextCursor || undefined;
    } while (cursor);

    type RowRefs = { typeId: string; srcId: string; tgtId: string };
    const refs: RowRefs[] = [];
    const needIds = new Set<string>();

    for (const row of rows) {
      let stmts = row.statements;
      if (!stmts?.length) {
        const page = await this.kc.getStatements(row.id);
        stmts = page.items;
      }
      const typeS = stmtByProp(stmts, typeProp.id);
      const srcS = stmtByProp(stmts, srcProp.id);
      const tgtS = stmtByProp(stmts, tgtProp.id);
      if (
        typeS?.value.type === "EntityReference" &&
        srcS?.value.type === "EntityReference" &&
        tgtS?.value.type === "EntityReference"
      ) {
        const typeId = typeS.value.entityId;
        const srcId = srcS.value.entityId;
        const tgtId = tgtS.value.entityId;
        needIds.add(typeId);
        needIds.add(srcId);
        needIds.add(tgtId);
        refs.push({ typeId, srcId, tgtId });
      }
    }

    const byId = await this.batchReadEntitiesMap([...needIds]);
    const out: AllowedRel[] = [];
    for (const r of refs) {
      const typeEnt = byId.get(r.typeId);
      const srcEnt = byId.get(r.srcId);
      const tgtEnt = byId.get(r.tgtId);
      if (!typeEnt || !srcEnt || !tgtEnt) continue;
      out.push({
        typeLocal: typeEnt.iriLocal || typeEnt.id,
        typeIri: typeEnt.id,
        sourceLocal: srcEnt.iriLocal || srcEnt.id,
        sourceIri: srcEnt.id,
        targetLocal: tgtEnt.iriLocal || tgtEnt.id,
        targetIri: tgtEnt.id,
      });
    }
    return out;
  }

  private async loadEnums(
    propertiesByLocal: Map<string, PropertyEntity>,
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    const enumLocals = [
      "actorKind",
      "organizationScope",
      "ownership",
      "associationKind",
      "networkKind",
      "networkRole",
      "flowKind",
      "accessMode",
      "dependencyStrength",
      "modelingDepth",
    ];

    const allowedProp = propertiesByLocal.get("allowedValue");
    if (!allowedProp) return result;

    const found = (
      await Promise.all(
        enumLocals.map(async (local) => {
          if (!propertiesByLocal.get(local)) return null;
          const enumEnt = await this.resolveByLocal(AML, `enum/${local}`);
          return enumEnt ? { local, id: enumEnt.id } : null;
        }),
      )
    ).filter((x): x is { local: string; id: string } => x !== null);

    if (!found.length) return result;

    const propKey = allowedProp.iriLocal || allowedProp.id;
    const byId = await this.batchReadEntitiesMap(
      found.map((f) => f.id),
      { include: ["statements"], properties: [propKey] },
    );

    for (const { local, id } of found) {
      const hit = byId.get(id);
      let stmts = hit?.statements;
      if (!stmts?.length) {
        const page = await this.kc.getStatements(id);
        stmts = page.items;
      }
      const values = stmts
        .filter((s) => s.property === allowedProp.id && s.value.type === "String")
        .map((s) => (s.value.type === "String" ? s.value.string : ""))
        .filter(Boolean);
      if (values.length) result.set(local, values);
    }
    return result;
  }

  private async batchReadEntitiesMap(
    ids: string[],
    opts?: { include?: string[]; properties?: string[] },
  ): Promise<Map<string, Entity & { statements?: Statement[] }>> {
    const out = new Map<string, Entity & { statements?: Statement[] }>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return out;

    for (let i = 0; i < unique.length; i += BATCH_READ_LIMIT) {
      const chunk = unique.slice(i, i + BATCH_READ_LIMIT);
      try {
        const body: { ids: string[]; include?: string[]; properties?: string[] } = {
          ids: chunk,
        };
        if (opts?.include?.length) body.include = opts.include;
        if (opts?.properties?.length) body.properties = opts.properties;
        if (body.include?.includes("statements") && !body.properties?.length) {
          body.include = body.include.filter((x) => x !== "statements");
          if (!body.include.length) delete body.include;
        }
        const res = await this.kc.batchReadEntities(body);
        for (const row of res.results) {
          if (!row.entity) continue;
          out.set(row.id, {
            ...row.entity,
            statements: row.statements ?? row.entity.statements,
          });
        }
      } catch {
        await Promise.all(
          chunk.map(async (id) => {
            try {
              const entity = await this.kc.getEntity(id);
              out.set(id, entity);
            } catch {
              /* skip */
            }
          }),
        );
      }
    }
    return out;
  }

  private async resolveByLocal(pkg: string, iriLocal: string): Promise<Entity | null> {
    const res = await this.kc.listEntities({ package: pkg, iriLocal, limit: 1 });
    return res.items[0] || null;
  }
}

export type { SchemaCachePayload };
export { serializeSnapshot, hydrateSnapshot, MemorySchemaCache };
export type { SchemaCachePort } from "./schemaCache";

export { label as entityLabel, packageLabel };
