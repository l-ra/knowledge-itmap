import { getSchema, type SchemaResolver } from "../kc/schema";
import { NavigationProfileLoader, getNavigationLoader } from "./navigationProfileLoader";
import { mapTemplateBundle } from "./navigationProfileMapper";
import type {
  ResolvedNavigationProfile,
  ResolvedTemplate,
  TemplateSource,
  ValidationIssue,
} from "./navigationProfileTypes";
import { FALLBACK_TEMPLATES, type TraversalTemplate } from "./templates";

function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return true;
    if (da < db) return false;
  }
  return true;
}

export class NavigationProfileResolver {
  private cacheKey = "";
  private cache: ResolvedNavigationProfile | null = null;

  constructor(
    private schema: SchemaResolver = getSchema(),
    private loader: NavigationProfileLoader = getNavigationLoader(),
  ) {}

  invalidate(): void {
    this.cacheKey = "";
    this.cache = null;
    this.loader.clearCache();
  }

  async loadResolvedProfile(orgPackageCode: string): Promise<ResolvedNavigationProfile> {
    const key = `${orgPackageCode}:${this.schema.snapshot.loadedAt}`;
    if (this.cache && this.cacheKey === key) return this.cache;

    const warnings: ValidationIssue[] = [];
    let usedFallback = false;

    const systemProfile = await this.loader.findSystemProfile();
    if (!systemProfile) {
      warnings.push({
        severity: "warning",
        code: "no-system-profile",
        message: "Systémový UiNavigationProfile v KC chybí — použit fallback z kódu",
      });
      const result = this.fallbackResult(null, null, warnings);
      this.cache = result;
      this.cacheKey = key;
      return result;
    }

    let orgProfileLinkId: string | null = null;
    let orgProfile = null;
    try {
      orgProfileLinkId = await this.loader.getOrgProfileLinkId(orgPackageCode);
      if (orgProfileLinkId) {
        orgProfile = await this.loader.loadProfileMeta(orgProfileLinkId);
      }
    } catch (e) {
      warnings.push({
        severity: "warning",
        code: "org-link-error",
        message: e instanceof Error ? e.message : String(e),
      });
    }

    const profileChain: string[] = [systemProfile.id];
    if (orgProfileLinkId && orgProfileLinkId !== systemProfile.id) {
      const orgChain = await this.loader.resolveProfileChain(orgProfileLinkId);
      for (const id of orgChain) {
        if (!profileChain.includes(id)) profileChain.push(id);
      }
    }

    const templateMap = new Map<
      string,
      { bundle: ResolvedTemplate; profileId: string; index: number }
    >();

    for (let pi = 0; pi < profileChain.length; pi++) {
      const profileId = profileChain[pi];
      const profileMeta =
        profileId === systemProfile.id
          ? systemProfile
          : profileId === orgProfile?.id
            ? orgProfile
            : await this.loader.loadProfileMeta(profileId);

      if (
        profileMeta.minCatalogVersion &&
        !semverGte("2.3.0", profileMeta.minCatalogVersion)
      ) {
        warnings.push({
          severity: "warning",
          code: "catalog-version",
          message: `Profil ${profileMeta.profileCode} vyžaduje catalog ${profileMeta.minCatalogVersion}`,
          entityId: profileMeta.id,
        });
      }

      const bundles = await this.loader.loadTemplatesForProfile(profileId);
      for (const bundle of bundles) {
        const { template, issues } = mapTemplateBundle(bundle, this.schema);
        warnings.push(...issues);
        if (!template) continue;

        const isSystemOnly = profileId === systemProfile.id && !orgProfileLinkId;
        const isOrgProfile = orgProfileLinkId === profileId;
        let source: TemplateSource = "system";
        if (isOrgProfile) source = "org";
        else if (!isSystemOnly && pi > 0) source = "override";

        const existing = templateMap.get(template.code);
        templateMap.set(template.code, {
          bundle: {
            template,
            source,
            templateEntityId: bundle.meta.id,
            profileEntityId: profileId,
          },
          profileId,
          index: pi,
        });
        void existing;
      }
    }

    let templates = [...templateMap.values()]
      .sort((a, b) => {
        const ao = a.bundle.template.isDefault ? 0 : 1;
        const bo = b.bundle.template.isDefault ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return a.bundle.template.labelCs.localeCompare(b.bundle.template.labelCs, "cs");
      })
      .map((v) => v.bundle);

    if (!templates.length) {
      usedFallback = true;
      warnings.push({
        severity: "warning",
        code: "empty-profile",
        message: "KC profil neobsahuje platné šablony — použit fallback",
      });
      templates = FALLBACK_TEMPLATES.map((t) => ({
        template: t,
        source: "system" as const,
        templateEntityId: "",
        profileEntityId: systemProfile.id,
      }));
    }

    const result: ResolvedNavigationProfile = {
      systemProfile,
      orgProfile,
      orgProfileLinkId,
      templates,
      warnings,
      usedFallback,
    };
    this.cache = result;
    this.cacheKey = key;
    return result;
  }

  async listTemplates(orgPackageCode: string): Promise<TraversalTemplate[]> {
    const resolved = await this.loadResolvedProfile(orgPackageCode);
    return resolved.templates.map((t) => t.template);
  }

  async getTemplate(orgPackageCode: string, templateCode: string): Promise<TraversalTemplate> {
    const resolved = await this.loadResolvedProfile(orgPackageCode);
    const found = resolved.templates.find((t) => t.template.code === templateCode);
    if (found) return found.template;
    const fallback = FALLBACK_TEMPLATES.find((t) => t.code === templateCode);
    return fallback || FALLBACK_TEMPLATES[0];
  }

  private fallbackResult(
    systemProfile: ResolvedNavigationProfile["systemProfile"],
    orgProfile: ResolvedNavigationProfile["orgProfile"],
    warnings: ValidationIssue[],
  ): ResolvedNavigationProfile {
    return {
      systemProfile,
      orgProfile,
      orgProfileLinkId: null,
      templates: FALLBACK_TEMPLATES.map((t) => ({
        template: t,
        source: "system",
        templateEntityId: "",
        profileEntityId: systemProfile?.id || "",
      })),
      warnings,
      usedFallback: true,
    };
  }
}

let resolverSingleton: NavigationProfileResolver | null = null;

export function getNavigationResolver(): NavigationProfileResolver {
  if (!resolverSingleton) resolverSingleton = new NavigationProfileResolver();
  return resolverSingleton;
}

export function resetNavigationResolver(): void {
  resolverSingleton = null;
}

export function loadStoredTemplateCode(): string {
  try {
    return localStorage.getItem("itmap.templateCode") || "business-exploration";
  } catch {
    return "business-exploration";
  }
}

export function saveStoredTemplateCode(code: string): void {
  try {
    localStorage.setItem("itmap.templateCode", code);
  } catch {
    /* ignore */
  }
}
