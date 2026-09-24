import { describe, expect, it } from "vitest";
import { parsePackageList, resolvePackageConfig } from "./config.js";
import { METAMODEL_PACKAGES, AppContext } from "./context.js";
import { McpSessionState } from "./session.js";

describe("parsePackageList", () => {
  it("splits csv and dedupes", () => {
    expect(parsePackageList("org-ote, org-demo;org-ote")).toEqual(["org-ote", "org-demo"]);
  });
});

describe("resolvePackageConfig", () => {
  it("uses WRITE_PACKAGES and DEFAULT", () => {
    const r = resolvePackageConfig({
      ITMAP_MCP_WRITE_PACKAGES: "org-ote,org-demo",
      ITMAP_MCP_DEFAULT_PACKAGE: "org-ote",
    } as NodeJS.ProcessEnv);
    expect(r.writePackages).toEqual(["org-ote", "org-demo"]);
    expect(r.defaultPackage).toBe("org-ote");
  });

  it("falls back to legacy ORG_PACKAGE", () => {
    const r = resolvePackageConfig({
      ITMAP_MCP_ORG_PACKAGE: "org-demo",
    } as NodeJS.ProcessEnv);
    expect(r.writePackages).toEqual(["org-demo"]);
    expect(r.defaultPackage).toBe("org-demo");
  });

  it("rejects default outside allowlist", () => {
    expect(() =>
      resolvePackageConfig({
        ITMAP_MCP_WRITE_PACKAGES: "org-ote",
        ITMAP_MCP_DEFAULT_PACKAGE: "org-demo",
      } as NodeJS.ProcessEnv),
    ).toThrow(/not in write allowlist/);
  });
});

describe("McpSessionState multipackage", () => {
  it("approves write and sets working package", () => {
    const s = new McpSessionState({
      writePackagesAllowlist: ["org-ote", "org-demo"],
      defaultPackage: "org-ote",
      lang: "cs",
      writeMode: "propose",
      authMode: "service",
    });
    expect(s.workingPackage).toBe("org-ote");
    expect(s.isApprovedForWrite("org-ote")).toBe(false);
    s.approveWritePackage("org-ote");
    expect(s.isApprovedForWrite("org-ote")).toBe(true);
    s.approveWritePackage("org-demo");
    s.configure({ workingPackage: "org-demo" });
    expect(s.workingPackage).toBe("org-demo");
  });

  it("rejects workingPackage when not approved", () => {
    const s = new McpSessionState({
      writePackagesAllowlist: ["org-ote"],
      lang: "cs",
      writeMode: "propose",
      authMode: "service",
    });
    expect(() => s.configure({ workingPackage: "org-ote" })).toThrow(/not session-approved/);
  });

  it("rejects approve outside allowlist", () => {
    const s = new McpSessionState({
      writePackagesAllowlist: ["org-ote"],
      lang: "cs",
      writeMode: "propose",
      authMode: "service",
    });
    expect(() => s.approveWritePackage("org-demo")).toThrow(/not in config allowlist/);
  });
});

describe("AppContext write gate", () => {
  it("denies metamodel even if listed", () => {
    expect(METAMODEL_PACKAGES.has("archimate-lite")).toBe(true);
    const config = {
      kcBaseUrl: "http://localhost:8080",
      writePackages: ["org-ote", "archimate-lite"],
      defaultPackage: "org-ote",
      orgPackage: "org-ote",
      lang: "cs" as const,
      writeMode: "propose" as const,
      authMode: "service" as const,
      kcToken: "x",
      kcAuthMode: "dev" as const,
      kcSubject: "t",
      kcRoles: "admin",
      transport: "stdio" as const,
      httpPort: 3100,
      oeMaxBytes: 1000,
      fileRoots: [] as string[],
      oauthEnabled: false,
      publicUrl: "",
      oauthIssuer: "",
      oauthClientId: "",
      oauthScopes: [] as string[],
    };
    const ctx = AppContext.create(config);
    expect(() => ctx.approveWritePackage("archimate-lite")).toThrow(/metamodel/);
  });
});

function baseConfig(overrides: Partial<Parameters<typeof AppContext.create>[0]> = {}) {
  return {
    kcBaseUrl: "http://localhost:8080",
    writePackages: ["org-ote"],
    defaultPackage: "org-ote",
    orgPackage: "org-ote",
    lang: "cs" as const,
    writeMode: "propose" as const,
    authMode: "service" as const,
    kcToken: "svc-secret",
    kcAuthMode: "bearer" as const,
    kcSubject: "t",
    kcRoles: "admin",
    transport: "stdio" as const,
    httpPort: 3100,
    oeMaxBytes: 1000,
    fileRoots: [] as string[],
    oauthEnabled: false,
    publicUrl: "",
    oauthIssuer: "",
    oauthClientId: "",
    oauthScopes: [] as string[],
    ...overrides,
  };
}

describe("AppContext getAccessToken", () => {
  it("returns service ITMAP_KC_TOKEN", () => {
    const ctx = AppContext.create(baseConfig());
    const t = ctx.getAccessToken();
    expect(t).toEqual({
      accessToken: "svc-secret",
      tokenSource: "service",
      authMode: "service",
      kcAuthMode: "bearer",
      kcBaseUrl: "http://localhost:8080",
      authorizationHeader: "Bearer svc-secret",
    });
  });

  it("returns forwarded session token", () => {
    const session = new McpSessionState({
      writePackagesAllowlist: ["org-ote"],
      defaultPackage: "org-ote",
      lang: "cs",
      writeMode: "propose",
      authMode: "forward",
      forwardedToken: "fwd-jwt",
    });
    const ctx = AppContext.create(baseConfig({ authMode: "forward", kcToken: "" }), session);
    const t = ctx.getAccessToken();
    expect(t.accessToken).toBe("fwd-jwt");
    expect(t.tokenSource).toBe("forward");
    expect(t.authorizationHeader).toBe("Bearer fwd-jwt");
  });

  it("rejects empty service token", () => {
    const ctx = AppContext.create(baseConfig({ kcToken: "", kcAuthMode: "dev" }));
    expect(() => ctx.getAccessToken()).toThrow(/No service access token/);
  });

  it("rejects missing forward token", () => {
    const session = new McpSessionState({
      writePackagesAllowlist: ["org-ote"],
      lang: "cs",
      writeMode: "propose",
      authMode: "forward",
    });
    const ctx = AppContext.create(baseConfig({ authMode: "forward", kcToken: "" }), session);
    expect(() => ctx.getAccessToken()).toThrow(/Forward auth mode requires/);
  });
});
