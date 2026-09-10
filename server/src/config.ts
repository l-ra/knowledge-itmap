import { parseFileRoots } from "./paths.js";

export type McpLang = "cs" | "en";
export type McpWriteMode = "propose" | "commit";
export type McpAuthMode = "service" | "forward";
export type McpTransport = "stdio" | "http";

export type McpServerConfig = {
  kcBaseUrl: string;
  orgPackage: string;
  lang: McpLang;
  writeMode: McpWriteMode;
  authMode: McpAuthMode;
  /** Service-account / bootstrap credentials for KC. */
  kcToken: string;
  kcAuthMode: "bootstrap" | "dev" | "oidc" | "bearer";
  kcSubject: string;
  kcRoles: string;
  transport: McpTransport;
  httpPort: number;
  oeMaxBytes: number;
  /**
   * Absolute directories allowed for OE file-path tools (realpath).
   * Empty → path tools reject until configured.
   */
  fileRoots: string[];
  /** Optional actor label used in ChangeSet comments / subject. */
  actor?: string;
};

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env ${name}`);
  return v;
}

function parseLang(raw: string | undefined): McpLang {
  const v = (raw || "cs").trim().toLowerCase();
  if (v === "cs" || v === "en") return v;
  throw new Error(`ITMAP_MCP_LANG must be cs|en, got: ${raw}`);
}

function parseWriteMode(raw: string | undefined): McpWriteMode {
  const v = (raw || "propose").trim().toLowerCase();
  if (v === "propose" || v === "commit") return v;
  throw new Error(`ITMAP_MCP_WRITE_MODE must be propose|commit, got: ${raw}`);
}

function parseAuthMode(raw: string | undefined): McpAuthMode {
  const v = (raw || "service").trim().toLowerCase();
  if (v === "service" || v === "forward") return v;
  throw new Error(`ITMAP_MCP_AUTH_MODE must be service|forward, got: ${raw}`);
}

function parseTransport(raw: string | undefined): McpTransport {
  const v = (raw || "stdio").trim().toLowerCase();
  if (v === "stdio" || v === "http") return v;
  throw new Error(`ITMAP_MCP_TRANSPORT must be stdio|http, got: ${raw}`);
}

function parseKcAuthMode(
  raw: string | undefined,
): "bootstrap" | "dev" | "oidc" | "bearer" {
  const v = (raw || "bearer").trim().toLowerCase();
  if (v === "bootstrap" || v === "dev" || v === "oidc" || v === "bearer") return v;
  throw new Error(`ITMAP_KC_AUTH_MODE must be bootstrap|dev|oidc|bearer, got: ${raw}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  const authMode = parseAuthMode(env.ITMAP_MCP_AUTH_MODE);
  const kcAuthMode = parseKcAuthMode(env.ITMAP_KC_AUTH_MODE);
  const kcToken = env.ITMAP_KC_TOKEN?.trim() || "";

  if (authMode === "service" && kcAuthMode !== "dev" && !kcToken) {
    throw new Error(
      "ITMAP_KC_TOKEN is required when ITMAP_MCP_AUTH_MODE=service (unless ITMAP_KC_AUTH_MODE=dev)",
    );
  }

  const oeRaw = env.ITMAP_MCP_OE_MAX_BYTES?.trim();
  const oeMaxBytes = oeRaw ? Number(oeRaw) : 5_000_000;
  if (!Number.isFinite(oeMaxBytes) || oeMaxBytes <= 0) {
    throw new Error(`ITMAP_MCP_OE_MAX_BYTES must be a positive number, got: ${oeRaw}`);
  }

  const portRaw = env.ITMAP_MCP_HTTP_PORT?.trim();
  const httpPort = portRaw ? Number(portRaw) : 3100;
  if (!Number.isFinite(httpPort) || httpPort <= 0) {
    throw new Error(`ITMAP_MCP_HTTP_PORT must be a positive number, got: ${portRaw}`);
  }

  return {
    kcBaseUrl: requireEnv("ITMAP_KC_BASE_URL").replace(/\/+$/, ""),
    orgPackage: requireEnv("ITMAP_MCP_ORG_PACKAGE"),
    lang: parseLang(env.ITMAP_MCP_LANG),
    writeMode: parseWriteMode(env.ITMAP_MCP_WRITE_MODE),
    authMode,
    kcToken,
    kcAuthMode,
    kcSubject: env.ITMAP_KC_SUBJECT?.trim() || env.ITMAP_MCP_ACTOR?.trim() || "itmap-mcp",
    kcRoles: env.ITMAP_KC_ROLES?.trim() || "admin,editor",
    transport: parseTransport(env.ITMAP_MCP_TRANSPORT),
    httpPort,
    oeMaxBytes,
    fileRoots: parseFileRoots(env.ITMAP_MCP_FILE_ROOTS),
    actor: env.ITMAP_MCP_ACTOR?.trim() || undefined,
  };
}
