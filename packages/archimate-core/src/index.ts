export type * from "./types";
export { KcError, formatAppError, logAppError, structuredAppError, extractValidationPayload, validationFromKcError } from "./errors";
export { KcClient, type KcClientOptions } from "./kcClient";
export type { AuthConfig } from "./types";
export {
  MemoryReadCache,
  hashJson,
  canonicalReadKey,
  DEFAULT_READ_CACHE_STALE_AFTER_MS,
  DEFAULT_READ_CACHE_MAX_AGE_MS,
  type ReadCachePort,
  type ReadCacheEntry,
} from "./readCache";
export {
  SchemaResolver,
  entityLabel,
  packageLabel,
  serializeSnapshot,
  hydrateSnapshot,
  MemorySchemaCache,
  type SchemaSnapshot,
  type AllowedRel,
  type SchemaLoadOptions,
  type SchemaResolverOptions,
  type SchemaCachePort,
  type SchemaCachePayload,
} from "./schema";
export { schemaFingerprint, SCHEMA_PACKAGE_CODES } from "./schemaFingerprint";
export {
  UI_TRAVERSAL_PKG,
  ARCHIMATE_LITE_PKG,
  UI_TRAVERSAL_FROM_IRI_BASE,
  UI_TRAVERSAL_TO_IRI_BASE,
  rewriteUiTraversalIri,
  indexWithUiTraversalAliases,
  UI_TRAVERSAL_MOVED_IRI_LOCALS,
} from "./uiTraversalIriMigration";
export { assertAllowed, type AllowedRelationshipSchema } from "./allowedRelationship";
export {
  ModelService,
  valueToDisplay,
  APPLY_OPERATIONS_SOFT_LIMIT,
  type CreateElementInput,
  type LinkElementInput,
  type CreateResult,
  type ModelAddAction,
  type GraphApplyOperation,
} from "./modelService";
export {
  GraphMutationService,
  projectRelationImpact,
  toStatementValue,
  resolveInstanceOfWriteMode,
  type StrictRelationsMode,
  type ReclassifyWriteMode,
  type IncidentRelationship,
  type InvalidRelationship,
  type ReclassifyEntityResult,
  type StatementValueType,
} from "./graphMutations";
export {
  getClassConstraints,
  missingRequiredPropLocals,
  FALLBACK_REQUIRED_BY_CLASS,
  type ClassConstraints,
  type ClassConstraintProperty,
} from "./classConstraints";
export * from "./propertyEdit";
export {
  ViewService,
  type ViewBounds,
  type CreateViewInput,
  type AddViewNodeInput,
  type UpdateViewNodeInput,
  type AddViewConnectionInput,
  type UpdateViewConnectionInput,
  type ViewDetail,
} from "./views/viewService";
export {
  getModelingPrimer,
  MODELING_PRIMER,
  MODELING_PRIMER_CS,
  MODELING_PRIMER_EN,
  type PrimerLang,
} from "./primer";

export * from "./cards/index";
export * from "./openExchange/index";
