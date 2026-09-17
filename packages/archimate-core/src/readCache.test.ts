import { afterEach, describe, expect, it, vi } from "vitest";
import { KcClient } from "./kcClient";
import { MemoryReadCache, canonicalReadKey, hashJson } from "./readCache";

describe("canonicalReadKey / hashJson", () => {
  it("normalizes batch-read id order", () => {
    const a = canonicalReadKey("POST", "/v1/entities/batch-read", {
      ids: ["b", "a"],
      include: ["statements", "effectiveClasses"],
    });
    const b = canonicalReadKey("POST", "/v1/entities/batch-read", {
      ids: ["a", "b"],
      include: ["effectiveClasses", "statements"],
    });
    expect(a).toBe(b);
  });

  it("hashes stable JSON", () => {
    expect(hashJson({ a: 1, b: 2 })).toBe(hashJson({ a: 1, b: 2 }));
  });
});

describe("KcClient read cache SWR", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
    let calls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const url = String(input);
      const body = handler(url, init);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      } as Response;
    }) as typeof fetch;
    return {
      get calls() {
        return calls;
      },
    };
  }

  it("dedupes parallel identical getEntity", async () => {
    const cache = new MemoryReadCache();
    const api = mockFetch(() => ({ id: "Q1", status: "active", kind: "entity", revisionNo: 1 }));
    const kc = new KcClient({ readCache: cache, baseUrl: "http://kc" });
    const [a, b] = await Promise.all([kc.getEntity("Q1"), kc.getEntity("Q1")]);
    expect(a.id).toBe("Q1");
    expect(b.id).toBe("Q1");
    expect(api.calls).toBe(1);
    expect(cache.size()).toBe(1);
  });

  it("serves fresh cache without network", async () => {
    const cache = new MemoryReadCache();
    const api = mockFetch(() => ({ id: "Q1", status: "active", kind: "entity", revisionNo: 1 }));
    const kc = new KcClient({
      readCache: cache,
      baseUrl: "http://kc",
      readCacheStaleAfterMs: 60_000,
      readCacheMaxAgeMs: 900_000,
    });
    await kc.getEntity("Q1");
    await kc.getEntity("Q1");
    expect(api.calls).toBe(1);
  });

  it("soft-stale returns cache and revalidates once in background", async () => {
    vi.useFakeTimers();
    const cache = new MemoryReadCache();
    let revision = 1;
    const api = mockFetch(() => ({
      id: "Q1",
      status: "active",
      kind: "entity",
      revisionNo: revision,
    }));
    const kc = new KcClient({
      readCache: cache,
      baseUrl: "http://kc",
      readCacheStaleAfterMs: 1_000,
      readCacheMaxAgeMs: 60_000,
    });
    await kc.getEntity("Q1");
    expect(api.calls).toBe(1);

    await vi.advanceTimersByTimeAsync(1_500);
    revision = 2;
    const second = await kc.getEntity("Q1");
    // Soft-stale: still returns cached revision 1 immediately.
    expect(second.revisionNo).toBe(1);

    // Background revalidate (may already have completed via microtasks).
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(api.calls).toBe(2);
    const third = await kc.getEntity("Q1");
    expect(third.revisionNo).toBe(2);
  });

  it("maxAge forces sync refetch", async () => {
    vi.useFakeTimers();
    const cache = new MemoryReadCache();
    let revision = 1;
    const api = mockFetch(() => ({
      id: "Q1",
      status: "active",
      kind: "entity",
      revisionNo: revision,
    }));
    const kc = new KcClient({
      readCache: cache,
      baseUrl: "http://kc",
      readCacheStaleAfterMs: 100,
      readCacheMaxAgeMs: 1_000,
    });
    await kc.getEntity("Q1");
    revision = 9;
    await vi.advanceTimersByTimeAsync(1_500);
    const next = await kc.getEntity("Q1");
    expect(next.revisionNo).toBe(9);
    expect(api.calls).toBe(2);
  });

  it("write invalidates cache", async () => {
    const cache = new MemoryReadCache();
    const api = mockFetch((url, init) => {
      if (init?.method === "POST" && url.includes("/statements")) {
        return { data: { id: "S1" }, changeSet: { id: "cs1", status: "open" } };
      }
      return { id: "Q1", status: "active", kind: "entity", revisionNo: 1 };
    });
    const kc = new KcClient({ readCache: cache, baseUrl: "http://kc" });
    kc.setManualChangeSet("cs1");
    await kc.getEntity("Q1");
    expect(cache.size()).toBe(1);
    await kc.createStatement({
      packageCode: "org",
      subject: "Q1",
      property: "P1",
      value: { type: "String", string: "x" },
    });
    expect(cache.size()).toBe(0);
    await kc.getEntity("Q1");
    expect(api.calls).toBe(3); // get, write, get
  });
});
