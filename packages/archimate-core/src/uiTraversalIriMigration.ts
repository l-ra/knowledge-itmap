/**
 * Client-side IRI remap for UI traversal vocabulary moved from archimate-lite 2.3.1
 * into package archimate-ui-traversal 1.0.0.
 *
 * Source of truth: ../knowledge-models/migrations/archimate-lite-2.3.1-ui-to-archimate-ui-traversal-1.0.0.json
 * knowledge-core does not rewrite IRIs; clients apply this map when resolving cached IDs.
 */

export const UI_TRAVERSAL_PKG = "archimate-ui-traversal";
export const ARCHIMATE_LITE_PKG = "archimate-lite";

export const UI_TRAVERSAL_FROM_IRI_BASE = "https://knowledge-core.local/archimate-lite/";
export const UI_TRAVERSAL_TO_IRI_BASE = "https://knowledge-core.local/archimate-ui-traversal/";

/** iriLocal values that moved package (prefixRewrite.iriLocals from the migration file). */
export const UI_TRAVERSAL_MOVED_IRI_LOCALS = new Set<string>([
  "UiAddAction",
  "UiNavigationProfile",
  "UiStage",
  "UiTransition",
  "UiTraversalTemplate",
  "actionCode",
  "actorKinds",
  "columnLabelCs",
  "createsClass",
  "defaultProperties",
  "derivesRelationship",
  "domainLabelCs",
  "enum/relationshipDirection",
  "enum/traverseDirection",
  "fromStage",
  "instanceFilter",
  "isDefault",
  "isSystemDefault",
  "labelCs",
  "labelEn",
  "minCatalogVersion",
  "orgNavigationProfile",
  "parentProfile",
  "parentTemplate",
  "profileCode",
  "profileVersion",
  "relationshipClass",
  "relationshipDefaults",
  "relationshipDirection",
  "requireProperty",
  "sortOrder",
  "stage",
  "stageCode",
  "stageOrder",
  "startStage",
  "targetClasses",
  "templateCode",
  "toStage",
  "traverseDirection",
  "ui-add-business-exploration-add-app",
  "ui-add-business-exploration-add-app-service",
  "ui-add-business-exploration-add-biz-service",
  "ui-add-business-exploration-add-data",
  "ui-add-business-exploration-add-dept",
  "ui-add-business-exploration-add-facility",
  "ui-add-business-exploration-add-function",
  "ui-add-business-exploration-add-location",
  "ui-add-business-exploration-add-network",
  "ui-add-business-exploration-add-node",
  "ui-add-business-exploration-add-person",
  "ui-add-business-exploration-add-process",
  "ui-add-business-exploration-add-role",
  "ui-add-business-exploration-add-syssoft",
  "ui-add-business-exploration-add-tech-svc",
  "ui-profile-itmap-default",
  "ui-stage-application-impact-app-services",
  "ui-stage-application-impact-applications",
  "ui-stage-application-impact-organization",
  "ui-stage-application-impact-people-roles",
  "ui-stage-application-impact-processes",
  "ui-stage-business-exploration-app-services",
  "ui-stage-business-exploration-applications",
  "ui-stage-business-exploration-biz-services",
  "ui-stage-business-exploration-data",
  "ui-stage-business-exploration-facilities",
  "ui-stage-business-exploration-functions",
  "ui-stage-business-exploration-network",
  "ui-stage-business-exploration-nodes",
  "ui-stage-business-exploration-organization",
  "ui-stage-business-exploration-people-roles",
  "ui-stage-business-exploration-processes",
  "ui-stage-business-exploration-tech",
  "ui-stage-infrastructure-app-services",
  "ui-stage-infrastructure-applications",
  "ui-stage-infrastructure-facilities",
  "ui-stage-infrastructure-network",
  "ui-stage-infrastructure-nodes",
  "ui-stage-infrastructure-tech",
  "ui-tpl-application-impact",
  "ui-tpl-business-exploration",
  "ui-tpl-infrastructure",
  "ui-trans-application-impact-01",
  "ui-trans-application-impact-02",
  "ui-trans-application-impact-03",
  "ui-trans-application-impact-04",
  "ui-trans-business-exploration-01",
  "ui-trans-business-exploration-02",
  "ui-trans-business-exploration-03",
  "ui-trans-business-exploration-04",
  "ui-trans-business-exploration-05",
  "ui-trans-business-exploration-06",
  "ui-trans-business-exploration-07",
  "ui-trans-business-exploration-08",
  "ui-trans-business-exploration-09",
  "ui-trans-business-exploration-10",
  "ui-trans-business-exploration-11",
  "ui-trans-business-exploration-12",
  "ui-trans-business-exploration-13",
  "ui-trans-business-exploration-14",
  "ui-trans-business-exploration-15",
  "ui-trans-business-exploration-16",
  "ui-trans-business-exploration-17",
  "ui-trans-business-exploration-18",
  "ui-trans-business-exploration-19",
  "ui-trans-infrastructure-01",
  "ui-trans-infrastructure-02",
  "ui-trans-infrastructure-03",
  "ui-trans-infrastructure-04",
  "ui-trans-infrastructure-05",
  "uiEdgeLabelCs",
]);

/** Rewrite a cached archimate-lite UI metadata IRI to archimate-ui-traversal, if applicable. */
export function rewriteUiTraversalIri(iri: string): string {
  if (!iri.startsWith(UI_TRAVERSAL_FROM_IRI_BASE)) return iri;
  const local = iri.slice(UI_TRAVERSAL_FROM_IRI_BASE.length);
  if (!UI_TRAVERSAL_MOVED_IRI_LOCALS.has(local)) return iri;
  return UI_TRAVERSAL_TO_IRI_BASE + local;
}

/** Index both current and legacy IRIs so lookups work against pre-migration caches. */
export function indexWithUiTraversalAliases(
  iriToLocal: Map<string, string>,
  local: string,
  currentIri: string,
): void {
  iriToLocal.set(currentIri, local);
  if (!UI_TRAVERSAL_MOVED_IRI_LOCALS.has(local)) return;
  const legacy = UI_TRAVERSAL_FROM_IRI_BASE + local;
  if (legacy !== currentIri) iriToLocal.set(legacy, local);
}
