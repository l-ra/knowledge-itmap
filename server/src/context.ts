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
  }

  static create(config: McpServerConfig, session?: McpSessionState): AppContext {
    const sess =
      session ??
      new McpSessionState({
        orgPackage: config.orgPackage,
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

  assertOrgPackageWritable(packageCode: string): void {
    if (METAMODEL_PACKAGES.has(packageCode)) {
      throw new Error(`Write denied: metamodel package „${packageCode}“`);
    }
    if (packageCode !== this.session.orgPackage) {
      throw new Error(
        `Write denied: package „${packageCode}“ is outside session orgPackage „${this.session.orgPackage}“`,
      );
    }
  }

  /**
   * Ensure an open ChangeSet is bound as manual CS so ModelService / OE do not auto-commit.
   */
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
      this.kc.setManualChangeSet(existing);
      this.session.activeChangeSetId = existing;
      return existing;
    }

    const actor = this.config.actor ? ` actor=${this.config.actor}` : "";
    const cs = await this.kc.openChangeSet({
      operationType: "mcp",
      comment: `mcp:${toolName}${actor}`,
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
