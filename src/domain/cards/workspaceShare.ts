/** Serializable cards workspace snapshot for deeplinks + local bookmarks. */

/** Current on-wire / bookmark schema version. */
export const CARDS_SHARE_VERSION = 2 as const;

export type SharedCardOpenedFrom = {
  entityId: string;
  slotId?: string;
  slotLabel?: string;
  relationshipId?: string;
  relationshipType?: string;
  direction?: "outgoing" | "incoming";
};

export type SharedCardRef = {
  entityId: string;
  openedFrom?: SharedCardOpenedFrom;
};

/** Per-card panel UI (keyed by panelKey, e.g. `0:entity` or `0:entity:inplace:rel::id`). */
export type SharedCardUi = {
  /** Absolute set of hidden section keys (`desc`, `fields`, `props`, `expert`, `slot:…`). */
  hidden?: string[];
  /** Neighbor keys with inplace open. */
  inplace?: string[];
  /** Show zero-count section chips. */
  emptyChips?: boolean;
};

export type SharedTab = {
  v: typeof CARDS_SHARE_VERSION;
  kind: "tab";
  rootEntityId: string;
  title: string;
  focusId: string;
  columns: SharedCardRef[][];
  columnWidths?: Record<string, number>;
  collapsedLevels?: number[];
  /** UI state for every mounted card panel (column + nested inplace). */
  cardUi?: Record<string, SharedCardUi>;
};

export type SharedShell = {
  v: typeof CARDS_SHARE_VERSION;
  kind: "shell";
  active: "hub" | number;
  tabs: Array<Omit<SharedTab, "kind">>;
};

/** @deprecated Use SharedTab (v2). Kept for type aliases in migrations. */
export type SharedTabV1 = Omit<SharedTab, "v" | "cardUi"> & { v?: 1; cardUi?: never };
/** @deprecated Use SharedShell (v2). */
export type SharedShellV1 = Omit<SharedShell, "v"> & { v: 1 };

export type CardsBookmark = {
  id: string;
  name: string;
  createdAt: string;
  kind: "tab" | "shell";
  /** Schema version of the nested tab/shell payload (mirrors payload.v). */
  schemaVersion?: number;
  tab?: SharedTab;
  shell?: SharedShell;
};

const BOOKMARKS_KEY = "itmap.cards.bookmarks";

/** Wire prefix: gzip(JSON) → base64url. Legacy payloads omit the prefix. */
export const SHARE_PAYLOAD_GZIP_PREFIX = "gz1." as const;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzipBytes(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("CompressionStream (gzip) is not available in this environment");
  }
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream (gzip) is not available in this environment");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode snapshot for URL query (`gz1.` + base64url(gzip(json))). */
export async function encodeSharePayload(value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const gz = await gzipBytes(json);
  return `${SHARE_PAYLOAD_GZIP_PREFIX}${bytesToBase64Url(gz)}`;
}

/**
 * Decode URL payload. Accepts:
 * - `gz1.` + base64url(gzip(json)) — current
 * - raw base64url(json) — legacy v1/v2 uncompressed
 */
export async function decodeSharePayload<T = unknown>(encoded: string): Promise<T | null> {
  try {
    if (encoded.startsWith(SHARE_PAYLOAD_GZIP_PREFIX)) {
      const gz = base64UrlToBytes(encoded.slice(SHARE_PAYLOAD_GZIP_PREFIX.length));
      const json = new TextDecoder().decode(await gunzipBytes(gz));
      return JSON.parse(json) as T;
    }
    const json = new TextDecoder().decode(base64UrlToBytes(encoded));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function isCardRefShape(value: unknown): value is SharedCardRef {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as SharedCardRef).entityId === "string"
  );
}

function isCardUiShape(value: unknown): value is SharedCardUi {
  if (!value || typeof value !== "object") return false;
  const u = value as SharedCardUi;
  if (u.hidden != null && !Array.isArray(u.hidden)) return false;
  if (u.inplace != null && !Array.isArray(u.inplace)) return false;
  if (u.emptyChips != null && typeof u.emptyChips !== "boolean") return false;
  return true;
}

function normalizeCardUiMap(
  raw: unknown,
): Record<string, SharedCardUi> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, SharedCardUi> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isCardUiShape(v)) continue;
    const entry: SharedCardUi = {};
    if (Array.isArray(v.hidden) && v.hidden.length) {
      entry.hidden = v.hidden.filter((x): x is string => typeof x === "string");
    }
    if (Array.isArray(v.inplace) && v.inplace.length) {
      entry.inplace = v.inplace.filter((x): x is string => typeof x === "string");
    }
    if (v.emptyChips) entry.emptyChips = true;
    if (entry.hidden || entry.inplace || entry.emptyChips) out[k] = entry;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Normalize legacy v1 (or unversioned) tab payloads to current SharedTab. */
export function normalizeSharedTab(value: unknown): SharedTab | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const v = raw.v;
  if (v != null && v !== 1 && v !== 2) return null;
  if (raw.kind != null && raw.kind !== "tab") return null;
  if (typeof raw.rootEntityId !== "string" || typeof raw.focusId !== "string") return null;
  if (!Array.isArray(raw.columns)) return null;

  const columns: SharedCardRef[][] = raw.columns.map((col) =>
    Array.isArray(col) ? col.filter(isCardRefShape) : [],
  );

  const columnWidths =
    raw.columnWidths && typeof raw.columnWidths === "object"
      ? (raw.columnWidths as Record<string, number>)
      : undefined;
  const collapsedLevels = Array.isArray(raw.collapsedLevels)
    ? raw.collapsedLevels.filter((n): n is number => typeof n === "number")
    : undefined;

  return {
    v: CARDS_SHARE_VERSION,
    kind: "tab",
    rootEntityId: raw.rootEntityId,
    title: typeof raw.title === "string" ? raw.title : "…",
    focusId: raw.focusId,
    columns,
    columnWidths,
    collapsedLevels,
    cardUi: normalizeCardUiMap(raw.cardUi),
  };
}

export function normalizeSharedShell(value: unknown): SharedShell | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const v = raw.v;
  if (v != null && v !== 1 && v !== 2) return null;
  if (raw.kind !== "shell" || !Array.isArray(raw.tabs)) return null;

  const tabs: SharedShell["tabs"] = [];
  for (const t of raw.tabs) {
    const tab = normalizeSharedTab(
      t && typeof t === "object"
        ? { ...(t as object), kind: "tab", v: (t as { v?: number }).v ?? v ?? 1 }
        : null,
    );
    if (!tab) return null;
    const { kind: _k, ...rest } = tab;
    tabs.push(rest);
  }

  const active =
    raw.active === "hub" || typeof raw.active === "number" ? raw.active : "hub";

  return {
    v: CARDS_SHARE_VERSION,
    kind: "shell",
    active,
    tabs,
  };
}

export function isSharedTab(value: unknown): value is SharedTab {
  return normalizeSharedTab(value) != null;
}

export function isSharedShell(value: unknown): value is SharedShell {
  return normalizeSharedShell(value) != null;
}

export async function buildTabShareUrl(origin: string, tab: SharedTab): Promise<string> {
  const payload = normalizeSharedTab(tab) ?? { ...tab, v: CARDS_SHARE_VERSION, kind: "tab" as const };
  const ws = await encodeSharePayload(payload);
  const path = `/cards/${encodeURIComponent(tab.focusId)}`;
  return `${origin}${path}?ws=${ws}`;
}

export async function buildShellShareUrl(origin: string, shell: SharedShell): Promise<string> {
  const payload =
    normalizeSharedShell(shell) ?? { ...shell, v: CARDS_SHARE_VERSION, kind: "shell" as const };
  const encoded = await encodeSharePayload(payload);
  return `${origin}/cards?shell=${encoded}`;
}

export function listCardsBookmarks(): CardsBookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CardsBookmark[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((b) => b && typeof b.id === "string" && typeof b.name === "string")
      .map((b) => {
        if (b.kind === "tab" && b.tab) {
          const tab = normalizeSharedTab(b.tab);
          return tab
            ? { ...b, schemaVersion: tab.v, tab }
            : b;
        }
        if (b.kind === "shell" && b.shell) {
          const shell = normalizeSharedShell(b.shell);
          return shell
            ? { ...b, schemaVersion: shell.v, shell }
            : b;
        }
        return b;
      });
  } catch {
    return [];
  }
}

export function saveCardsBookmark(bookmark: CardsBookmark): CardsBookmark[] {
  const normalized: CardsBookmark = { ...bookmark };
  if (bookmark.kind === "tab" && bookmark.tab) {
    const tab = normalizeSharedTab(bookmark.tab);
    if (tab) {
      normalized.tab = tab;
      normalized.schemaVersion = tab.v;
    }
  } else if (bookmark.kind === "shell" && bookmark.shell) {
    const shell = normalizeSharedShell(bookmark.shell);
    if (shell) {
      normalized.shell = shell;
      normalized.schemaVersion = shell.v;
    }
  }
  const next = [normalized, ...listCardsBookmarks().filter((b) => b.id !== bookmark.id)];
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
  return next;
}

export function deleteCardsBookmark(id: string): CardsBookmark[] {
  const next = listCardsBookmarks().filter((b) => b.id !== id);
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
  return next;
}

export function newBookmarkId(): string {
  return `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function snapshotCardUi(parts: {
  hidden: Iterable<string>;
  inplaceOpen: Record<string, boolean>;
  emptyChips: boolean;
}): SharedCardUi {
  const hidden = [...parts.hidden].filter(Boolean).sort();
  const inplace = Object.keys(parts.inplaceOpen)
    .filter((k) => parts.inplaceOpen[k])
    .sort();
  const out: SharedCardUi = {};
  if (hidden.length) out.hidden = hidden;
  if (inplace.length) out.inplace = inplace;
  if (parts.emptyChips) out.emptyChips = true;
  return out;
}

/** Drop UI for a panel and all nested inplace descendants. */
export function pruneCardUiMap(
  cardUi: Record<string, SharedCardUi> | undefined,
  panelKey: string,
): Record<string, SharedCardUi> | undefined {
  if (!cardUi) return undefined;
  const next = { ...cardUi };
  delete next[panelKey];
  const prefix = `${panelKey}:`;
  for (const k of Object.keys(next)) {
    if (k.startsWith(prefix)) delete next[k];
  }
  return Object.keys(next).length ? next : undefined;
}
