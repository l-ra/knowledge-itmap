import { KcError } from "./errors";
import type {
  AuthConfig,
  BatchApplyData,
  ChangeOperation,
  ChangeSet,
  Entity,
  GraphNeighborhood,
  ListResponse,
  PackageInfo,
  PackageRelease,
  PropertyEntity,
  SchemaConfig,
  Statement,
  StatementValue,
  WriteResponse,
  EntityFacetsResponse,
  BatchReadResponse,
} from "./types";
import {
  canonicalReadKey,
  DEFAULT_READ_CACHE_MAX_AGE_MS,
  DEFAULT_READ_CACHE_STALE_AFTER_MS,
  hashJson,
  type ReadCachePort,
} from "./readCache";

export type { AuthConfig } from "./types";
export { KcError } from "./errors";
export type { ReadCachePort, ReadCacheEntry } from "./readCache";
export {
  MemoryReadCache,
  hashJson,
  canonicalReadKey,
  DEFAULT_READ_CACHE_STALE_AFTER_MS,
  DEFAULT_READ_CACHE_MAX_AGE_MS,
} from "./readCache";

export type KcClientOptions = {
  /** KC API base URL (empty = same origin / relative). */
  baseUrl?: string;
  auth?: AuthConfig;
  /** Called when setAuth updates credentials (e.g. persist). */
  onAuthChange?: (auth: AuthConfig) => void;
  /**
   * Default X-Validation-Mode for graph writes (create entity/statement).
   * MCP agents should use `strict`; IT Map UI keeps `relaxed`.
   */
  defaultWriteValidation?: "relaxed" | "strict" | "off";
  /** Optional SWR cache for getEntity / statements / incoming / batch-read. */
  readCache?: ReadCachePort;
  /** Age after which a hit is returned but revalidated in background (default 2 min). */
  readCacheStaleAfterMs?: number;
  /** Absolute max age; older entries are ignored (default 15 min). */
  readCacheMaxAgeMs?: number;
};

/** Most KC lists use `{ items }`; entity statements/incoming use `{ statements }`. */
function asListResponse<T>(json: unknown, altKeys: string[] = []): ListResponse<T> {
  if (Array.isArray(json)) {
    return { items: json as T[] };
  }
  if (!json || typeof json !== "object") {
    return { items: [] };
  }
  const obj = json as Record<string, unknown>;
  const nextCursor =
    typeof obj.nextCursor === "string" && obj.nextCursor ? obj.nextCursor : undefined;
  if (Array.isArray(obj.items)) {
    return { items: obj.items as T[], nextCursor };
  }
  for (const key of altKeys) {
    if (Array.isArray(obj[key])) {
      return { items: obj[key] as T[], nextCursor };
    }
  }
  return { items: [], nextCursor };
}

function authHeaders(auth: AuthConfig): Record<string, string> {
  if (auth.mode === "dev") {
    return {
      "X-Subject": auth.subject || "itmap-dev",
      "X-Roles": auth.roles || "admin,editor",
    };
  }
  if (auth.token) {
    return { Authorization: `Bearer ${auth.token}` };
  }
  return {};
}

type RequestOpts = {
  idempotencyKey?: string;
  validation?: string;
  /** Attach open CS headers for graph write/read (packages/search never use this). */
  cs?: "write" | "read";
};

const DEFAULT_AUTH: AuthConfig = {
  mode: "bootstrap",
  token: "",
  subject: "itmap-dev",
  roles: "admin,editor",
};

/**
 * Pure HTTP client for Knowledge Core `/v1`.
 * No localStorage / IndexedDB / import.meta.env — inject baseUrl + auth (+ optional readCache).
 */
export class KcClient {
  private baseUrl: string;
  private auth: AuthConfig;
  private onAuthChange?: (auth: AuthConfig) => void;
  private defaultWriteValidation: "relaxed" | "strict" | "off";
  private manualChangeSetId: string | null = null;
  private autoChangeSetId: string | null = null;
  /** Dev telemetry: count GET requests between beginReadCount/endReadCount. */
  private readCounting = false;
  private readCount = 0;
  private readCache: ReadCachePort | null;
  private readCacheStaleAfterMs: number;
  private readCacheMaxAgeMs: number;
  private inFlight = new Map<string, Promise<unknown>>();
  private revalidating = new Set<string>();

  constructor(opts: KcClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "";
    this.auth = opts.auth ?? { ...DEFAULT_AUTH };
    this.onAuthChange = opts.onAuthChange;
    this.defaultWriteValidation = opts.defaultWriteValidation ?? "relaxed";
    this.readCache = opts.readCache ?? null;
    this.readCacheStaleAfterMs = opts.readCacheStaleAfterMs ?? DEFAULT_READ_CACHE_STALE_AFTER_MS;
    this.readCacheMaxAgeMs = Math.max(
      opts.readCacheMaxAgeMs ?? DEFAULT_READ_CACHE_MAX_AGE_MS,
      this.readCacheStaleAfterMs,
    );
    this.readCache?.subscribeInvalidate?.(() => {
      this.inFlight.clear();
      this.revalidating.clear();
    });
  }

  /** Drop all cached reads (e.g. graphEpoch bump / ChangeSet overlay change). */
  clearReadCache(): void {
    this.inFlight.clear();
    this.revalidating.clear();
    void this.readCache?.invalidateAll();
  }

  /** Start counting GET requests (CardsHub A6 telemetry). */
  beginReadCount(): void {
    this.readCounting = true;
    this.readCount = 0;
  }

  /** Stop counting and return GET count since beginReadCount. */
  endReadCount(): number {
    this.readCounting = false;
    return this.readCount;
  }

  setAuth(auth: AuthConfig): void {
    this.auth = auth;
    this.clearReadCache();
    this.onAuthChange?.(auth);
  }

  getAuth(): AuthConfig {
    return this.auth;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
    this.clearReadCache();
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setDefaultWriteValidation(mode: "relaxed" | "strict" | "off"): void {
    this.defaultWriteValidation = mode;
  }

  getDefaultWriteValidation(): "relaxed" | "strict" | "off" {
    return this.defaultWriteValidation;
  }

  setManualChangeSet(id: string | null): void {
    if (this.manualChangeSetId === id) return;
    this.manualChangeSetId = id;
    this.clearReadCache();
  }

  getManualChangeSetId(): string | null {
    return this.manualChangeSetId;
  }

  private effectiveWriteCs(): string | null {
    return this.manualChangeSetId || this.autoChangeSetId;
  }

  private effectiveReadCs(): string | null {
    return this.manualChangeSetId;
  }

  private readScopePrefix(): string {
    const cs = this.effectiveWriteCs() || this.effectiveReadCs() || "";
    const auth = `${this.auth.mode}|${this.auth.subject || ""}`;
    return `base=${this.baseUrl}|auth=${auth}|cs=${cs}|`;
  }

  private async cachedRead<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    if (!this.readCache) return fetcher();

    const entry = await this.readCache.get(key);
    if (entry) {
      const age = Date.now() - entry.fetchedAt;
      if (age >= 0 && age < this.readCacheMaxAgeMs) {
        if (age >= this.readCacheStaleAfterMs) {
          this.revalidateInBackground(key, fetcher);
        }
        return entry.value as T;
      }
    }

    return this.fetchAndStore(key, fetcher);
  }

  private revalidateInBackground<T>(key: string, fetcher: () => Promise<T>): void {
    if (this.revalidating.has(key) || this.inFlight.has(key)) return;
    this.revalidating.add(key);
    void this.fetchAndStore(key, fetcher)
      .catch(() => {
        /* keep stale entry on background failure */
      })
      .finally(() => {
        this.revalidating.delete(key);
      });
  }

  private async fetchAndStore<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const p = (async () => {
      try {
        const value = await fetcher();
        if (this.readCache) {
          const prev = await this.readCache.get(key);
          const bodyHash = hashJson(value);
          // Unchanged soft revalidate: refresh timestamp only.
          if (prev && prev.bodyHash === bodyHash) {
            await this.readCache.set(key, { ...prev, fetchedAt: Date.now() });
          } else {
            await this.readCache.set(key, { value, fetchedAt: Date.now(), bodyHash });
          }
        }
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, p);
    return p;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOpts,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...authHeaders(this.auth),
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts?.validation) headers["X-Validation-Mode"] = opts.validation;

    if (opts?.cs === "write") {
      const id = this.effectiveWriteCs();
      if (id) headers["X-Knowledge-Changeset"] = id;
    } else if (opts?.cs === "read") {
      // Mid-write: also see the active auto/manual overlay on reads.
      const id = this.effectiveWriteCs() || this.effectiveReadCs();
      if (id) headers["X-Knowledge-Changesets"] = id;
    }

    if (this.readCounting && method === "GET") {
      this.readCount += 1;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) {
      if (opts?.cs === "write") this.clearReadCache();
      return undefined as T;
    }

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }

    if (!res.ok) {
      const err = json as {
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      const msg =
        err?.error?.message ||
        (typeof (json as { message?: string })?.message === "string"
          ? (json as { message: string }).message
          : null) ||
        (typeof (json as { raw?: string })?.raw === "string"
          ? String((json as { raw: string }).raw).slice(0, 200)
          : null) ||
        `HTTP ${res.status}`;
      const code = err?.error?.code || (res.status === 404 ? "not_found" : "error");
      console.error(`[KcClient] ${method} ${path} → ${res.status}`, json ?? text);
      throw new KcError(res.status, code, msg, json ?? text, method, path);
    }

    if (opts?.cs === "write") this.clearReadCache();
    return json as T;
  }

  healthz(): Promise<{ status?: string }> {
    return this.request("GET", "/healthz");
  }

  me(): Promise<{ subject?: string; roles?: string[] }> {
    return this.request("GET", "/v1/me");
  }

  getSchemaConfig(): Promise<SchemaConfig> {
    return this.request("GET", "/v1/admin/schema-config");
  }

  listShapes(packageCode?: string): Promise<
    Array<{
      id?: string;
      code: string;
      classId: string;
      packageCode?: string;
      document?: {
        requiredProperties?: string[];
        allowedProperties?: string[];
        closed?: boolean;
        severity?: string;
      };
    }>
  > {
    const q = packageCode ? `?package=${encodeURIComponent(packageCode)}` : "";
    return this.request("GET", `/v1/shapes${q}`).then((json) => {
      const list = asListResponse<{
        id?: string;
        code: string;
        classId: string;
        packageCode?: string;
        document?: {
          requiredProperties?: string[];
          allowedProperties?: string[];
          closed?: boolean;
          severity?: string;
        };
      }>(json);
      return list.items;
    });
  }

  getShape(code: string): Promise<{
    id?: string;
    code: string;
    classId: string;
    packageCode?: string;
    document?: {
      requiredProperties?: string[];
      allowedProperties?: string[];
      closed?: boolean;
      severity?: string;
    };
  }> {
    return this.request("GET", `/v1/shapes/${encodeURIComponent(code)}`);
  }

  listPackages(): Promise<ListResponse<PackageInfo>> {
    return this.request("GET", "/v1/packages?limit=200");
  }

  getPackage(code: string): Promise<PackageInfo> {
    return this.request("GET", `/v1/packages/${encodeURIComponent(code)}`);
  }

  createPackage(body: {
    code: string;
    lifecycle: string;
    iriBase: string;
    labels: Record<string, string>;
    /** Stored on package-root entity (class Package). */
    descriptions?: Record<string, string>;
    dependencies?: Array<{ dependsOnCode: string; versionRange: string }>;
  }): Promise<WriteResponse<PackageInfo>> {
    return this.request("POST", "/v1/packages", body, {
      idempotencyKey: `pkg-${body.code}`,
    });
  }

  updatePackage(
    code: string,
    body: {
      iriBase?: string;
      labels?: Record<string, string>;
    },
  ): Promise<WriteResponse<PackageInfo>> {
    return this.request("PATCH", `/v1/packages/${encodeURIComponent(code)}`, body, {
      idempotencyKey: `pkg-upd-${code}-${Date.now()}`,
    });
  }

  setPackageDependencies(
    code: string,
    dependencies: Array<{ dependsOnCode: string; versionRange: string }>,
  ): Promise<WriteResponse<PackageInfo>> {
    return this.request(
      "PUT",
      `/v1/packages/${encodeURIComponent(code)}/dependencies`,
      { dependencies },
      { idempotencyKey: `pkg-deps-${code}-${Date.now()}` },
    );
  }

  reconcilePackageDependencies(
    code: string,
    opts?: { dryRun?: boolean },
  ): Promise<
    WriteResponse<PackageInfo> & {
      reconcile?: {
        referenced?: string[];
        added?: Array<{ dependsOnCode: string; versionRange: string }>;
        removed?: Array<{ dependsOnCode: string; versionRange: string }>;
        kept?: Array<{ dependsOnCode: string; versionRange: string }>;
        unresolved?: string[];
        dryRun?: boolean;
      };
    }
  > {
    return this.request(
      "POST",
      `/v1/packages/${encodeURIComponent(code)}/dependencies/reconcile`,
      { dryRun: opts?.dryRun ?? false },
      { idempotencyKey: `pkg-deps-reconcile-${code}-${Date.now()}` },
    );
  }

  listReleases(code: string): Promise<ListResponse<PackageRelease>> {
    return this.request("GET", `/v1/packages/${encodeURIComponent(code)}/releases`);
  }

  publishRelease(code: string, version: string): Promise<WriteResponse<PackageRelease>> {
    return this.request(
      "POST",
      `/v1/packages/${encodeURIComponent(code)}/releases`,
      { version },
      { idempotencyKey: `rel-${code}-${version}` },
    );
  }

  importRelease(bundle: unknown): Promise<unknown> {
    return this.request("POST", "/v1/releases/import", bundle, {
      idempotencyKey: `import-${Date.now()}`,
    });
  }

  listEntities(params: {
    package?: string;
    kind?: string;
    iriLocal?: string;
    iri?: string;
    instanceOf?: string;
    includeSubclasses?: boolean;
    q?: string;
    cursor?: string;
    limit?: number;
    /** CSV: effectiveClasses, statements (KC phase-22). */
    include?: string;
    /** CSV property ids / iriLocals; required with include=statements. */
    properties?: string;
  }): Promise<ListResponse<Entity>> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    return this.request<unknown>("GET", `/v1/entities?${q}`, undefined, { cs: "read" }).then((json) =>
      asListResponse<Entity>(json),
    );
  }

  /** Facet counts by direct instanceOf (KC phase-22 B2). */
  listEntityFacets(params: {
    package?: string;
    groupBy?: string;
  } = {}): Promise<EntityFacetsResponse> {
    const q = new URLSearchParams();
    if (params.package) q.set("package", params.package);
    q.set("groupBy", params.groupBy || "instanceOf");
    return this.request<EntityFacetsResponse>("GET", `/v1/entities/facets?${q}`, undefined, {
      cs: "read",
    });
  }

  /** Batch entity read (KC phase-22 B3). Max 200 ids. */
  batchReadEntities(body: {
    ids: string[];
    include?: string[];
    properties?: string[];
  }): Promise<BatchReadResponse> {
    const key = canonicalReadKey("POST", "/v1/entities/batch-read", body, this.readScopePrefix());
    return this.cachedRead(key, () =>
      this.request<BatchReadResponse>("POST", "/v1/entities/batch-read", body, {
        cs: "read",
      }),
    );
  }

  getEntity(id: string): Promise<Entity> {
    const path = `/v1/entities/${encodeURIComponent(id)}`;
    const key = canonicalReadKey("GET", path, undefined, this.readScopePrefix());
    return this.cachedRead(key, () => this.request("GET", path, undefined, { cs: "read" }));
  }

  /**
   * Optional KC entity validation endpoint (when available).
   * Returns null when the server does not expose `/validation` (404).
   */
  async getEntityValidation(id: string): Promise<{
    entityId?: string;
    findings: Array<{ severity: string; code: string; message: string }>;
    summary?: { errors: number; warnings: number };
  } | null> {
    try {
      return await this.request(
        "GET",
        `/v1/entities/${encodeURIComponent(id)}/validation`,
        undefined,
        { cs: "read" },
      );
    } catch (e) {
      if (e instanceof KcError && (e.status === 404 || e.status === 501)) return null;
      throw e;
    }
  }

  createEntity(body: {
    packageCode: string;
    labels: Record<string, string>;
    descriptions?: Record<string, string>;
    iriLocal?: string;
  }): Promise<WriteResponse<Entity>> {
    return this.request("POST", "/v1/entities", body, {
      idempotencyKey: `ent-${body.packageCode}-${body.iriLocal || crypto.randomUUID()}`,
      validation: this.defaultWriteValidation,
      cs: "write",
    });
  }

  patchEntity(
    id: string,
    body: { labels?: Record<string, string>; descriptions?: Record<string, string>; expectedRevision?: number },
  ): Promise<WriteResponse<Entity>> {
    return this.request("PATCH", `/v1/entities/${encodeURIComponent(id)}`, body, {
      idempotencyKey: `patch-${id}-${Date.now()}`,
      cs: "write",
    });
  }

  async getStatements(id: string, property?: string): Promise<ListResponse<Statement>> {
    const q = new URLSearchParams({ limit: "200" });
    if (property) q.set("property", property);
    const path = `/v1/entities/${encodeURIComponent(id)}/statements?${q}`;
    const key = canonicalReadKey("GET", path, undefined, this.readScopePrefix());
    const json = await this.cachedRead(key, () =>
      this.request<unknown>("GET", path, undefined, { cs: "read" }),
    );
    return asListResponse<Statement>(json, ["statements"]);
  }

  async getIncoming(id: string, property?: string): Promise<ListResponse<Statement>> {
    const q = new URLSearchParams({ limit: "200" });
    if (property) q.set("property", property);
    const path = `/v1/entities/${encodeURIComponent(id)}/incoming?${q}`;
    const key = canonicalReadKey("GET", path, undefined, this.readScopePrefix());
    const json = await this.cachedRead(key, () =>
      this.request<unknown>("GET", path, undefined, { cs: "read" }),
    );
    return asListResponse<Statement>(json, ["statements"]);
  }

  getGraph(id: string, depth = 1): Promise<GraphNeighborhood> {
    return this.request("GET", `/v1/entities/${encodeURIComponent(id)}/graph?depth=${depth}`, undefined, {
      cs: "read",
    });
  }

  createStatement(body: {
    packageCode: string;
    subject: string;
    property: string;
    value: StatementValue;
    upsert?: boolean;
    qualifiers?: Array<{ property: string; value: StatementValue }>;
  }): Promise<WriteResponse<Statement>> {
    return this.request("POST", "/v1/statements", body, {
      idempotencyKey: `stmt-${body.subject}-${body.property}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      validation: this.defaultWriteValidation,
      cs: "write",
    });
  }

  reviseStatement(
    id: string,
    body: { value?: StatementValue; expectedRevision?: number },
  ): Promise<WriteResponse<Statement>> {
    return this.request("POST", `/v1/statements/${encodeURIComponent(id)}/revise`, body, {
      idempotencyKey: `rev-${id}-${Date.now()}`,
      cs: "write",
    });
  }

  deprecateStatement(
    id: string,
    body: { expectedRevision?: number } = {},
  ): Promise<WriteResponse<Statement>> {
    return this.request("POST", `/v1/statements/${encodeURIComponent(id)}/deprecate`, body, {
      idempotencyKey: `depr-${id}-${Date.now()}`,
      cs: "write",
    });
  }

  setEntityIriAliases(
    id: string,
    aliases: Array<{ iri: string; kind: string }>,
  ): Promise<WriteResponse<Entity>> {
    return this.request("PUT", `/v1/entities/${encodeURIComponent(id)}/iri-aliases`, { aliases }, {
      idempotencyKey: `alias-${id}-${Date.now()}`,
      cs: "write",
    });
  }

  deprecateEntity(id: string, body: { expectedRevision?: number } = {}): Promise<WriteResponse<Entity>> {
    return this.request("POST", `/v1/entities/${encodeURIComponent(id)}/deprecate`, body, {
      idempotencyKey: `ent-depr-${id}-${Date.now()}`,
      cs: "write",
    });
  }

  deleteEntity(id: string, body: { expectedRevision?: number } = {}): Promise<WriteResponse<Entity>> {
    return this.request("POST", `/v1/entities/${encodeURIComponent(id)}/delete`, body, {
      idempotencyKey: `ent-del-${id}-${Date.now()}`,
      cs: "write",
    });
  }

  async listAllEntities(params: {
    package?: string;
    kind?: string;
    iriLocal?: string;
    iri?: string;
    instanceOf?: string;
    includeSubclasses?: boolean;
    q?: string;
    limit?: number;
  }): Promise<Entity[]> {
    const items: Entity[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listEntities({
        ...params,
        limit: params.limit ?? 200,
        cursor,
      });
      items.push(...(page.items || []));
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  listProperties(packageCode: string): Promise<ListResponse<PropertyEntity>> {
    return this.request(
      "GET",
      `/v1/entities?package=${encodeURIComponent(packageCode)}&kind=property&limit=200`,
      undefined,
      { cs: "read" },
    ) as Promise<ListResponse<PropertyEntity>>;
  }

  listClasses(packageCode: string): Promise<ListResponse<Entity>> {
    return this.request(
      "GET",
      `/v1/entities?package=${encodeURIComponent(packageCode)}&kind=class&limit=200`,
      undefined,
      { cs: "read" },
    );
  }

  createProperty(body: {
    packageCode: string;
    datatype: string;
    labels: Record<string, string>;
    iriLocal: string;
    constraints?: PropertyEntity["constraints"];
  }): Promise<WriteResponse<PropertyEntity>> {
    return this.request("POST", "/v1/properties", body, {
      idempotencyKey: `prop-${body.packageCode}-${body.iriLocal}`,
      cs: "write",
    });
  }

  listChangeSets(params: { limit?: number; status?: string; actor?: string } = {}): Promise<ListResponse<ChangeSet>> {
    const q = new URLSearchParams();
    q.set("limit", String(params.limit ?? 50));
    if (params.status) q.set("status", params.status);
    if (params.actor) q.set("actor", params.actor);
    return this.request("GET", `/v1/changesets?${q}`);
  }

  getChangeSet(id: string): Promise<ChangeSet> {
    return this.request("GET", `/v1/changesets/${encodeURIComponent(id)}`);
  }

  async openChangeSet(opts?: { comment?: string; operationType?: string }): Promise<ChangeSet> {
    const res = await this.request<WriteResponse<ChangeSet>>("POST", "/v1/changesets/open", {
      comment: opts?.comment || undefined,
      operationType: opts?.operationType || undefined,
    });
    const cs = res.data || res.changeSet;
    if (!cs?.id) {
      throw new KcError(
        500,
        "invalid_response",
        `openChangeSet nevrátil id. Odpověď: ${JSON.stringify(res).slice(0, 300)}`,
        res,
        "POST",
        "/v1/changesets/open",
      );
    }
    return cs;
  }

  async commitChangeSet(id: string): Promise<ChangeSet> {
    const res = await this.request<WriteResponse<ChangeSet>>(
      "POST",
      `/v1/changesets/${encodeURIComponent(id)}/commit`,
      {},
      { idempotencyKey: `cs-commit-${id}-${Date.now()}` },
    );
    this.clearReadCache();
    return res.data || res.changeSet;
  }

  async cancelChangeSet(id: string): Promise<ChangeSet> {
    const res = await this.request<WriteResponse<ChangeSet>>(
      "POST",
      `/v1/changesets/${encodeURIComponent(id)}/cancel`,
      {},
    );
    this.clearReadCache();
    return res.data || res.changeSet;
  }

  /** Append graph ops to the active open ChangeSet (or commit immediately if none). */
  applyChangeSetOperations(body: {
    operationType?: string;
    comment?: string;
    operations: ChangeOperation[];
  }): Promise<WriteResponse<BatchApplyData>> {
    return this.request("POST", "/v1/changesets", body, {
      idempotencyKey: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      validation: this.defaultWriteValidation,
      cs: "write",
    });
  }

  /**
   * Auto mode: open → fn (writes go to overlay) → commit.
   * Manual / nested: just run fn against the already-active write CS.
   */
  async runLogicalChangeSet<T>(
    meta: { operationType?: string; comment?: string },
    fn: () => Promise<T>,
  ): Promise<{ result: T; changeSet: ChangeSet }> {
    const existing = this.effectiveWriteCs();
    if (existing) {
      const result = await fn();
      let changeSet: ChangeSet;
      try {
        changeSet = await this.getChangeSet(existing);
      } catch {
        changeSet = { id: existing, status: "open", operationType: meta.operationType, comment: meta.comment };
      }
      return { result, changeSet };
    }

    const opened = await this.openChangeSet(meta);
    this.autoChangeSetId = opened.id;
    try {
      const result = await fn();
      const committed = await this.commitChangeSet(opened.id);
      return { result, changeSet: committed };
    } catch (e) {
      try {
        await this.cancelChangeSet(opened.id);
      } catch {
        /* best-effort */
      }
      throw e;
    } finally {
      this.autoChangeSetId = null;
    }
  }

  search(q: string, limit = 30): Promise<ListResponse<Entity>> {
    return this.request(
      "GET",
      `/v1/projections/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
  }
}
