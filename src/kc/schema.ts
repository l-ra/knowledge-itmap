import {
  SchemaResolver as CoreSchemaResolver,
  entityLabel,
  packageLabel,
  serializeSnapshot,
  hydrateSnapshot,
  type SchemaSnapshot,
  type AllowedRel,
  type SchemaLoadOptions,
  type SchemaResolverOptions,
} from "@itmap/archimate-core";
import { getKc, type KcClient } from "./client";
import { IndexedDbSchemaCache } from "./schemaCache";

export type { SchemaSnapshot, AllowedRel, SchemaLoadOptions, SchemaResolverOptions };
export { entityLabel, packageLabel, serializeSnapshot, hydrateSnapshot };

/** Browser SchemaResolver: getKc + IndexedDB cache by default. */
export class SchemaResolver extends CoreSchemaResolver {
  constructor(opts?: Partial<SchemaResolverOptions> & { kc?: KcClient }) {
    const kc = opts?.kc ?? getKc();
    super({
      kc,
      cache: opts?.cache ?? new IndexedDbSchemaCache(),
    });
  }
}

let schemaSingleton: SchemaResolver | null = null;

export function getSchema(): SchemaResolver {
  if (!schemaSingleton) schemaSingleton = new SchemaResolver();
  return schemaSingleton;
}

/** Test helper — reset singleton between tests. */
export function resetSchemaForTests(): void {
  schemaSingleton = null;
}
