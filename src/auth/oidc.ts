/** OIDC PKCE helpers — mirrors Knowledge Core web UI login. */

import type { AuthConfig } from "@itmap/archimate-core";

export type UiConfig = {
  authMode: "dev" | "oidc" | "bootstrap";
  oidcIssuer: string;
  oidcClientId: string;
  oidcAudience: string;
  /** Space-separated OAuth scopes from KC `/v1/ui/config` (`KC_OIDC_SCOPES`). */
  oidcScopes?: string;
  bootstrapAdminSubject?: string;
  uiBasePath?: string;
  oidcRedirectPath?: string;
};

const PKCE_VERIFIER_KEY = "itmap.pkce.verifier";
const OIDC_STATE_KEY = "itmap.oidc.state";
const DEFAULT_OIDC_SCOPES = "openid profile email groups";
/** Refresh this many ms before access/id token expiry. */
export const REFRESH_SKEW_MS = 60_000;

/** ITMap callback path (not KC's /ui/callback). */
export const ITMAP_OIDC_REDIRECT_PATH = "/callback";

type TokenEndpointResponse = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

export type OidcTokenResult = {
  token: string;
  refreshToken?: string;
  expiresAt: number;
};

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function oidcClientId(cfg: UiConfig): string {
  return cfg.oidcClientId || cfg.oidcAudience || "knowledge-core";
}

export function oidcRedirectUri(origin = window.location.origin): string {
  return `${origin}${ITMAP_OIDC_REDIRECT_PATH}`;
}

export async function loadUiConfig(baseUrl = ""): Promise<UiConfig> {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/ui/config`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`ui/config failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as UiConfig;
}

async function oidcDiscovery(issuer: string): Promise<{
  authorization_endpoint: string;
  token_endpoint: string;
}> {
  const base = issuer.replace(/\/$/, "");
  const res = await fetch(`${base}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  return res.json();
}

function applyTokenResponse(tokens: TokenEndpointResponse, prevRefresh?: string): OidcTokenResult {
  const token = tokens.id_token || tokens.access_token;
  if (!token) throw new Error("no token in response");
  const expiresIn = typeof tokens.expires_in === "number" ? tokens.expires_in : 3600;
  return {
    token,
    refreshToken: tokens.refresh_token || prevRefresh,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function startOidcLogin(cfg: UiConfig): Promise<void> {
  if (!cfg.oidcIssuer) throw new Error("OIDC issuer not configured");
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  sessionStorage.setItem(OIDC_STATE_KEY, state);

  const discovery = await oidcDiscovery(cfg.oidcIssuer);
  const params = new URLSearchParams({
    client_id: oidcClientId(cfg),
    response_type: "code",
    scope: (cfg.oidcScopes || "").trim() || DEFAULT_OIDC_SCOPES,
    redirect_uri: oidcRedirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${discovery.authorization_endpoint}?${params}`;
}

export async function finishOidcLogin(
  cfg: UiConfig,
  code: string,
  state: string,
): Promise<OidcTokenResult> {
  const expected = sessionStorage.getItem(OIDC_STATE_KEY);
  if (!expected || expected !== state) throw new Error("invalid OIDC state");
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!verifier) throw new Error("missing PKCE verifier");

  const discovery = await oidcDiscovery(cfg.oidcIssuer);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: oidcClientId(cfg),
    code,
    redirect_uri: oidcRedirectUri(),
    code_verifier: verifier,
  });
  const tokenRes = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) throw new Error(`token exchange failed: ${await tokenRes.text()}`);
  const tokens = (await tokenRes.json()) as TokenEndpointResponse;
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(OIDC_STATE_KEY);
  return applyTokenResponse(tokens);
}

/** Exchange refresh_token at IdP. Throws on failure (caller clears session). */
export async function refreshOidcTokens(
  cfg: UiConfig,
  refreshToken: string,
): Promise<OidcTokenResult> {
  if (!cfg.oidcIssuer) throw new Error("OIDC issuer not configured");
  const discovery = await oidcDiscovery(cfg.oidcIssuer);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: oidcClientId(cfg),
    refresh_token: refreshToken,
  });
  const tokenRes = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) throw new Error(`refresh failed: ${await tokenRes.text()}`);
  const tokens = (await tokenRes.json()) as TokenEndpointResponse;
  return applyTokenResponse(tokens, refreshToken);
}

export function mergeOidcTokens(auth: AuthConfig, tokens: OidcTokenResult): AuthConfig {
  return {
    ...auth,
    mode: "oidc",
    token: tokens.token,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };
}

export function isOidcAccessExpired(auth: AuthConfig, skewMs = REFRESH_SKEW_MS): boolean {
  if (auth.mode !== "oidc") return false;
  if (typeof auth.expiresAt !== "number") return false;
  return Date.now() >= auth.expiresAt - skewMs;
}
