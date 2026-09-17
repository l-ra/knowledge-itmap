/**
 * Browser IndexedDB + BroadcastChannel read cache for KcClient.
 * Memory L1 + IDB L2; invalidate-all is broadcast across tabs.
 */
import type { ReadCacheEntry, ReadCachePort } from "@itmap/archimate-core";
import { MemoryReadCache } from "@itmap/archimate-core";

const DB_NAME = "itmap-kc-read";
const DB_VERSION = 1;
const STORE = "entries";
const CHANNEL = "itmap-kc-read-cache";
const MAX_ENTRIES = 500;

type StoredEntry = ReadCacheEntry & { accessedAt: number };

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

async function idbGet(key: string): Promise<StoredEntry | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const v = req.result as StoredEntry | undefined;
        resolve(v?.bodyHash ? v : null);
      };
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, entry: StoredEntry): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("kc read cache write skipped:", e);
  }
}

async function idbClear(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
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

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
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

/**
 * Memory + IndexedDB composite with cross-tab BroadcastChannel invalidation.
 */
export class CompositeReadCache implements ReadCachePort {
  private memory = new MemoryReadCache();
  private accessOrder: string[] = [];
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<() => void>();
  private generation = 0;
  private suppressBroadcast = false;

  constructor() {
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.channel = new BroadcastChannel(CHANNEL);
        this.channel.onmessage = (ev: MessageEvent) => {
          const data = ev.data as { type?: string; generation?: number } | null;
          if (data?.type !== "invalidate") return;
          this.suppressBroadcast = true;
          try {
            this.memory.invalidateAll();
            this.accessOrder = [];
            this.generation = Math.max(this.generation, data.generation ?? 0);
            void idbClear();
            for (const cb of this.listeners) cb();
          } finally {
            this.suppressBroadcast = false;
          }
        };
      } catch {
        this.channel = null;
      }
    }
  }

  async get(key: string): Promise<ReadCacheEntry | null> {
    const mem = this.memory.get(key);
    if (mem) {
      this.touch(key);
      return mem;
    }
    const stored = await idbGet(key);
    if (!stored) return null;
    const entry: ReadCacheEntry = {
      value: stored.value,
      fetchedAt: stored.fetchedAt,
      bodyHash: stored.bodyHash,
    };
    this.memory.set(key, entry);
    this.touch(key);
    return entry;
  }

  async set(key: string, entry: ReadCacheEntry): Promise<void> {
    this.memory.set(key, entry);
    this.touch(key);
    await idbSet(key, { ...entry, accessedAt: Date.now() });
    await this.enforceLimit();
  }

  async invalidateAll(): Promise<void> {
    this.generation += 1;
    this.memory.invalidateAll();
    this.accessOrder = [];
    await idbClear();
    for (const cb of this.listeners) cb();
    if (!this.suppressBroadcast && this.channel) {
      try {
        this.channel.postMessage({ type: "invalidate", generation: this.generation });
      } catch {
        /* ignore */
      }
    }
  }

  subscribeInvalidate(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private touch(key: string): void {
    const i = this.accessOrder.indexOf(key);
    if (i >= 0) this.accessOrder.splice(i, 1);
    this.accessOrder.push(key);
  }

  private async enforceLimit(): Promise<void> {
    while (this.accessOrder.length > MAX_ENTRIES) {
      const oldest = this.accessOrder.shift();
      if (!oldest) break;
      this.memory.delete(oldest);
      await idbDelete(oldest);
    }
  }
}

/** Create the shared browser read cache (one per page). */
let shared: CompositeReadCache | null = null;

export function getBrowserReadCache(): CompositeReadCache {
  if (!shared) shared = new CompositeReadCache();
  return shared;
}

/** Test helper. */
export function resetBrowserReadCacheForTests(): void {
  shared = null;
}
