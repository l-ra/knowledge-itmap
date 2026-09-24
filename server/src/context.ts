import {
  CardsProfileLoader,
  CardsService,
  KcClient,
  MemorySchemaCache,
  ModelService,
  SchemaResolver,
  ViewService,
  type AuthConfig,
} from "@itmap/archimate-core";
import type { McpServerConfig } from "./config.js";
import { McpSessionState } from "./session.js";

/** Packages that agents must never write to. */
export const METAMODEL_PACKAGES = new Set([
  "archimate-lite",
  "kc-base",
  "archimate-ui-traversal",
  "archimate-ui-cards",
  "architecture-migration",
]);

export class AppContext {
  readonly config: McpServerConfig;
  readonly session: McpSessionState;
  readonly kc: KcClient;
  readonly schema: SchemaResolver;
  readonly model: ModelService;
  readonly cards: CardsService;
  readonly views: ViewService;
  readonly cardsLoader: CardsProfileLoader;
  readonly startedAt: string;
  readonly pid: number;

  private constructor(
    config: McpServerConfig,
    session: McpSessionState,
    kc: KcClient,
    schema: SchemaResolver,
    cardsLoader: CardsProfileLoader,
  ) {
    this.config = config;
    this.session = session;
    this.kc = kc;
    this.schema = schema;
    this.cardsLoader = cardsLoader;
    this.model = new ModelService(kc, schema);
    this.cards = new CardsService(kc, schema, cardsLoader);
    this.views = new ViewService(kc, schema);
    this.startedAt = new Date().toISOString();
    this.pid = process.pid;
  }

  static create(config: McpServerConfig, session?: McpSessionState): AppContext {
    const sess =
      session ??
      new McpSessionState({
        writePackagesAllowlist: config.writePackages,
        defaultPackage: config.defaultPackage,
        lang: config.lang,
        writeMode: config.writeMode,
        authMode: config.authMode,
      });

    const kc = new KcClient({
      baseUrl: config.kcBaseUrl,
      auth: buildAuth(config, sess),
      defaultWriteValidation: "strict",
    });

    const schema = new SchemaResolver({ kc, cache: new MemorySchemaCache() });
    const cardsLoader = new CardsProfileLoader(kc, schema);
    return new AppContext(config, sess, kc, schema, cardsLoader);
  }

  /** Refresh KC auth from session (forward token / service credentials). */
  syncAuth(): void {
    this.kc.setAuth(buildAuth(this.config, this.session));
  }

  async ensureSchemaLoaded(force = false): Promise<void> {
    if (!this.schema.isLoaded() || force) {
      await this.schema.load({ force });
    }
  }

  /**
   * Resolve package for a write operation.
   * Explicit packageCode wins; else session.workingPackage.
   */
  resolveWritePackage(packageCode?: string | null): string {
    const code = (packageCode?.trim() || this.session.workingPackage || "").trim();
    if (!code) {
      throw new Error(
        "No write package: pass packageCode or set workingPackage after approve_write_package",
      );
    }
    this.assertWritable(code);
    return code;
  }

  /**
   * Package scope for list/search/facets.
   * Explicit arg → that package; else workingPackage if set; else undefined (unfiltered).
   */
  resolveReadPackage(packageCode?: string | null): string | undefined {
    if (packageCode !== undefined && packageCode !== null && packageCode !== "") {
      return packageCode.trim();
    }
    return this.session.workingPackage ?? undefined;
  }

  assertWritable(packageCode: string): void {
    if (METAMODEL_PACKAGES.has(packageCode)) {
      throw new Error(`Write denied: metamodel package „${packageCode}“`);
    }
    if (!this.session.writePackagesAllowlist.includes(packageCode)) {
      throw new Error(
        `Write denied: „${packageCode}“ is outside config allowlist [${this.session.writePackagesAllowlist.join(", ")}]`,
      );
    }
    if (!this.session.isApprovedForWrite(packageCode)) {
      throw new Error(
        `Write denied: „${packageCode}“ is not session-approved. Call approve_write_package({ packageCode: \"${packageCode}\", confirm: true }).`,
      );
    }
  }

  /** Approve write for package (allowlist + metamodel checks). */
  approveWritePackage(packageCode: string): void {
    if (METAMODEL_PACKAGES.has(packageCode)) {
      throw new Error(`Write denied: metamodel package „${packageCode}“`);
    }
    this.session.approveWritePackage(packageCode);
  }

  /** @deprecated Use assertWritable / resolveWritePackage. */
  assertOrgPackageWritable(packageCode: string): void {
    this.assertWritable(packageCode);
  }

  /**
   * Ensure auth is usable before KC calls in forward mode.
   */
  assertAuthReady(): void {
    if (this.config.authMode === "forward") {
      this.requireForwardToken();
    }
  }

  async ensureOpenChangeSet(toolName: string): Promise<string> {
    this.syncAuth();
    this.assertAuthReady();
    const existing =
      this.session.activeChangeSetId || this.kc.getManualChangeSetId() || null;
    if (existing) {
      try {
        const cs = await this.kc.getChangeSet(existing);
        if (cs.status === "open") {
          this.kc.setManualChangeSet(existing);
          this.session.activeChangeSetId = existing;
          return existing;
        }
        this.clearActiveChangeSet();
        throw new Error(
          `Active ChangeSet ${existing} is ${cs.status || "not open"} — session cleared. Call open_changeset and retry.`,
        );
      } catch (e) {
        this.clearActiveChangeSet();
        if (e instanceof Error && e.message.includes("session cleared")) throw e;
        throw new Error(
          `Active ChangeSet ${existing} is missing or unreachable — session cleared. Call open_changeset and retry. (${
            e instanceof Error ? e.message : String(e)
          })`,
        );
      }
    }

    const actor = this.config.actor ? ` actor=${this.config.actor}` : "";
    const pkg = this.session.workingPackage ? ` package=${this.session.workingPackage}` : "";
    const cs = await this.kc.openChangeSet({
      operationType: "mcp",
      comment: `mcp:${toolName}${pkg}${actor}`,
    });
    this.kc.setManualChangeSet(cs.id);
    this.session.activeChangeSetId = cs.id;
    return cs.id;
  }

  clearActiveChangeSet(): void {
    this.kc.setManualChangeSet(null);
    this.session.activeChangeSetId = null;
  }

  requireForwardToken(): string {
    if (this.config.authMode !== "forward") {
      throw new Error("forwarded token only applies when ITMAP_MCP_AUTH_MODE=forward");
    }
    const t = this.session.forwardedToken?.trim();
    if (!t) {
      throw new Error(
        "Forward auth mode requires a Bearer token (configure_session / Authorization header)",
      );
    }
    return t;
  }

  /**
   * Effective Bearer token used for Knowledge Core calls — for copy into other apps.
   * service → ITMAP_KC_TOKEN; forward → session forwarded token.
   */
  getAccessToken(): {
    accessToken: string;
    tokenSource: "service" | "forward";
    authMode: "service" | "forward";
    kcAuthMode: McpServerConfig["kcAuthMode"];
    kcBaseUrl: string;
    authorizationHeader: string;
  } {
    if (this.config.authMode === "forward") {
      const accessToken = this.requireForwardToken();
      return {
        accessToken,
        tokenSource: "forward",
        authMode: "forward",
        kcAuthMode: this.config.kcAuthMode,
        kcBaseUrl: this.config.kcBaseUrl,
        authorizationHeader: `Bearer ${accessToken}`,
      };
    }

    const accessToken = this.config.kcToken?.trim() || "";
    if (!accessToken) {
      throw new Error(
        "No service access token configured (ITMAP_KC_TOKEN empty; ITMAP_KC_AUTH_MODE=dev has no bearer to export)",
      );
    }
    return {
      accessToken,
      tokenSource: "service",
      authMode: "service",
      kcAuthMode: this.config.kcAuthMode,
      kcBaseUrl: this.config.kcBaseUrl,
      authorizationHeader: `Bearer ${accessToken}`,
    };
  }
}

function buildAuth(config: McpServerConfig, session: McpSessionState): AuthConfig {
  if (config.authMode === "forward") {
    const token = session.forwardedToken?.trim() || "";
    return {
      mode: "bearer",
      token,
      subject: config.kcSubject,
      roles: config.kcRoles,
    };
  }

  if (config.kcAuthMode === "dev") {
    return {
      mode: "dev",
      subject: config.kcSubject,
      roles: config.kcRoles,
      token: config.kcToken || undefined,
    };
  }

  return {
    mode: config.kcAuthMode,
    token: config.kcToken,
    subject: config.kcSubject,
    roles: config.kcRoles,
  };
}
