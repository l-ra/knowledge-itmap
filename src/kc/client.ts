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

export class KcClient {
  constructor(private auth: AuthConfig = loadAuth()) {}

  setAuth(auth: AuthConfig): void {
    this.auth = auth;
    saveAuth(auth);
  }

  getAuth(): AuthConfig {
    return this.auth;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { idempotencyKey?: string; validation?: string },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...authHeaders(this.auth),
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts?.validation) headers["X-Validation-Mode"] = opts.validation;

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
    dependencies?: Array<{ dependsOnCode: string; versionRange: string }>;
  }): Promise<WriteResponse<PackageInfo>> {
    return this.request("POST", "/v1/packages", body, {
      idempotencyKey: `pkg-${body.code}`,
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
    return this.request("GET", `/v1/entities?${q}`);
  }

  getEntity(id: string): Promise<Entity> {
    return this.request("GET", `/v1/entities/${encodeURIComponent(id)}`);
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
    });
  }

  patchEntity(
    id: string,
    body: { labels?: Record<string, string>; descriptions?: Record<string, string>; expectedRevision?: number },
  ): Promise<WriteResponse<Entity>> {
    return this.request("PATCH", `/v1/entities/${encodeURIComponent(id)}`, body, {
      idempotencyKey: `patch-${id}-${Date.now()}`,
    });
  }

  getStatements(id: string, property?: string): Promise<ListResponse<Statement>> {
    const q = property ? `?property=${encodeURIComponent(property)}` : "";
    return this.request("GET", `/v1/entities/${encodeURIComponent(id)}/statements${q}`);
  }

  getIncoming(id: string, property?: string): Promise<ListResponse<Statement>> {
    const q = property ? `?property=${encodeURIComponent(property)}` : "";
    return this.request("GET", `/v1/entities/${encodeURIComponent(id)}/incoming${q}`);
  }

  getGraph(id: string, depth = 1): Promise<GraphNeighborhood> {
    return this.request("GET", `/v1/entities/${encodeURIComponent(id)}/graph?depth=${depth}`);
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
    });
  }

  reviseStatement(
    id: string,
    body: { value?: StatementValue; expectedRevision?: number },
  ): Promise<WriteResponse<Statement>> {
    return this.request("POST", `/v1/statements/${encodeURIComponent(id)}/revise`, body, {
      idempotencyKey: `rev-${id}-${Date.now()}`,
    });
  }

  listProperties(packageCode: string): Promise<ListResponse<PropertyEntity>> {
    return this.request(
      "GET",
      `/v1/entities?package=${encodeURIComponent(packageCode)}&kind=property&limit=200`,
    ) as Promise<ListResponse<PropertyEntity>>;
  }

  listClasses(packageCode: string): Promise<ListResponse<Entity>> {
    return this.request(
      "GET",
      `/v1/entities?package=${encodeURIComponent(packageCode)}&kind=class&limit=200`,
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
    });
  }

  listChangeSets(limit = 50): Promise<ListResponse<ChangeSet>> {
    return this.request("GET", `/v1/changesets?limit=${limit}`);
  }

  getChangeSet(id: string): Promise<ChangeSet> {
    return this.request("GET", `/v1/changesets/${encodeURIComponent(id)}`);
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
