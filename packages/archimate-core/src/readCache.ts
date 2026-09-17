/** Cached KC read payload with SWR metadata. */
export type ReadCacheEntry = {
  value: unknown;
  fetchedAt: number;
  bodyHash: string;
};

/**
 * Persistence port for KC read responses (memory, IndexedDB, …).
 * KcClient owns in-flight dedup and SWR timing; the port only stores entries.
 */
export interface ReadCachePort {
  get(key: string): ReadCacheEntry | null | Promise<ReadCacheEntry | null>;
  set(key: string, entry: ReadCacheEntry): void | Promise<void>;
  invalidateAll(): void | Promise<void>;
  /** Cross-tab / multi-instance invalidate notifications. */
  subscribeInvalidate?(cb: () => void): () => void;
}

/** In-memory read cache (default for Node / MCP / tests). */
export class MemoryReadCache implements ReadCachePort {
  private entries = new Map<string, ReadCacheEntry>();

  get(key: string): ReadCacheEntry | null {
    return this.entries.get(key) ?? null;
  }

  set(key: string, entry: ReadCacheEntry): void {
    this.entries.set(key, entry);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  invalidateAll(): void {
    this.entries.clear();
  }

  /** Test helper. */
  size(): number {
    return this.entries.size;
  }
}

/** FNV-1a over stable JSON — fast equality fingerprint for SWR. */
export function hashJson(value: unknown): string {
  const s = JSON.stringify(value) ?? "null";
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** Canonical cache key for a KC read (method + path + optional body). */
export function canonicalReadKey(
  method: string,
  path: string,
  body?: unknown,
  scopePrefix = "",
): string {
  const normalized =
    body && typeof body === "object"
      ? canonicalizeBody(body as Record<string, unknown>)
      : body;
  const bodyPart = normalized === undefined ? "" : JSON.stringify(normalized);
  return `${scopePrefix}${method} ${path}\n${bodyPart}`;
}

function canonicalizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body).sort()) {
    const v = body[key];
    if (Array.isArray(v) && (key === "ids" || key === "include" || key === "properties")) {
      out[key] = [...v].map(String).sort();
    } else {
      out[key] = v;
    }
  }
  return out;
}

export const DEFAULT_READ_CACHE_STALE_AFTER_MS = 120_000;
export const DEFAULT_READ_CACHE_MAX_AGE_MS = 900_000;
