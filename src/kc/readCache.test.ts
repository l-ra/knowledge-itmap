import { afterEach, describe, expect, it, vi } from "vitest";
import { CompositeReadCache, resetBrowserReadCacheForTests } from "./readCache";

describe("CompositeReadCache", () => {
  afterEach(() => {
    resetBrowserReadCacheForTests();
    vi.unstubAllGlobals();
  });

  function stubNoIdb() {
    vi.stubGlobal("indexedDB", {
      open: () => {
        const req = {
          onerror: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
          onupgradeneeded: null as (() => void) | null,
          error: new Error("no idb in test"),
          result: null,
        };
        queueMicrotask(() => req.onerror?.());
        return req;
      },
    });
  }

  it("stores and returns entries via memory when IndexedDB is unavailable", async () => {
    stubNoIdb();
    const cache = new CompositeReadCache();
    await cache.set("k1", { value: { x: 1 }, fetchedAt: 100, bodyHash: "h1" });
    const hit = await cache.get("k1");
    expect(hit?.value).toEqual({ x: 1 });
    expect(hit?.bodyHash).toBe("h1");
  });

  it("invalidateAll clears memory and notifies subscribers", async () => {
    stubNoIdb();
    const cache = new CompositeReadCache();
    let notified = 0;
    cache.subscribeInvalidate(() => {
      notified += 1;
    });
    await cache.set("k1", { value: 1, fetchedAt: 1, bodyHash: "a" });
    await cache.invalidateAll();
    expect(await cache.get("k1")).toBeNull();
    expect(notified).toBe(1);
  });

  it("broadcast invalidate clears peer memory", async () => {
    stubNoIdb();
    type Handler = (ev: MessageEvent) => void;
    const peers = new Map<string, Handler[]>();

    vi.stubGlobal(
      "BroadcastChannel",
      class {
        name: string;
        private _onmessage: Handler | null = null;
        constructor(name: string) {
          this.name = name;
          if (!peers.has(name)) peers.set(name, []);
        }
        set onmessage(fn: Handler | null) {
          this._onmessage = fn;
          if (fn) peers.get(this.name)!.push(fn);
        }
        get onmessage() {
          return this._onmessage;
        }
        postMessage(data: unknown) {
          for (const h of peers.get(this.name) || []) {
            h({ data } as MessageEvent);
          }
        }
        close() {}
      },
    );

    const a = new CompositeReadCache();
    const b = new CompositeReadCache();
    await b.set("shared", { value: "keep", fetchedAt: 1, bodyHash: "x" });
    expect(await b.get("shared")).toBeTruthy();

    await a.invalidateAll();
    expect(await b.get("shared")).toBeNull();
  });
});
