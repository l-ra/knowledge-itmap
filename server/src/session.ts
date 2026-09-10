import type { McpLang, McpWriteMode } from "./config.js";

export type McpSessionPublicView = {
  orgPackage: string;
  lang: McpLang;
  writeMode: McpWriteMode;
  activeChangeSetId: string | null;
  authMode: "service" | "forward";
  hasForwardedToken: boolean;
};

export type ConfigureSessionInput = {
  lang?: McpLang;
  writeMode?: McpWriteMode;
  /** Rejected if present and different from session orgPackage. */
  orgPackage?: string;
};

/**
 * MCP session state. `orgPackage` is fixed for the lifetime of the session.
 */
export class McpSessionState {
  readonly orgPackage: string;
  lang: McpLang;
  writeMode: McpWriteMode;
  activeChangeSetId: string | null = null;
  forwardedToken: string | null = null;
  readonly authMode: "service" | "forward";

  constructor(opts: {
    orgPackage: string;
    lang: McpLang;
    writeMode: McpWriteMode;
    authMode: "service" | "forward";
    forwardedToken?: string | null;
  }) {
    this.orgPackage = opts.orgPackage;
    this.lang = opts.lang;
    this.writeMode = opts.writeMode;
    this.authMode = opts.authMode;
    this.forwardedToken = opts.forwardedToken ?? null;
  }

  getPublicView(): McpSessionPublicView {
    return {
      orgPackage: this.orgPackage,
      lang: this.lang,
      writeMode: this.writeMode,
      activeChangeSetId: this.activeChangeSetId,
      authMode: this.authMode,
      hasForwardedToken: Boolean(this.forwardedToken),
    };
  }

  configure(input: ConfigureSessionInput): McpSessionPublicView {
    if (input.orgPackage !== undefined && input.orgPackage !== this.orgPackage) {
      throw new Error(
        `orgPackage is fixed for this session (${this.orgPackage}) and cannot be changed to ${input.orgPackage}`,
      );
    }
    if (input.lang) this.lang = input.lang;
    if (input.writeMode) this.writeMode = input.writeMode;
    return this.getPublicView();
  }

  setForwardedToken(token: string | null): void {
    this.forwardedToken = token;
  }
}
