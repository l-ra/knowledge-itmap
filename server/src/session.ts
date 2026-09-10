import type { McpLang, McpWriteMode } from "./config.js";

export type McpSessionPublicView = {
  /** @deprecated Alias of workingPackage — kept for older clients. */
  orgPackage: string | null;
  workingPackage: string | null;
  writePackagesAllowlist: string[];
  approvedWritePackages: string[];
  lang: McpLang;
  writeMode: McpWriteMode;
  activeChangeSetId: string | null;
  authMode: "service" | "forward";
  hasForwardedToken: boolean;
};

export type ConfigureSessionInput = {
  lang?: McpLang;
  writeMode?: McpWriteMode;
  /** Set working package (must already be session-approved for write). */
  workingPackage?: string | null;
  /**
   * @deprecated Alias for workingPackage.
   * If provided and different from workingPackage, treated as workingPackage request.
   */
  orgPackage?: string | null;
};

/**
 * MCP session state — multipackage.
 * Read: unrestricted. Write: allowlist ∩ per-session approval.
 */
export class McpSessionState {
  /** Config allowlist (immutable for process lifetime). */
  readonly writePackagesAllowlist: readonly string[];
  workingPackage: string | null;
  private readonly approved = new Set<string>();
  lang: McpLang;
  writeMode: McpWriteMode;
  activeChangeSetId: string | null = null;
  forwardedToken: string | null = null;
  readonly authMode: "service" | "forward";

  constructor(opts: {
    writePackagesAllowlist: string[];
    defaultPackage?: string | null;
    lang: McpLang;
    writeMode: McpWriteMode;
    authMode: "service" | "forward";
    forwardedToken?: string | null;
  }) {
    if (!opts.writePackagesAllowlist.length) {
      throw new Error("writePackagesAllowlist must not be empty");
    }
    this.writePackagesAllowlist = Object.freeze([...opts.writePackagesAllowlist]);
    this.lang = opts.lang;
    this.writeMode = opts.writeMode;
    this.authMode = opts.authMode;
    this.forwardedToken = opts.forwardedToken ?? null;
    const def = opts.defaultPackage ?? null;
    if (def && !this.writePackagesAllowlist.includes(def)) {
      throw new Error(`defaultPackage „${def}“ is not in write allowlist`);
    }
    this.workingPackage = def;
  }

  get approvedWritePackages(): string[] {
    return [...this.approved].sort();
  }

  isApprovedForWrite(packageCode: string): boolean {
    return this.approved.has(packageCode);
  }

  approveWritePackage(packageCode: string): void {
    const code = packageCode.trim();
    if (!code) throw new Error("packageCode is required");
    if (!this.writePackagesAllowlist.includes(code)) {
      throw new Error(
        `Write approval denied: „${code}“ is not in config allowlist [${this.writePackagesAllowlist.join(", ")}]`,
      );
    }
    this.approved.add(code);
    if (!this.workingPackage) this.workingPackage = code;
  }

  revokeWritePackage(packageCode: string): void {
    const code = packageCode.trim();
    this.approved.delete(code);
    if (this.workingPackage === code) {
      this.workingPackage = this.approvedWritePackages[0] ?? null;
    }
  }

  getPublicView(): McpSessionPublicView {
    return {
      orgPackage: this.workingPackage,
      workingPackage: this.workingPackage,
      writePackagesAllowlist: [...this.writePackagesAllowlist],
      approvedWritePackages: this.approvedWritePackages,
      lang: this.lang,
      writeMode: this.writeMode,
      activeChangeSetId: this.activeChangeSetId,
      authMode: this.authMode,
      hasForwardedToken: Boolean(this.forwardedToken),
    };
  }

  configure(input: ConfigureSessionInput): McpSessionPublicView {
    if (input.lang) this.lang = input.lang;
    if (input.writeMode) this.writeMode = input.writeMode;

    const requested =
      input.workingPackage !== undefined
        ? input.workingPackage
        : input.orgPackage !== undefined
          ? input.orgPackage
          : undefined;

    if (requested !== undefined) {
      if (requested === null || requested === "") {
        this.workingPackage = null;
      } else {
        if (!this.approved.has(requested)) {
          throw new Error(
            `workingPackage „${requested}“ is not session-approved for write. Call approve_write_package({ packageCode, confirm: true }) first.`,
          );
        }
        this.workingPackage = requested;
      }
    }
    return this.getPublicView();
  }

  setForwardedToken(token: string | null): void {
    this.forwardedToken = token;
  }
}
