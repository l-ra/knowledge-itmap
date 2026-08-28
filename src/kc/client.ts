export type { AuthConfig } from "./types";
import type {
  AuthConfig,
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
} from "./types";

const STORAGE_KEY = "itmap.kc.auth";
const ACTIVE_CS_KEY = "itmap.activeChangeSet";

export type StoredActiveChangeSet = {
  id: string;
  status: string;
  comment?: string;
  openedAt?: string;
  actor?: string;
  claimCount?: number;
};

export function loadAuth(): AuthConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AuthConfig;
  } catch {
    /* ignore */
  }
  const mode = (import.meta.env.VITE_KC_AUTH_MODE as AuthConfig["mode"]) || "bootstrap";
  return {
    mode,
    token: import.meta.env.VITE_KC_TOKEN || "",
    subject: "itmap-dev",
    roles: "admin,editor",
  };
}

export function saveAuth(auth: AuthConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function loadOrgPackage(): string {
  return localStorage.getItem("itmap.orgPackage") || import.meta.env.VITE_ORG_PACKAGE || "org-demo";
}

export function saveOrgPackage(code: string): void {
  localStorage.setItem("itmap.orgPackage", code);
}

export function loadStoredActiveChangeSet(): StoredActiveChangeSet | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_CS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredActiveChangeSet;
  } catch {
    return null;
  }
}

export function storeActiveChangeSet(cs: StoredActiveChangeSet | null): void {
  if (!cs) sessionStorage.removeItem(ACTIVE_CS_KEY);
  else sessionStorage.setItem(ACTIVE_CS_KEY, JSON.stringify(cs));
}

function baseUrl(): string {
  // Empty = same origin (Vite proxy in dev)
  return (import.meta.env.VITE_KC_BASE_URL as string) || "";
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

export class KcError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "KcError";
  }
}

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

type RequestOpts = {
  idempotencyKey?: string;
  validation?: string;
  /** Attach open CS headers for graph write/read (packages/search never use this). */
  cs?: "write" | "read";
};

export class KcClient {
  private manualChangeSetId: string | null = null;
  private autoChangeSetId: string | null = null;

  constructor(private auth: AuthConfig = loadAuth()) {}

  setAuth(auth: AuthConfig): void {
    this.auth = auth;
    saveAuth(auth);
  }

  getAuth(): AuthConfig {
    return this.auth;
  }

  setManualChangeSet(id: string | null): void {
    this.manualChangeSetId = id;
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
      const id = this.effectiveReadCs();
      if (id) headers["X-Knowledge-Changesets"] = id;
    }

    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return undefined as T;

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
      const err = json as { error?: { code?: string; message?: string } } | null;
      throw new KcError(
        res.status,
        err?.error?.code || "error",
        err?.error?.message || `HTTP ${res.status}`,
        json,
      );
    }
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
  }): Promise<ListResponse<Entity>> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    return this.request("GET", `/v1/entities?${q}`, undefined, { cs: "read" });
  }

  getEntity(id: string): Promise<Entity> {
    return this.request("GET", `/v1/entities/${encodeURIComponent(id)}`, undefined, { cs: "read" });
  }

  createEntity(body: {
    packageCode: string;
    labels: Record<string, string>;
    descriptions?: Record<string, string>;
    iriLocal?: string;
  }): Promise<WriteResponse<Entity>> {
    return this.request("POST", "/v1/entities", body, {
      idempotencyKey: `ent-${body.packageCode}-${body.iriLocal || crypto.randomUUID()}`,
      validation: "relaxed",
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
    const json = await this.request<unknown>(
      "GET",
      `/v1/entities/${encodeURIComponent(id)}/statements?${q}`,
      undefined,
      { cs: "read" },
    );
    return asListResponse<Statement>(json, ["statements"]);
  }

  async getIncoming(id: string, property?: string): Promise<ListResponse<Statement>> {
    const q = new URLSearchParams({ limit: "200" });
    if (property) q.set("property", property);
    const json = await this.request<unknown>(
      "GET",
      `/v1/entities/${encodeURIComponent(id)}/incoming?${q}`,
      undefined,
      { cs: "read" },
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
      validation: "relaxed",
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
    return res.data || res.changeSet;
  }

  async commitChangeSet(id: string): Promise<ChangeSet> {
    const res = await this.request<WriteResponse<ChangeSet>>(
      "POST",
      `/v1/changesets/${encodeURIComponent(id)}/commit`,
      {},
      { idempotencyKey: `cs-commit-${id}-${Date.now()}` },
    );
    return res.data || res.changeSet;
  }

  async cancelChangeSet(id: string): Promise<ChangeSet> {
    const res = await this.request<WriteResponse<ChangeSet>>(
      "POST",
      `/v1/changesets/${encodeURIComponent(id)}/cancel`,
      {},
    );
    return res.data || res.changeSet;
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

let singleton: KcClient | null = null;

export function getKc(): KcClient {
  if (!singleton) singleton = new KcClient();
  return singleton;
}
