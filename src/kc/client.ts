export type { AuthConfig } from "@itmap/archimate-core";
export { KcClient, KcError, type KcClientOptions, MemoryReadCache } from "@itmap/archimate-core";
import { KcClient, type AuthConfig } from "@itmap/archimate-core";
import { getBrowserReadCache } from "./readCache";

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

function browserBaseUrl(): string {
  return (import.meta.env.VITE_KC_BASE_URL as string) || "";
}

function readCacheTtlFromEnv(): { staleAfterMs?: number; maxAgeMs?: number } {
  const staleRaw = import.meta.env.VITE_KC_READ_CACHE_STALE_AFTER_MS;
  const maxRaw = import.meta.env.VITE_KC_READ_CACHE_MAX_AGE_MS;
  const staleAfterMs = staleRaw != null && staleRaw !== "" ? Number(staleRaw) : undefined;
  const maxAgeMs = maxRaw != null && maxRaw !== "" ? Number(maxRaw) : undefined;
  return {
    staleAfterMs: Number.isFinite(staleAfterMs) ? staleAfterMs : undefined,
    maxAgeMs: Number.isFinite(maxAgeMs) ? maxAgeMs : undefined,
  };
}

/** Browser KcClient: localStorage auth + Vite base URL + cross-tab read cache. */
export function createBrowserKcClient(auth: AuthConfig = loadAuth()): KcClient {
  const ttl = readCacheTtlFromEnv();
  return new KcClient({
    baseUrl: browserBaseUrl(),
    auth,
    onAuthChange: saveAuth,
    readCache: getBrowserReadCache(),
    readCacheStaleAfterMs: ttl.staleAfterMs,
    readCacheMaxAgeMs: ttl.maxAgeMs,
  });
}

let singleton: KcClient | null = null;

export function getKc(): KcClient {
  if (!singleton) singleton = createBrowserKcClient();
  return singleton;
}

/** Test helper — reset singleton between tests. */
export function resetKcForTests(): void {
  singleton = null;
}
