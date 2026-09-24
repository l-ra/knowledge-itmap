import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "./config.js";
import { tokenUiEnabled } from "./config.js";
import {
  buildTokenUiPublicConfig,
  TOKEN_UI_CALLBACK_PATH,
  TOKEN_UI_PATH,
} from "./tokenUi.js";

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
    oauthEnabled: false,
    publicUrl: "https://itmap.example.com",
    oauthIssuer: "https://id.example.com",
    oauthClientId: "knowledge-core",
    oauthScopes: ["openid", "profile", "email", "groups"],
    ...over,
  };
}

describe("token UI", () => {
  it("enables when issuer + clientId present", () => {
    expect(tokenUiEnabled(baseCfg())).toBe(true);
    expect(tokenUiEnabled(baseCfg({ oauthIssuer: "" }))).toBe(false);
    expect(tokenUiEnabled(baseCfg({ oauthClientId: "" }))).toBe(false);
  });

  it("exposes public config for browser PKCE", () => {
    const pub = buildTokenUiPublicConfig(baseCfg());
    expect(pub).toMatchObject({
      enabled: true,
      oidcIssuer: "https://id.example.com",
      oidcClientId: "knowledge-core",
      oidcScopes: "openid profile email groups",
      redirectPath: TOKEN_UI_CALLBACK_PATH,
      mcpPath: "/mcp",
      kcBaseUrl: "http://kc:8080",
    });
    expect(TOKEN_UI_PATH).toBe("/token");
  });
});
