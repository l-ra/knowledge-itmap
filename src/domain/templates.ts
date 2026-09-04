import type { ArchiClassLocal, RelClassLocal } from "../kc/types";

/** One column / stage in the column browser. */
export interface StageDef {
  code: string;
  labelCs: string;
  /** Primary ArchiMate classes shown in this column */
  classes: ArchiClassLocal[];
  /** Optional instance filter on a property (e.g. actorKind=organizationalUnit for org roots) */
  filter?: { property: string; value: string };
  /** Soft filter for display grouping (AML 3.1.0 actorKind values) */
  actorKinds?: Array<"person" | "organizationalUnit" | "organization">;
}

export interface TransitionDef {
  from: string;
  to: string;
  relationship: RelClassLocal;
  /** model = follow ArchiMate direction; inverse = navigate opposite of Serving etc. */
  direction: "model" | "inverse";
  edgeLabelCs: string;
  /** Optional: require associationKind / accessMode on the relationship */
  requireProperty?: { property: string; value?: string };
}

export interface AddActionDef {
  stage: string;
  code: string;
  labelCs: string;
  createsClass: ArchiClassLocal;
  /** Properties set on create */
  defaults?: Record<string, string>;
  derivesRelationship?: RelClassLocal;
  /** from-selected-to-new | from-new-to-selected */
  relationshipDirection?: "from-selected-to-new" | "from-new-to-selected";
  relationshipDefaults?: Record<string, string>;
}

export interface TraversalTemplate {
  code: string;
  labelCs: string;
  isDefault?: boolean;
  stages: StageDef[];
  transitions: TransitionDef[];
  addActions: AddActionDef[];
}

/** Default Business exploration — full depth Organization → Location/Network. */
export const BUSINESS_EXPLORATION: TraversalTemplate = {
  code: "business-exploration",
  labelCs: "Business exploration",
  isDefault: true,
  stages: [
    {
      code: "organization",
      labelCs: "Organizace",
      classes: ["BusinessActor"],
      actorKinds: ["organizationalUnit"],
    },
    {
      code: "people-roles",
      labelCs: "Lidé / Role",
      classes: ["BusinessActor", "BusinessRole"],
      actorKinds: ["person"],
    },
    {
      code: "functions",
      labelCs: "Oblasti odpovědnosti",
      classes: ["BusinessFunction"],
    },
    {
      code: "processes",
      labelCs: "Procesy",
      classes: ["BusinessProcess"],
    },
    {
      code: "biz-services",
      labelCs: "Business služby",
      classes: ["BusinessService"],
    },
    {
      code: "app-services",
      labelCs: "Aplikační služby",
      classes: ["ApplicationService"],
    },
    {
      code: "applications",
      labelCs: "Aplikace",
      classes: ["ApplicationComponent"],
    },
    {
      code: "data",
      labelCs: "Data",
      classes: ["DataObject"],
    },
    {
      code: "tech",
      labelCs: "Technologie",
      classes: ["SystemSoftware", "TechnologyService"],
    },
    {
      code: "nodes",
      labelCs: "Uzly",
      classes: ["Node", "Device"],
    },
    {
      code: "network",
      labelCs: "Síť",
      classes: ["CommunicationNetwork", "Path"],
    },
    {
      code: "facilities",
      labelCs: "Lokality",
      classes: ["Facility", "Location"],
    },
  ],
  transitions: [
    {
      from: "organization",
      to: "people-roles",
      relationship: "Composition",
      direction: "model",
      edgeLabelCs: "Obsahuje",
    },
    {
      from: "organization",
      to: "people-roles",
      relationship: "Assignment",
      direction: "model",
      edgeLabelCs: "Má roli",
    },
    {
      from: "people-roles",
      to: "people-roles",
      relationship: "Assignment",
      direction: "model",
      edgeLabelCs: "Přiřazeno",
    },
    {
      from: "people-roles",
      to: "functions",
      relationship: "Assignment",
      direction: "model",
      edgeLabelCs: "Odpovídá za",
    },
    {
      from: "organization",
      to: "functions",
      relationship: "Assignment",
      direction: "model",
      edgeLabelCs: "Odpovídá za",
    },
    {
      from: "functions",
      to: "processes",
      relationship: "Composition",
      direction: "model",
      edgeLabelCs: "Obsahuje",
    },
    {
      from: "functions",
      to: "biz-services",
      relationship: "Realization",
      direction: "model",
      edgeLabelCs: "Realizuje",
    },
    {
      from: "processes",
      to: "biz-services",
      relationship: "Realization",
      direction: "model",
      edgeLabelCs: "Realizuje",
    },
    {
      from: "processes",
      to: "app-services",
      relationship: "Serving",
      direction: "inverse",
      edgeLabelCs: "Podporováno",
    },
    {
      from: "functions",
      to: "app-services",
      relationship: "Serving",
      direction: "inverse",
      edgeLabelCs: "Podporováno",
    },
    {
      from: "biz-services",
      to: "app-services",
      relationship: "Serving",
      direction: "inverse",
      edgeLabelCs: "Podporováno",
    },
    {
      from: "app-services",
      to: "applications",
      relationship: "Realization",
      direction: "inverse",
      edgeLabelCs: "Realizováno",
    },
    {
      from: "applications",
      to: "data",
      relationship: "Access",
      direction: "model",
      edgeLabelCs: "Přistupuje",
    },
    {
      from: "applications",
      to: "tech",
      relationship: "DeployedOn",
      direction: "model",
      edgeLabelCs: "Běží na",
    },
    {
      from: "applications",
      to: "tech",
      relationship: "Serving",
      direction: "inverse",
      edgeLabelCs: "Závisí na",
    },
    {
      from: "tech",
      to: "nodes",
      relationship: "Assignment",
      direction: "model",
      edgeLabelCs: "Na uzlu",
    },
    {
      from: "nodes",
      to: "network",
      relationship: "Association",
      direction: "model",
      edgeLabelCs: "Síť",
    },
    {
      from: "nodes",
      to: "facilities",
      relationship: "Association",
      direction: "model",
      edgeLabelCs: "Umístění",
    },
    {
      from: "facilities",
      to: "facilities",
      relationship: "Association",
      direction: "model",
      edgeLabelCs: "Lokace",
    },
  ],
  addActions: [
    {
      stage: "organization",
      code: "add-dept",
      labelCs: "Organizační jednotka",
      createsClass: "BusinessActor",
      defaults: { actorKind: "organizationalUnit", organizationScope: "internal" },
      derivesRelationship: "Composition",
      relationshipDirection: "from-selected-to-new",
    },
    {
      stage: "people-roles",
      code: "add-person",
      labelCs: "Osoba",
      createsClass: "BusinessActor",
      defaults: { actorKind: "person", organizationScope: "internal" },
      derivesRelationship: "Composition",
      relationshipDirection: "from-selected-to-new",
    },
    {
      stage: "people-roles",
      code: "add-role",
      labelCs: "Role",
      createsClass: "BusinessRole",
      derivesRelationship: "Assignment",
      relationshipDirection: "from-selected-to-new",
    },
    {
      stage: "functions",
      code: "add-function",
      labelCs: "Oblast odpovědnosti",
      createsClass: "BusinessFunction",
      derivesRelationship: "Assignment",
      relationshipDirection: "from-selected-to-new",
    },
    {
      stage: "processes",
      code: "add-process",
      labelCs: "Proces / aktivita",
      createsClass: "BusinessProcess",
      derivesRelationship: "Composition",
      relationshipDirection: "from-selected-to-new",
    },
    {
      stage: "biz-services",
      code: "add-biz-service",
      labelCs: "Business služba",
      createsClass: "BusinessService",
      derivesRelationship: "Realization",
      relationshipDirection: "from-selected-to-new",
    },
    {
      stage: "app-services",
      code: "add-app-service",
      labelCs: "Aplikační služba",
      createsClass: "ApplicationService",
      derivesRelationship: "Serving",
      relationshipDirection: "from-new-to-selected",
    },
    {
      stage: "applications",
      code: "add-app",
      labelCs: "Aplikace / systém",
      createsClass: "ApplicationComponent",
      defaults: { ownership: "internal" },
      derivesRelationship: "Realization",
      relationshipDirection: "from-new-to-selected",
    },
    {
      stage: "data",
      code: "add-data",
      labelCs: "Datový objekt",
      createsClass: "DataObject",
      derivesRelationship: "Access",
      relationshipDirection: "from-selected-to-new",
      relationshipDefaults: { accessMode: "readWrite" },
    },
    {
      stage: "tech",
      code: "add-syssoft",
      labelCs: "System software / runtime",
      createsClass: "SystemSoftware",
      derivesRelationship: "DeployedOn",
      relationshipDirection: "from-selected-to-new",
    },
    {
      stage: "tech",
      code: "add-tech-svc",
      labelCs: "Technologická služba",
      createsClass: "TechnologyService",
      derivesRelationship: "Serving",
      relationshipDirection: "from-new-to-selected",
    },
    {
      stage: "nodes",
      code: "add-node",
      labelCs: "Uzel / cluster",
      createsClass: "Node",
      derivesRelationship: "Assignment",
      relationshipDirection: "from-selected-to-new",
    },
    {
      stage: "network",
      code: "add-network",
      labelCs: "Síťový segment",
      createsClass: "CommunicationNetwork",
      defaults: { networkKind: "vlan", networkRole: "production" },
      derivesRelationship: "Association",
      relationshipDirection: "from-selected-to-new",
      relationshipDefaults: { associationKind: "memberOf" },
    },
    {
      stage: "facilities",
      code: "add-facility",
      labelCs: "Areál / DC",
      createsClass: "Facility",
      derivesRelationship: "Association",
      relationshipDirection: "from-selected-to-new",
      relationshipDefaults: { associationKind: "locatedIn" },
    },
    {
      stage: "facilities",
      code: "add-location",
      labelCs: "Geografická lokace",
      createsClass: "Location",
      derivesRelationship: "Association",
      relationshipDirection: "from-selected-to-new",
    },
  ],
};

export const APPLICATION_IMPACT: TraversalTemplate = {
  code: "application-impact",
  labelCs: "Application impact",
  stages: [
    { code: "applications", labelCs: "Aplikace", classes: ["ApplicationComponent"] },
    { code: "app-services", labelCs: "Aplikační služby", classes: ["ApplicationService"] },
    { code: "processes", labelCs: "Procesy", classes: ["BusinessProcess", "BusinessFunction"] },
    { code: "people-roles", labelCs: "Role", classes: ["BusinessRole"] },
    { code: "organization", labelCs: "Organizace", classes: ["BusinessActor"] },
  ],
  transitions: [
    {
      from: "applications",
      to: "app-services",
      relationship: "Realization",
      direction: "model",
      edgeLabelCs: "Realizuje",
    },
    {
      from: "app-services",
      to: "processes",
      relationship: "Serving",
      direction: "model",
      edgeLabelCs: "Podporuje",
    },
    {
      from: "processes",
      to: "people-roles",
      relationship: "Assignment",
      direction: "inverse",
      edgeLabelCs: "Přiřazeno",
    },
    {
      from: "people-roles",
      to: "organization",
      relationship: "Composition",
      direction: "inverse",
      edgeLabelCs: "Součást",
    },
  ],
  addActions: [],
};

export const INFRASTRUCTURE: TraversalTemplate = {
  code: "infrastructure",
  labelCs: "Infrastructure",
  stages: [
    { code: "nodes", labelCs: "Uzly", classes: ["Node"] },
    { code: "tech", labelCs: "Software", classes: ["SystemSoftware"] },
    { code: "applications", labelCs: "Aplikace", classes: ["ApplicationComponent"] },
    { code: "app-services", labelCs: "Služby", classes: ["ApplicationService"] },
    { code: "network", labelCs: "Síť", classes: ["CommunicationNetwork"] },
    { code: "facilities", labelCs: "Lokality", classes: ["Facility", "Location"] },
  ],
  transitions: [
    {
      from: "nodes",
      to: "tech",
      relationship: "Assignment",
      direction: "inverse",
      edgeLabelCs: "Hostuje",
    },
    {
      from: "tech",
      to: "applications",
      relationship: "DeployedOn",
      direction: "inverse",
      edgeLabelCs: "Nasazeno",
    },
    {
      from: "applications",
      to: "app-services",
      relationship: "Realization",
      direction: "model",
      edgeLabelCs: "Realizuje",
    },
    {
      from: "nodes",
      to: "network",
      relationship: "Association",
      direction: "model",
      edgeLabelCs: "Síť",
    },
    {
      from: "nodes",
      to: "facilities",
      relationship: "Association",
      direction: "model",
      edgeLabelCs: "Umístění",
    },
  ],
  addActions: [],
};

/** Built-in fallback when KC navigation profile is unavailable. */
export const FALLBACK_TEMPLATES: TraversalTemplate[] = [
  BUSINESS_EXPLORATION,
  APPLICATION_IMPACT,
  INFRASTRUCTURE,
];

/** @deprecated Use NavigationProfileResolver — kept for tests and fallback. */
export const TEMPLATES = FALLBACK_TEMPLATES;

export function getTemplate(code: string): TraversalTemplate {
  return FALLBACK_TEMPLATES.find((t) => t.code === code) || BUSINESS_EXPLORATION;
}
