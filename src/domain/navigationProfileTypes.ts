import type { Entity, LangMap } from "../kc/types";
import type { TraversalTemplate } from "./templates";

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityId?: string;
}

export interface UiNavigationProfileMeta {
  id: string;
  iriLocal?: string;
  packageCode?: string;
  labels: LangMap;
  profileCode: string;
  profileVersion?: string;
  minCatalogVersion?: string;
  isSystemDefault?: boolean;
  labelCs?: string;
  labelEn?: string;
  parentProfileId?: string;
}

export interface UiTraversalTemplateMeta {
  id: string;
  iriLocal?: string;
  packageCode?: string;
  parentProfileId: string;
  templateCode: string;
  labelCs: string;
  isDefault?: boolean;
  sortOrder?: number;
  startStageId?: string;
}

export interface UiStageMeta {
  id: string;
  iriLocal?: string;
  packageCode?: string;
  parentTemplateId: string;
  stageCode: string;
  stageOrder: number;
  columnLabelCs: string;
  targetClassLocals: string[];
  actorKinds?: string[];
  instanceFilter?: Record<string, string>;
}

export interface UiTransitionMeta {
  id: string;
  iriLocal?: string;
  packageCode?: string;
  parentTemplateId: string;
  fromStageId: string;
  toStageId: string;
  relationshipClassLocal: string;
  traverseDirection: "model" | "inverse";
  uiEdgeLabelCs: string;
  requireProperty?: { property: string; value?: string };
}

export interface UiAddActionMeta {
  id: string;
  iriLocal?: string;
  packageCode?: string;
  parentTemplateId: string;
  stageId: string;
  actionCode: string;
  domainLabelCs: string;
  createsClassLocal: string;
  sortOrder?: number;
  defaultProperties?: Record<string, string>;
  derivesRelationship?: string;
  relationshipDirection?: "from-selected-to-new" | "from-new-to-selected";
  relationshipDefaults?: Record<string, string>;
}

export interface TemplateBundle {
  meta: UiTraversalTemplateMeta;
  stages: UiStageMeta[];
  transitions: UiTransitionMeta[];
  addActions: UiAddActionMeta[];
}

export interface ProfileBundle {
  meta: UiNavigationProfileMeta;
  templates: TemplateBundle[];
}

export type TemplateSource = "system" | "org" | "override";

export interface ResolvedTemplate {
  template: TraversalTemplate;
  source: TemplateSource;
  templateEntityId: string;
  profileEntityId: string;
}

export interface ResolvedNavigationProfile {
  systemProfile: UiNavigationProfileMeta | null;
  orgProfile: UiNavigationProfileMeta | null;
  orgProfileLinkId: string | null;
  templates: ResolvedTemplate[];
  warnings: ValidationIssue[];
  usedFallback: boolean;
}

export interface NavigationProfileListItem {
  entity: Entity;
  meta: UiNavigationProfileMeta;
}
