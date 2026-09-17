import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "./config.js";
import {
  buildProtectedResourceMetadata,
  mcpResourceUrl,
  requireBearerOnMcp,
  wwwAuthenticateHeader,
} from "./oauth.js";

function baseCfg(over: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    kcBaseUrl: "http://kc:8080",
    writePackages: ["org-demo"],
    defaultPackage: "org-demo",
    orgPackage: "org-demo",
    lang: "cs",
    writeMode: "propose",
    authMode: "forward",
    kcToken: "",
    kcAuthMode: "oidc",
    kcSubject: "mcp",
    kcRoles: "admin",
    transport: "http",
    httpPort: 3100,
    oeMaxBytes: 5_000_000,
    fileRoots: [],
    oauthEnabled: true,
    publicUrl: "https://itmap.example.com",
    oauthIssuer: "https://id.example.com",
    oauthScopes: ["openid", "profile", "email"],
    ...over,
  };
}

describe("oauth RS helpers", () => {
  it("normalizes resource URL to /mcp", () => {
    expect(mcpResourceUrl("https://itmap.example.com")).toBe("https://itmap.example.com/mcp");
    expect(mcpResourceUrl("https://itmap.example.com/mcp")).toBe("https://itmap.example.com/mcp");
  });

  it("builds PRM when oauth enabled", () => {
    const prm = buildProtectedResourceMetadata(baseCfg());
    expect(prm).toEqual({
      resource: "https://itmap.example.com/mcp",
      authorization_servers: ["https://id.example.com"],
      scopes_supported: ["openid", "profile", "email"],
      bearer_methods_supported: ["header"],
    });
  });

  it("returns null PRM when oauth disabled", () => {
    expect(buildProtectedResourceMetadata(baseCfg({ oauthEnabled: false }))).toBeNull();
  });

  it("builds WWW-Authenticate with resource_metadata", () => {
    const h = wwwAuthenticateHeader(baseCfg());
    expect(h).toContain('resource_metadata="https://itmap.example.com/.well-known/oauth-protected-resource/mcp"');
    expect(h).toContain("Bearer");
  });

  it("requires bearer for forward and oauth", () => {
    expect(requireBearerOnMcp(baseCfg({ authMode: "service", oauthEnabled: false }))).toBe(false);
    expect(requireBearerOnMcp(baseCfg({ authMode: "forward", oauthEnabled: false }))).toBe(true);
    expect(requireBearerOnMcp(baseCfg({ authMode: "service", oauthEnabled: true }))).toBe(true);
  });
});
