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
      oauthScopes: [] as string[],
    };
    const ctx = AppContext.create(config);
    expect(() => ctx.approveWritePackage("archimate-lite")).toThrow(/metamodel/);
  });
});
