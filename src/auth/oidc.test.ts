import { describe, expect, it } from "vitest";
import { ITMAP_OIDC_REDIRECT_PATH, oidcClientId, type UiConfig } from "./oidc";

describe("oidc helpers", () => {
  it("uses ITMap callback path", () => {
    expect(ITMAP_OIDC_REDIRECT_PATH).toBe("/callback");
  });

  it("resolves client id with audience fallback", () => {
    const cfg: UiConfig = {
      authMode: "oidc",
      oidcIssuer: "https://id.example.com",
      oidcClientId: "",
      oidcAudience: "knowledge-core",
    };
    expect(oidcClientId(cfg)).toBe("knowledge-core");
    expect(oidcClientId({ ...cfg, oidcClientId: "my-client" })).toBe("my-client");
  });
});
