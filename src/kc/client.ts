export type { AuthConfig } from "@itmap/archimate-core";
export { KcClient, KcError, type KcClientOptions, MemoryReadCache } from "@itmap/archimate-core";
import { KcClient, type AuthConfig } from "@itmap/archimate-core";
import {
  isOidcAccessExpired,
  loadUiConfig,
  mergeOidcTokens,
  refreshOidcTokens,
} from "@/auth/oidc";
import { getBrowserReadCache } from "./readCache";

const STORAGE_KEY = "itmap.kc.auth";
const ACTIVE_CS_KEY = "itmap.activeChangeSet";
/** Same-tab notify when auth is written outside React (refresh / expiry). */
export const AUTH_CHANGE_EVENT = "itmap.auth-change";

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
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: auth }));
  }
}

/** Clear OIDC tokens (and refresh fields); keep a non-authenticated stub for storage. */
export function clearOidcAuth(fallbackMode: AuthConfig["mode"] = "bootstrap"): AuthConfig {
  const cleared: AuthConfig = {
    mode: fallbackMode === "oidc" ? "bootstrap" : fallbackMode,
    token: "",
    subject: "itmap-dev",
    roles: "admin,editor",
  };
  if (singleton) singleton.replaceAuth(cleared);
  else saveAuth(cleared);
  return cleared;
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

let refreshInFlight: Promise<boolean> | null = null;

async function runOidcRefresh(force: boolean): Promise<boolean> {
  const auth = singleton?.getAuth() ?? loadAuth();
  if (auth.mode !== "oidc") return false;
  if (!force && !isOidcAccessExpired(auth)) return true;
  if (!auth.refreshToken) {
    if (typeof auth.expiresAt === "number" && Date.now() >= auth.expiresAt) {
      clearOidcAuth();
      return false;
    }
    return !force;
  }

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const current = singleton?.getAuth() ?? loadAuth();
      if (!current.refreshToken) {
        clearOidcAuth();
        return false;
      }
      const cfg = await loadUiConfig(browserBaseUrl());
      const tokens = await refreshOidcTokens(cfg, current.refreshToken);
      const next = mergeOidcTokens(current, tokens);
      // Soft update: same subject — keep read cache; persist + notify React.
      singleton?.replaceAuth(next);
      return true;
    } catch {
      clearOidcAuth();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/** Browser KcClient: localStorage auth + Vite base URL + cross-tab read cache + OIDC refresh. */
export function createBrowserKcClient(auth: AuthConfig = loadAuth()): KcClient {
  const ttl = readCacheTtlFromEnv();
  return new KcClient({
    baseUrl: browserBaseUrl(),
    auth,
    onAuthChange: saveAuth,
    beforeRequest: async () => {
      await runOidcRefresh(false);
    },
    onUnauthorized: async () => runOidcRefresh(true),
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
  refreshInFlight = null;
}
