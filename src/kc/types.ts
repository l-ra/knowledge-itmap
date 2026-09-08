/** Knowledge Core API types (subset used by IT Map). */

export type ValueType =
  | "EntityReference"
  | "String"
  | "LocalizedString"
  | "Boolean"
  | "Integer"
  | "Decimal"
  | "Date"
  | "DateTime"
  | "URI"
  | "ExternalIdentifier"
  | "Quantity"
  | "Interval";

export type StatementValue =
  | { type: "EntityReference"; entityId: string }
  | { type: "String"; string: string }
  | { type: "LocalizedString"; langMap: Record<string, string> }
  | { type: "Boolean"; bool: boolean }
  | { type: "Integer"; int64: number }
  | { type: "Decimal"; decimal: string }
  | { type: "Date"; date: string }
  | { type: "DateTime"; dateTime: string }
  | { type: "URI"; uri: string }
  | { type: "ExternalIdentifier"; scheme: string; value: string }
  | { type: "Quantity"; quantityValue: string; unitEntityId?: string }
  | { type: "Interval"; from?: StatementValue; to?: StatementValue };

export type LangMap = Record<string, string>;

export interface EntityIRIAlias {
  iri: string;
  kind: "imported" | "sameAs" | "canonical_export" | string;
}

export interface Entity {
  id: string;
  canonicalId?: string;
  status: string;
  kind: "entity" | "class" | "property";
  revisionNo: number;
  labels: LangMap;
  descriptions?: LangMap;
  packageCode?: string;
  iriLocal?: string;
  iri?: string;
  iriAliases?: EntityIRIAlias[];
  effectiveClasses?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ClassEntity extends Entity {
  kind: "class";
  subClassOf?: string;
}

export interface PropertyEntity extends Entity {
  kind: "property";
  datatype: ValueType;
  constraints?: {
    domainClasses?: string[];
    rangeClasses?: string[];
    minCount?: number;
    maxCount?: number;
  };
}

export interface Statement {
  id: string;
  subject: string;
  property: string;
  value: StatementValue;
  status?: string;
  revisionNo?: number;
  packageCode?: string;
  qualifiers?: Array<{ property: string; value: StatementValue }>;
  validFrom?: string | null;
  validTo?: string | null;
}

export type ChangeSetStatus = "open" | "committed" | "cancelled";

export interface ChangeSetClaim {
  objectType: string;
  objectId?: string;
  canonicalIri?: string;
  baseRevisionNo?: number;
  opKind?: string;
}

export interface ChangeSet {
  id: string;
  canonicalId?: string;
  displayId?: string;
  actor?: string;
  operationType?: string;
  status?: ChangeSetStatus;
  comment?: string;
  openedAt?: string;
  committedAt?: string;
  itemCount?: number;
  items?: Array<{
    objectType: string;
    objectId?: string;
    publicId?: string;
    op: string;
  }>;
  claims?: ChangeSetClaim[];
}

export interface WriteResponse<T> {
  data: T;
  changeSet: ChangeSet;
  validation?: {
    entityId?: string;
    findings: Array<{ severity: string; code: string; message: string }>;
    summary: { errors: number; warnings: number };
  };
}

export interface ListResponse<T> {
  items: T[];
  nextCursor?: string;
}

export interface PackageInfo {
  code: string;
  lifecycle: string;
  iriBase?: string;
  /** Synced with package-root entity labels (class Package). */
  labels: LangMap;
  /** Read-through from package-root entity (GET /v1/packages/{code}). */
  descriptions?: LangMap;
  /** publicId of package-root entity (= iriBase); created automatically with iriBase. */
  rootEntityId?: string;
  dependencies?: Array<{ dependsOnCode: string; versionRange: string }>;
  latestReleaseVersion?: string;
  modifiedAfterRelease?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PackageRelease {
  version: string;
  publishedAt?: string;
}

export interface SchemaConfig {
  instanceOfProperty: string;
  modelProperties?: string[];
  updatedAt?: string;
}

export interface GraphNeighborhood {
  entity: Entity;
  outgoing?: Statement[];
  incoming?: Statement[];
  neighbors?: Entity[];
}

export interface AuthConfig {
  mode: "bootstrap" | "dev" | "oidc" | "bearer";
  token?: string;
  subject?: string;
  roles?: string;
}

export type ArchiClassLocal =
  | "BusinessActor"
  | "BusinessRole"
  | "BusinessFunction"
  | "BusinessProcess"
  | "BusinessService"
  | "ApplicationComponent"
  | "ApplicationService"
  | "ApplicationFunction"
  | "ApplicationProcess"
  | "ApplicationInterface"
  | "ApplicationCollaboration"
  | "ApplicationEvent"
  | "DataObject"
  | "TechnologyService"
  | "TechnologyInterface"
  | "SystemSoftware"
  | "Node"
  | "Device"
  | "Artifact"
  | "CommunicationNetwork"
  | "Path"
  | "Facility"
  | "Location"
  | "Requirement"
  | "Assessment"
  | "Risk"
  | "Gap"
  | "WorkPackage"
  | "Composition"
  | "Aggregation"
  | "Assignment"
  | "Realization"
  | "Serving"
  | "Access"
  | "Flow"
  | "Triggering"
  | "Specialization"
  | "Association"
  | "Influence"
  | "DeployedOn"
  | "AllowedRelationship"
  | "ArchiMateElement"
  | "ArchiMateRelationship";

export type RelClassLocal =
  | "Composition"
  | "Aggregation"
  | "Assignment"
  | "Realization"
  | "Serving"
  | "Access"
  | "Flow"
  | "Triggering"
  | "Specialization"
  | "Association"
  | "Influence"
  | "DeployedOn";
