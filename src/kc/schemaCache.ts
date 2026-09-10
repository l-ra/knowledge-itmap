/**
 * Browser IndexedDB persistence for schema snapshots.
 * Serialize/hydrate live in @itmap/archimate-core.
 */
import type { SchemaCachePayload, SchemaCachePort } from "@itmap/archimate-core";

const DB_NAME = "itmap-schema";
const DB_VERSION = 1;
const STORE = "cache";
const CACHE_KEY = "snapshot-v1";

export type { SchemaCachePayload };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

export async function readSchemaCache(): Promise<SchemaCachePayload | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(CACHE_KEY);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const v = req.result as SchemaCachePayload | undefined;
        resolve(v?.version === 1 ? v : null);
      };
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function writeSchemaCache(payload: SchemaCachePayload): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(payload, CACHE_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("schema cache write skipped:", e);
  }
}

export async function clearSchemaCache(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(CACHE_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/** SchemaCachePort backed by IndexedDB. */
export class IndexedDbSchemaCache implements SchemaCachePort {
  read(): Promise<SchemaCachePayload | null> {
    return readSchemaCache();
  }
  write(payload: SchemaCachePayload): Promise<void> {
    return writeSchemaCache(payload);
  }
  clear(): Promise<void> {
    return clearSchemaCache();
  }
}
