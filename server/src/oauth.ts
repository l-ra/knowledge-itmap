import type { McpServerConfig } from "./config.js";

export type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
};

/** Canonical MCP resource URL (…/mcp). */
export function mcpResourceUrl(publicUrl: string): string {
  const base = publicUrl.replace(/\/+$/, "");
  if (base.endsWith("/mcp")) return base;
  return `${base}/mcp`;
}

export function buildProtectedResourceMetadata(cfg: McpServerConfig): ProtectedResourceMetadata | null {
  if (!cfg.oauthEnabled || !cfg.oauthIssuer || !cfg.publicUrl) return null;
  const scopes = cfg.oauthScopes.length > 0 ? cfg.oauthScopes : ["openid", "profile", "email"];
  return {
    resource: mcpResourceUrl(cfg.publicUrl),
    authorization_servers: [cfg.oauthIssuer.replace(/\/+$/, "")],
    scopes_supported: scopes,
    bearer_methods_supported: ["header"],
  };
}

export function wwwAuthenticateHeader(cfg: McpServerConfig): string {
  const publicBase = (cfg.publicUrl || "").replace(/\/+$/, "") || "http://localhost";
  const metadataUrl = `${publicBase}/.well-known/oauth-protected-resource/mcp`;
  const scopes = cfg.oauthScopes.length > 0 ? cfg.oauthScopes.join(" ") : "openid profile email";
  return `Bearer resource_metadata="${metadataUrl}", scope="${scopes}"`;
}

/** True when HTTP /mcp must reject missing Bearer. */
export function requireBearerOnMcp(cfg: McpServerConfig): boolean {
  return cfg.authMode === "forward" || cfg.oauthEnabled;
}
