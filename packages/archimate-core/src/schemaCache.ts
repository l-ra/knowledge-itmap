import type { Entity, PropertyEntity } from "./types";

export interface AllowedRelCacheRow {
  typeLocal: string;
  typeIri: string;
  sourceLocal: string;
  sourceIri: string;
  targetLocal: string;
  targetIri: string;
}

/** Serializable SchemaSnapshot (no persistence — adapters store this). */
export interface SchemaCachePayload {
  version: 1;
  fingerprint: string;
  instanceOfProperty: string;
  classesByLocal: Array<[string, Entity]>;
  propertiesByLocal: Array<[string, PropertyEntity]>;
  classIriToLocal: Array<[string, string]>;
  propertyIriToLocal: Array<[string, string]>;
  relSource: string;
  relTarget: string;
  allowed: AllowedRelCacheRow[];
  enums: Array<[string, string[]]>;
  loadedAt: number;
}

/** Persistence port — memory, IndexedDB, disk, etc. */
export interface SchemaCachePort {
  read(): Promise<SchemaCachePayload | null>;
  write(payload: SchemaCachePayload): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory cache (default for Node / MCP / tests). */
export class MemorySchemaCache implements SchemaCachePort {
  private payload: SchemaCachePayload | null = null;

  async read(): Promise<SchemaCachePayload | null> {
    return this.payload;
  }

  async write(payload: SchemaCachePayload): Promise<void> {
    this.payload = payload;
  }

  async clear(): Promise<void> {
    this.payload = null;
  }
}

export type SchemaSnapshotLike = {
  instanceOfProperty: string;
  classesByLocal: Map<string, Entity>;
  propertiesByLocal: Map<string, PropertyEntity>;
  classIriToLocal: Map<string, string>;
  propertyIriToLocal: Map<string, string>;
  relSource: string;
  relTarget: string;
  allowed: AllowedRelCacheRow[];
  enums: Map<string, string[]>;
  loadedAt: number;
};

export function serializeSnapshot(fingerprint: string, snap: SchemaSnapshotLike): SchemaCachePayload {
  return {
    version: 1,
    fingerprint,
    instanceOfProperty: snap.instanceOfProperty,
    classesByLocal: [...snap.classesByLocal.entries()],
    propertiesByLocal: [...snap.propertiesByLocal.entries()],
    classIriToLocal: [...snap.classIriToLocal.entries()],
    propertyIriToLocal: [...snap.propertyIriToLocal.entries()],
    relSource: snap.relSource,
    relTarget: snap.relTarget,
    allowed: snap.allowed,
    enums: [...snap.enums.entries()],
    loadedAt: snap.loadedAt,
  };
}

export function hydrateSnapshot(payload: SchemaCachePayload): SchemaSnapshotLike {
  return {
    instanceOfProperty: payload.instanceOfProperty,
    classesByLocal: new Map(payload.classesByLocal),
    propertiesByLocal: new Map(payload.propertiesByLocal),
    classIriToLocal: new Map(payload.classIriToLocal),
    propertyIriToLocal: new Map(payload.propertyIriToLocal),
    relSource: payload.relSource,
    relTarget: payload.relTarget,
    allowed: payload.allowed,
    enums: new Map(payload.enums),
    loadedAt: payload.loadedAt,
  };
}
