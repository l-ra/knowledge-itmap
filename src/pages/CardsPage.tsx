import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { PropertyStatementEditor, PropertyValueInput } from "@/components/PropertyStatementEditor";
import {
  DescriptionEditor,
  descriptionsDraftFrom,
  langMapsEqual,
  normalizeLangMap,
  preferredDescription,
} from "@/components/DescriptionEditor";
import { SlotAddDialog, type SlotAddSubmit } from "@/components/SlotAddDialog";
import {
  CardsService,
  addExpertNeighborCreate,
  addExpertNeighborLink,
  addSlotNeighborCreate,
  addSlotNeighborLink,
  getCardsProfileLoader,
  listAllowedForSubject,
} from "@/domain/cards";
import type { CardSystemInfo, CardViewModel, CardsHubRow, RelationSlotDef } from "@/domain/cards";
import {
  buildShellShareUrl,
  buildTabShareUrl,
  decodeSharePayload,
  deleteCardsBookmark,
  listCardsBookmarks,
  newBookmarkId,
  normalizeSharedShell,
  normalizeSharedTab,
  pruneCardUiMap,
  saveCardsBookmark,
  snapshotCardUi,
  type CardsBookmark,
  type SharedCardUi,
  type SharedShell,
  type SharedTab,
} from "@/domain/cards/workspaceShare";
import { ModelService } from "@/domain/modelService";
import {
  groupStatementsByProperty,
  propertyEditRules,
  searchSchemaProperties,
  statementValueFromInput,
  type PropertySearchHit,
  type PropertyValueGroup,
} from "@/domain/propertyEdit";
import { getKc } from "@/kc/client";
import { entityLabel, getSchema } from "@/kc/schema";
import type { Statement } from "@/kc/types";
import { useApp } from "@/state/AppContext";

const PAGE_SIZE = 50;

type CardOpenedFrom = {
  entityId: string;
  slotId?: string;
  slotLabel?: string;
  relationshipId?: string;
  relationshipType?: string;
  /** outgoing = forward, incoming = inverse (expert / directed edges). */
  direction?: "outgoing" | "incoming";
};

type CardRef = {
  entityId: string;
  openedFrom?: CardOpenedFrom;
};

type CardsWorkspaceNavState = {
  columns?: CardRef[][];
};

type SectionKey = "desc" | "fields" | "props" | "expert" | `slot:${string}`;

function defaultHiddenSections(
  card: CardViewModel,
  variant: "column" | "inplace" = "column",
): Set<SectionKey> {
  if (variant === "inplace") {
    return new Set(allHideableSections(card));
  }
  const hidden = new Set<SectionKey>(["props"]);
  const descEntries = Object.values(card.descriptions || {}).filter((t) => t.trim());
  const hasDesc = descEntries.length > 0 || Boolean(card.description?.trim());
  if (!hasDesc) hidden.add("desc");
  for (const sv of card.slots) {
    if (sv.empty || sv.neighbors.length === 0) {
      hidden.add(`slot:${sv.slot.id}`);
    }
  }
  hidden.add("expert");
  return hidden;
}

function allHideableSections(card: CardViewModel): SectionKey[] {
  const keys: SectionKey[] = ["desc"];
  if (card.fields.length > 0) keys.push("fields");
  keys.push("props");
  for (const sv of card.slots) keys.push(`slot:${sv.slot.id}`);
  keys.push("expert");
  return keys;
}

function sectionLabel(key: SectionKey, card: CardViewModel): string {
  if (key === "desc") return "Popis";
  if (key === "fields") return "Základní informace";
  if (key === "props") return "Properties";
  if (key === "expert") return "Další vazby";
  const slotId = key.slice("slot:".length);
  return card.slots.find((s) => s.slot.id === slotId)?.slot.labelCs || "Slot";
}

function sectionItemCount(
  key: SectionKey,
  card: CardViewModel,
  propertyCount: number,
): number {
  if (key === "desc") {
    const entries = Object.values(card.descriptions || {}).filter((t) => t.trim());
    if (entries.length > 0) return entries.length;
    return card.description?.trim() ? 1 : 0;
  }
  if (key === "fields") return card.fields.length;
  if (key === "props") return propertyCount;
  if (key === "expert") return card.expertNeighbors.length;
  const slotId = key.slice("slot:".length);
  return card.slots.find((s) => s.slot.id === slotId)?.neighbors.length ?? 0;
}

function EyeIcon({ crossed = false }: { crossed?: boolean }) {
  return (
    <svg
      className="element-card-eye-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}

function SectionHideButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="element-card-section-hide"
      data-tooltip={label}
      aria-label={label}
      onClick={onClick}
    >
      <EyeIcon crossed />
    </button>
  );
}

function isCardRef(value: unknown): value is CardRef {
  if (!value || typeof value !== "object") return false;
  const entityId = (value as CardRef).entityId;
  return typeof entityId === "string" && entityId.length > 0;
}

function findCardLocation(
  columns: CardRef[][],
  entityId: string,
): { depth: number; index: number } | null {
  for (let depth = 0; depth < columns.length; depth++) {
    const index = columns[depth].findIndex((c) => c.entityId === entityId);
    if (index >= 0) return { depth, index };
  }
  return null;
}

function pruneEmptyColumns(columns: CardRef[][]): CardRef[][] {
  const next = columns.map((col) => [...col]);
  while (next.length > 1 && next[next.length - 1].length === 0) next.pop();
  return next.length > 0 ? next : [[]];
}

function resolveWorkspace(
  entityId: string,
  state: unknown,
): { columns: CardRef[][]; focusId: string } {
  const raw = (state as CardsWorkspaceNavState | null)?.columns;
  if (Array.isArray(raw) && raw.length > 0) {
    const columns = pruneEmptyColumns(
      raw.map((col) => (Array.isArray(col) ? col.filter(isCardRef) : [])),
    );
    if (columns.some((col) => col.length > 0) && findCardLocation(columns, entityId)) {
      return { columns, focusId: entityId };
    }
  }
  return { columns: [[{ entityId }]], focusId: entityId };
}

function openToNextLevel(
  columns: CardRef[][],
  fromDepth: number,
  neighborId: string,
  openedFrom: CardOpenedFrom,
): CardRef[][] {
  if (findCardLocation(columns, neighborId)) return columns;
  const next = columns.map((col) => [...col]);
  while (next.length <= fromDepth + 1) next.push([]);
  next[fromDepth + 1] = [...next[fromDepth + 1], { entityId: neighborId, openedFrom }];
  return next;
}

/** Cards opened (transitively) from rootId via openedFrom links. */
function collectDescendantIds(columns: CardRef[][], rootId: string): string[] {
  const byParent = new Map<string, string[]>();
  for (const col of columns) {
    for (const ref of col) {
      const parentId = ref.openedFrom?.entityId;
      if (!parentId) continue;
      const list = byParent.get(parentId);
      if (list) list.push(ref.entityId);
      else byParent.set(parentId, [ref.entityId]);
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [...(byParent.get(rootId) || [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    const children = byParent.get(id);
    if (children) stack.push(...children);
  }
  return out;
}

function closeCardInWorkspace(
  columns: CardRef[][],
  entityId: string,
  focusId: string,
  opts?: { cascade?: boolean },
): { columns: CardRef[][]; focusId: string } | null {
  const loc = findCardLocation(columns, entityId);
  if (!loc) return null;
  const toRemove = new Set<string>([entityId]);
  if (opts?.cascade) {
    for (const id of collectDescendantIds(columns, entityId)) toRemove.add(id);
  }
  const next = columns.map((col) => col.filter((c) => !toRemove.has(c.entityId)));
  const pruned = pruneEmptyColumns(next);
  const remaining = pruned.flat();
  if (remaining.length === 0) {
    return { columns: [[]], focusId: "" };
  }
  let nextFocus = focusId;
  if (toRemove.has(focusId) || !findCardLocation(pruned, focusId)) {
    const sameCol = pruned[Math.min(loc.depth, pruned.length - 1)];
    if (sameCol && sameCol.length > 0) {
      nextFocus = sameCol[Math.min(loc.index, sameCol.length - 1)].entityId;
    } else {
      for (let d = Math.min(loc.depth, pruned.length - 1); d >= 0; d--) {
        if (pruned[d].length > 0) {
          nextFocus = pruned[d][pruned[d].length - 1].entityId;
          break;
        }
      }
      if (!findCardLocation(pruned, nextFocus)) {
        nextFocus = remaining[remaining.length - 1].entityId;
      }
    }
  }
  return { columns: pruned, focusId: nextFocus };
}

function neighborKey(relationshipId: string, entityId: string): string {
  return `${relationshipId}::${entityId}`;
}

const HUB_TAB_ID = "hub";

type WorkspaceTabState = {
  id: string;
  rootEntityId: string;
  title: string;
  columns: CardRef[][];
  focusId: string;
  columnWidths?: Record<number, number>;
  collapsedLevels?: number[];
  /** panelKey → UI snapshot (column + nested inplace). */
  cardUi?: Record<string, SharedCardUi>;
};

function newWorkspaceTabId(): string {
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function tabToShared(tab: WorkspaceTabState): SharedTab {
  return {
    v: 2,
    kind: "tab",
    rootEntityId: tab.rootEntityId,
    title: tab.title,
    focusId: tab.focusId,
    columns: tab.columns,
    columnWidths: tab.columnWidths
      ? Object.fromEntries(
          Object.entries(tab.columnWidths).map(([k, v]) => [String(k), v]),
        )
      : undefined,
    collapsedLevels: tab.collapsedLevels,
    cardUi: tab.cardUi,
  };
}

function sharedToTab(shared: SharedTab, id = newWorkspaceTabId()): WorkspaceTabState {
  const normalized = normalizeSharedTab(shared) ?? shared;
  const columnWidths = normalized.columnWidths
    ? Object.fromEntries(
        Object.entries(normalized.columnWidths).map(([k, v]) => [Number(k), v]),
      )
    : undefined;
  return {
    id,
    rootEntityId: normalized.rootEntityId,
    title: normalized.title || "…",
    focusId: normalized.focusId || normalized.rootEntityId,
    columns:
      Array.isArray(normalized.columns) && normalized.columns.length > 0
        ? pruneEmptyColumns(
            normalized.columns.map((col) =>
              Array.isArray(col) ? col.filter(isCardRef) : [],
            ),
          )
        : [[{ entityId: normalized.rootEntityId }]],
    columnWidths,
    collapsedLevels: normalized.collapsedLevels,
    cardUi: normalized.cardUi,
  };
}

function shellFromTabs(
  tabs: WorkspaceTabState[],
  activeTabId: string,
): SharedShell {
  const activeIndex = tabs.findIndex((t) => t.id === activeTabId);
  return {
    v: 2,
    kind: "shell",
    active: activeTabId === HUB_TAB_ID || activeIndex < 0 ? "hub" : activeIndex,
    tabs: tabs.map((t) => {
      const s = tabToShared(t);
      const { kind: _k, ...rest } = s;
      return rest;
    }),
  };
}

/** Base path for cards routes (handles Vite base). */
function cardsBaseUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;
}

export function CardsPage() {
  const { entityId: entityIdParam } = useParams<{ entityId?: string }>();
  const entityId = entityIdParam ? decodeURIComponent(entityIdParam) : undefined;
  const navigate = useNavigate();
  const location = useLocation();

  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>(HUB_TAB_ID);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareFlash, setShareFlash] = useState<string | null>(null);
  const [bookmarksVersion, setBookmarksVersion] = useState(0);
  const shareBootstrapped = useRef(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const [shareMenuPos, setShareMenuPos] = useState<{ top: number; right: number } | null>(
    null,
  );

  const activeTab = workspaceTabs.find((t) => t.id === activeTabId) || null;

  function flash(msg: string) {
    setShareFlash(msg);
    window.setTimeout(() => setShareFlash(null), 1600);
  }

  async function copyText(text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(okMsg);
    } catch {
      flash("Kopírování selhalo");
    }
  }

  function applySharedTab(shared: SharedTab, replaceTabs = false) {
    const tab = sharedToTab(shared);
    setWorkspaceTabs((prev) => (replaceTabs ? [tab] : [...prev, tab]));
    setActiveTabId(tab.id);
    navigate(`/cards/${encodeURIComponent(tab.focusId)}`, { replace: true });
  }

  function applySharedShell(shell: SharedShell) {
    const normalized = normalizeSharedShell(shell) ?? shell;
    const tabs = normalized.tabs.map((t) =>
      sharedToTab({ ...t, kind: "tab" }),
    );
    setWorkspaceTabs(tabs);
    if (normalized.active === "hub" || tabs.length === 0) {
      setActiveTabId(HUB_TAB_ID);
      navigate("/cards", { replace: true });
      return;
    }
    const idx = typeof normalized.active === "number" ? normalized.active : 0;
    const tab = tabs[Math.min(Math.max(idx, 0), tabs.length - 1)]!;
    setActiveTabId(tab.id);
    navigate(`/cards/${encodeURIComponent(tab.focusId)}`, { replace: true });
  }

  // Deeplink bootstrap: ?shell= / ?ws=
  useEffect(() => {
    if (shareBootstrapped.current) return;
    const params = new URLSearchParams(location.search);
    const shellEnc = params.get("shell");
    const wsEnc = params.get("ws");
    if (!shellEnc && !wsEnc) return;

    let cancelled = false;
    shareBootstrapped.current = true;

    void (async () => {
      if (shellEnc) {
        const decoded = await decodeSharePayload(shellEnc);
        if (cancelled) return;
        const shell = normalizeSharedShell(decoded);
        if (shell) {
          applySharedShell(shell);
          return;
        }
        flash("Neplatný odkaz sestavy");
        return;
      }
      if (wsEnc) {
        const decoded = await decodeSharePayload(wsEnc);
        if (cancelled) return;
        const tab =
          normalizeSharedTab(decoded) ||
          (decoded && typeof decoded === "object"
            ? normalizeSharedTab({ ...(decoded as object), kind: "tab" })
            : null);
        if (tab) {
          applySharedTab(tab, true);
          return;
        }
        flash("Neplatný odkaz záložky");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    if (shareBootstrapped.current && (location.search.includes("ws=") || location.search.includes("shell="))) {
      return;
    }
    if (!entityId) {
      if (!shareBootstrapped.current) setActiveTabId(HUB_TAB_ID);
      return;
    }
    setWorkspaceTabs((prev) => {
      const hit = prev.find((t) => findCardLocation(t.columns, entityId));
      if (hit) {
        setActiveTabId(hit.id);
        if (hit.focusId === entityId) return prev;
        return prev.map((t) => (t.id === hit.id ? { ...t, focusId: entityId } : t));
      }
      if (shareBootstrapped.current) return prev;
      const ws = resolveWorkspace(entityId, location.state);
      const rootEntityId = ws.columns[0]?.[0]?.entityId || entityId;
      const id = newWorkspaceTabId();
      setActiveTabId(id);
      return [
        ...prev,
        {
          id,
          rootEntityId,
          title: "…",
          columns: ws.columns,
          focusId: entityId,
        },
      ];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  function placeShareMenu() {
    const btn = shareBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const estimatedH = 168;
    let top = r.bottom + 4;
    if (top + estimatedH > window.innerHeight - 8) {
      top = Math.max(8, r.top - estimatedH - 4);
    }
    setShareMenuPos({
      top,
      right: Math.max(8, window.innerWidth - r.right),
    });
  }

  function closeShareMenu() {
    setShareMenuOpen(false);
    setShareMenuPos(null);
  }

  function toggleShareMenu() {
    setShareMenuOpen((open) => {
      if (open) {
        setShareMenuPos(null);
        return false;
      }
      placeShareMenu();
      return true;
    });
  }

  useEffect(() => {
    if (!shareMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!shareMenuRef.current?.contains(e.target as Node)) closeShareMenu();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeShareMenu();
    }
    function onReposition() {
      placeShareMenu();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/close only
  }, [shareMenuOpen]);

  function activateHub() {
    setActiveTabId(HUB_TAB_ID);
    navigate("/cards");
  }

  function openWorkspaceTab(rootEntityId: string, title?: string) {
    const id = newWorkspaceTabId();
    setWorkspaceTabs((prev) => [
      ...prev,
      {
        id,
        rootEntityId,
        title: title || "…",
        columns: [[{ entityId: rootEntityId }]],
        focusId: rootEntityId,
      },
    ]);
    setActiveTabId(id);
    navigate(`/cards/${encodeURIComponent(rootEntityId)}`);
  }

  function closeWorkspaceTab(tabId: string) {
    setWorkspaceTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        const neighbor = next[idx] || next[idx - 1];
        if (neighbor) {
          setActiveTabId(neighbor.id);
          navigate(`/cards/${encodeURIComponent(neighbor.focusId)}`);
        } else {
          setActiveTabId(HUB_TAB_ID);
          navigate("/cards");
        }
      }
      return next;
    });
  }

  function patchWorkspaceTab(
    tabId: string,
    patch: Partial<
      Pick<
        WorkspaceTabState,
        "columns" | "focusId" | "title" | "columnWidths" | "collapsedLevels" | "cardUi"
      >
    >,
  ) {
    setWorkspaceTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
    );
    if (patch.focusId) {
      navigate(`/cards/${encodeURIComponent(patch.focusId)}`);
    }
  }

  async function copyActiveTabLink() {
    if (!activeTab) {
      flash("Nejdřív otevřete záložku");
      return;
    }
    try {
      const url = await buildTabShareUrl(cardsBaseUrl(), tabToShared(activeTab));
      await copyText(url, "Odkaz záložky zkopírován");
    } catch {
      flash("Komprese odkazu selhala");
    }
    closeShareMenu();
  }

  async function copyShellLink() {
    try {
      const url = await buildShellShareUrl(
        cardsBaseUrl(),
        shellFromTabs(workspaceTabs, activeTabId),
      );
      await copyText(url, "Odkaz sestavy zkopírován");
    } catch {
      flash("Komprese odkazu selhala");
    }
    closeShareMenu();
  }

  function bookmarkActiveTab() {
    if (!activeTab) {
      flash("Nejdřív otevřete záložku");
      return;
    }
    const name = window.prompt("Název záložky", activeTab.title || "Záložka");
    if (!name?.trim()) return;
    saveCardsBookmark({
      id: newBookmarkId(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      kind: "tab",
      tab: tabToShared(activeTab),
    });
    setBookmarksVersion((v) => v + 1);
    flash("Záložka uložena");
    closeShareMenu();
  }

  function bookmarkShell() {
    const name = window.prompt(
      "Název sestavy",
      workspaceTabs.length ? `Sestava (${workspaceTabs.length})` : "Sestava",
    );
    if (!name?.trim()) return;
    saveCardsBookmark({
      id: newBookmarkId(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      kind: "shell",
      shell: shellFromTabs(workspaceTabs, activeTabId),
    });
    setBookmarksVersion((v) => v + 1);
    flash("Sestava uložena");
    closeShareMenu();
  }

  function restoreBookmark(bm: CardsBookmark) {
    if (bm.kind === "tab" && bm.tab) {
      applySharedTab(bm.tab, false);
      flash("Záložka obnovena");
      return;
    }
    if (bm.kind === "shell" && bm.shell) {
      applySharedShell(bm.shell);
      flash("Sestava obnovena");
    }
  }

  return (
    <div className="page cards-page">
      <div className="cards-tabbar" aria-label="Karty workspace">
        <div className="cards-tabbar-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`cards-tab${activeTabId === HUB_TAB_ID ? " active" : ""}`}
            aria-selected={activeTabId === HUB_TAB_ID}
            onClick={activateHub}
          >
            Karty
          </button>
          {workspaceTabs.map((tab) => (
            <div
              key={tab.id}
              className={`cards-tab-wrap${activeTabId === tab.id ? " active" : ""}`}
            >
              <button
                type="button"
                role="tab"
                className={`cards-tab${activeTabId === tab.id ? " active" : ""}`}
                aria-selected={activeTabId === tab.id}
                title={tab.title}
                onClick={() => {
                  setActiveTabId(tab.id);
                  navigate(`/cards/${encodeURIComponent(tab.focusId)}`);
                }}
              >
                <span className="cards-tab-title">{tab.title}</span>
              </button>
              <button
                type="button"
                className="cards-tab-close"
                aria-label={`Zavřít ${tab.title}`}
                title="Zavřít záložku"
                onClick={(e) => {
                  e.stopPropagation();
                  closeWorkspaceTab(tab.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="cards-tab-add"
            aria-label="Nová záložka — výběr z hubu"
            title="Nová záložka"
            onClick={activateHub}
          >
            +
          </button>
        </div>

        <div className="cards-share" ref={shareMenuRef}>
          <button
            ref={shareBtnRef}
            type="button"
            className="cards-share-btn"
            aria-expanded={shareMenuOpen}
            aria-haspopup="menu"
            title="Sdílet / záložky"
            onClick={toggleShareMenu}
          >
            ↗
          </button>
          {shareMenuOpen && shareMenuPos && (
            <div
              className="cards-share-menu"
              role="menu"
              style={{ top: shareMenuPos.top, right: shareMenuPos.right }}
            >
              <button type="button" role="menuitem" onClick={copyActiveTabLink}>
                Kopírovat odkaz záložky
              </button>
              <button type="button" role="menuitem" onClick={copyShellLink}>
                Kopírovat odkaz sestavy
              </button>
              <button type="button" role="menuitem" onClick={bookmarkActiveTab}>
                Uložit záložku…
              </button>
              <button type="button" role="menuitem" onClick={bookmarkShell}>
                Uložit sestavu…
              </button>
            </div>
          )}
          {shareFlash && <span className="cards-share-flash">{shareFlash}</span>}
        </div>
      </div>

      <div
        className="cards-tab-panel"
        role="tabpanel"
        hidden={activeTabId !== HUB_TAB_ID}
      >
        <CardsHub
          onOpenCard={openWorkspaceTab}
          bookmarksVersion={bookmarksVersion}
          onRestoreBookmark={restoreBookmark}
          onBookmarksChanged={() => setBookmarksVersion((v) => v + 1)}
        />
      </div>

      {workspaceTabs.map((tab) => (
        <div
          key={tab.id}
          className="cards-tab-panel"
          role="tabpanel"
          hidden={activeTabId !== tab.id}
        >
          <CardWorkspace
            columns={tab.columns}
            focusId={tab.focusId}
            rootEntityId={tab.rootEntityId}
            columnWidths={tab.columnWidths || {}}
            collapsedLevels={new Set(tab.collapsedLevels || [])}
            cardUi={tab.cardUi || {}}
            onRootLabel={(label) => {
              if (tab.title !== label) patchWorkspaceTab(tab.id, { title: label });
            }}
            onChange={(columns, focusId, cardUi) => {
              if (!focusId || columns.flat().length === 0) {
                closeWorkspaceTab(tab.id);
                return;
              }
              patchWorkspaceTab(tab.id, {
                columns,
                focusId,
                ...(cardUi !== undefined ? { cardUi } : {}),
              });
            }}
            onLayoutChange={(layout) => {
              patchWorkspaceTab(tab.id, {
                columnWidths: layout.columnWidths,
                collapsedLevels: [...layout.collapsedLevels],
              });
            }}
            onCardUiChange={(cardUi) => {
              patchWorkspaceTab(tab.id, { cardUi });
            }}
            onOpenAsNewTab={openWorkspaceTab}
          />
        </div>
      ))}
    </div>
  );
}

function CardsHub({
  onOpenCard,
  bookmarksVersion,
  onRestoreBookmark,
  onBookmarksChanged,
}: {
  onOpenCard: (entityId: string, label: string) => void;
  bookmarksVersion: number;
  onRestoreBookmark: (bm: CardsBookmark) => void;
  onBookmarksChanged: () => void;
}) {
  const { orgPackage, ready, graphEpoch } = useApp();
  const service = useMemo(() => new CardsService(), []);
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [quickTypes, setQuickTypes] = useState<string[]>([]);
  const [typeFacets, setTypeFacets] = useState<Array<{ classLocal: string; count: number }>>([]);
  const [rows, setRows] = useState<CardsHubRow[]>([]);
  const [pageIndex, setPageIndex] = useState(1);
  /** Cursors that open each page: stack[0] = undefined (first page). */
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const bookmarks = useMemo(() => listCardsBookmarks(), [bookmarksVersion]);

  const facetCount = useMemo(() => {
    const map = new Map(typeFacets.map((f) => [f.classLocal, f.count]));
    return (t: string) => map.get(t);
  }, [typeFacets]);

  async function loadPage(opts: {
    query?: string;
    classLocal?: string | null;
    cursor?: string;
    stack?: Array<string | undefined>;
    pageIndex?: number;
  }) {
    if (!ready) return;
    const nextQ = opts.query !== undefined ? opts.query : appliedQ;
    const nextType = opts.classLocal !== undefined ? opts.classLocal : typeFilter;
    setBusy(true);
    setError(null);
    try {
      if (import.meta.env.DEV) getKc().beginReadCount();
      const [result, types] = await Promise.all([
        service.listBrowsableEntities(orgPackage, {
          query: nextQ,
          classLocal: nextType || undefined,
          pageSize: PAGE_SIZE,
          cursor: opts.cursor,
        }),
        service.listQuickFilterTypes(orgPackage),
      ]);
      if (import.meta.env.DEV) {
        const n = getKc().endReadCount();
        console.info(`[CardsHub] KC GET during load: ${n}`);
      }
      setRows(result.items);
      setQuickTypes(types);
      setTypeFacets(result.typeFacets);
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
      setTotal(result.total);
      if (opts.stack) setCursorStack(opts.stack);
      if (opts.pageIndex !== undefined) setPageIndex(opts.pageIndex);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function resetAndLoad(opts?: { query?: string; classLocal?: string | null }) {
    void loadPage({
      query: opts?.query,
      classLocal: opts?.classLocal,
      cursor: undefined,
      stack: [undefined],
      pageIndex: 1,
    });
  }

  useEffect(() => {
    resetAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- package / ChangeSet overlay
  }, [orgPackage, ready, graphEpoch]);

  useEffect(() => {
    if (!bookmarksOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setBookmarksOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bookmarksOpen]);

  return (
    <div className="cards-hub">
      <div className="cards-toolbar">
        <form
          className="cards-search"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedQ(q);
            resetAndLoad({ query: q });
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrovat podle názvu…"
          />
          <button type="submit" className="toolbar-btn primary" disabled={busy}>
            Hledat
          </button>
        </form>
        <button
          type="button"
          className={`toolbar-btn cards-bookmarks-toggle${bookmarksOpen ? " active" : ""}`}
          aria-expanded={bookmarksOpen}
          aria-haspopup="dialog"
          title="Uložené záložky a sestavy"
          onClick={() => setBookmarksOpen(true)}
        >
          Uložené
          {bookmarks.length > 0 ? ` (${bookmarks.length})` : ""}
        </button>
      </div>

      {bookmarksOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setBookmarksOpen(false)}
          role="presentation"
        >
          <div
            className="modal cards-bookmarks-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cards-bookmarks-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="cards-bookmarks-title">Uložené záložky a sestavy</h3>
            {bookmarks.length === 0 ? (
              <p className="empty" style={{ textAlign: "left", margin: 0 }}>
                Zatím nic uloženého. Použijte ↗ v tabbaru → Uložit záložku / sestavu.
              </p>
            ) : (
              <ul className="cards-bookmarks-list">
                {bookmarks.map((bm) => (
                  <li key={bm.id}>
                    <button
                      type="button"
                      className="cards-bookmark-open"
                      onClick={() => {
                        setBookmarksOpen(false);
                        onRestoreBookmark(bm);
                      }}
                    >
                      <span>{bm.name}</span>
                      <span className="empty">
                        {bm.kind === "shell" ? "sestava" : "záložka"}
                        {" · "}
                        {new Date(bm.createdAt).toLocaleString("cs")}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="cards-bookmark-delete"
                      title="Smazat"
                      aria-label={`Smazat ${bm.name}`}
                      onClick={() => {
                        deleteCardsBookmark(bm.id);
                        onBookmarksChanged();
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="toolbar-btn"
                onClick={() => setBookmarksOpen(false)}
              >
                Zavřít
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="cards-type-filters" role="group" aria-label="Typ entity">
        <button
          type="button"
          className={`cards-type-chip${!typeFilter ? " active" : ""}`}
          disabled={busy}
          onClick={() => {
            setTypeFilter(null);
            resetAndLoad({ classLocal: null });
          }}
        >
          Vše
          {total != null && !typeFilter ? ` (${total})` : ""}
        </button>
        {quickTypes.map((t) => {
          const count = facetCount(t);
          return (
            <button
              key={t}
              type="button"
              className={`cards-type-chip${typeFilter === t ? " active" : ""}`}
              disabled={busy}
              onClick={() => {
                setTypeFilter(t);
                resetAndLoad({ classLocal: t });
              }}
            >
              {t}
              {count != null ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      <p className="empty" style={{ textAlign: "left", marginTop: 0 }}>
        Vyberte kartu — otevře se v nové záložce. Package: <code>{orgPackage}</code>
        {typeFilter ? (
          <>
            {" "}
            · filtr: <code>{typeFilter}</code>
          </>
        ) : null}
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {busy && <p className="empty">Načítám…</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Název</th>
            <th>Profil</th>
            <th>Typ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.entity.id}
              className="cards-hub-row"
              onClick={() => onOpenCard(row.entity.id, entityLabel(row.entity))}
            >
              <td>{entityLabel(row.entity)}</td>
              <td>{row.profile?.labelCs || "— raw —"}</td>
              <td className="mono">{row.classLocal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!busy && rows.length === 0 && (
        <p className="empty">Žádné entity — zkontrolujte org package a import archimate-ui-cards.</p>
      )}

      {(rows.length > 0 || pageIndex > 1) && (
        <div className="cards-pagination">
          <span className="empty">
            {total != null && rows.length > 0
              ? `${(pageIndex - 1) * PAGE_SIZE + 1}–${(pageIndex - 1) * PAGE_SIZE + rows.length} z ${total}`
              : `Stránka ${pageIndex}${rows.length > 0 ? ` · ${rows.length} položek` : ""}`}
            {hasMore && total == null ? " · další stránky dostupné" : ""}
          </span>
          <div className="cards-pagination-actions">
            <button
              type="button"
              className="toolbar-btn"
              disabled={busy || pageIndex <= 1}
              onClick={() => {
                const prevIndex = pageIndex - 1;
                const prevCursor = cursorStack[prevIndex - 1];
                void loadPage({
                  cursor: prevCursor,
                  stack: cursorStack.slice(0, prevIndex),
                  pageIndex: prevIndex,
                });
              }}
            >
              ← Předchozí
            </button>
            <span className="mono">
              {total != null
                ? `${pageIndex} / ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`
                : pageIndex}
            </span>
            <button
              type="button"
              className="toolbar-btn"
              disabled={busy || !hasMore || !nextCursor}
              onClick={() => {
                if (!nextCursor) return;
                void loadPage({
                  cursor: nextCursor,
                  stack: [...cursorStack.slice(0, pageIndex), nextCursor],
                  pageIndex: pageIndex + 1,
                });
              }}
            >
              Další →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CardWorkspace({
  columns,
  focusId,
  rootEntityId,
  columnWidths,
  collapsedLevels,
  cardUi,
  onRootLabel,
  onChange,
  onLayoutChange,
  onCardUiChange,
  onOpenAsNewTab,
}: {
  columns: CardRef[][];
  focusId: string;
  rootEntityId: string;
  columnWidths: Record<number, number>;
  collapsedLevels: Set<number>;
  cardUi: Record<string, SharedCardUi>;
  onRootLabel: (label: string) => void;
  onChange: (
    columns: CardRef[][],
    focusId: string,
    cardUi?: Record<string, SharedCardUi>,
  ) => void;
  onLayoutChange: (layout: {
    columnWidths: Record<number, number>;
    collapsedLevels: Set<number>;
  }) => void;
  onCardUiChange: (cardUi: Record<string, SharedCardUi> | undefined) => void;
  onOpenAsNewTab: (entityId: string, label?: string) => void;
}) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [hideAllTokens, setHideAllTokens] = useState<Record<number, number>>({});
  const workspaceRef = useRef<HTMLDivElement>(null);
  const DEFAULT_COLUMN_WIDTH = 384;
  const MIN_COLUMN_WIDTH = 224;
  const MAX_COLUMN_WIDTH = 1024;

  function startColumnResize(depth: number, startX: number) {
    const startWidth = columnWidths[depth] ?? DEFAULT_COLUMN_WIDTH;
    function onMove(e: MouseEvent) {
      const next = Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, startWidth + (e.clientX - startX)),
      );
      if (columnWidths[depth] === next) return;
      onLayoutChange({
        columnWidths: { ...columnWidths, [depth]: next },
        collapsedLevels,
      });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    const focused = workspaceRef.current?.querySelector(".cards-stack-item.focused");
    focused?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [focusId, columns.length]);

  const reportLabel = useCallback(
    (id: string, label: string) => {
      setLabels((prev) => (prev[id] === label ? prev : { ...prev, [id]: label }));
      if (id === rootEntityId) onRootLabel(label);
    },
    [onRootLabel, rootEntityId],
  );

  function upsertCardUi(panelKey: string, ui: SharedCardUi) {
    const next = { ...cardUi };
    if (!ui.hidden?.length && !ui.inplace?.length && !ui.emptyChips) {
      delete next[panelKey];
    } else {
      next[panelKey] = ui;
    }
    onCardUiChange(Object.keys(next).length ? next : undefined);
  }

  function prunePanelUi(panelKey: string) {
    onCardUiChange(pruneCardUiMap(cardUi, panelKey));
  }

  function openNextLevel(
    fromDepth: number,
    fromEntityId: string,
    neighborId: string,
    meta: {
      slotId?: string;
      slotLabel?: string;
      relationshipId?: string;
      relationshipType?: string;
      direction?: "outgoing" | "incoming";
    },
  ) {
    const existing = findCardLocation(columns, neighborId);
    if (existing) {
      onChange(columns, neighborId);
      return;
    }
    const nextColumns = openToNextLevel(columns, fromDepth, neighborId, {
      entityId: fromEntityId,
      slotId: meta.slotId,
      slotLabel: meta.slotLabel,
      relationshipId: meta.relationshipId,
      relationshipType: meta.relationshipType,
      direction: meta.direction,
    });
    onChange(nextColumns, neighborId);
  }

  function closeCard(targetId: string) {
    const loc = findCardLocation(columns, targetId);
    const descendants = collectDescendantIds(columns, targetId);
    let cascade = false;
    if (descendants.length > 0) {
      cascade = window.confirm(
        `Tato karta má ${descendants.length} otevřených potomků.\n\nOK = zavřít včetně potomků\nZrušit = zavřít jen tuto kartu`,
      );
    }
    const result = closeCardInWorkspace(columns, targetId, focusId, { cascade });
    if (!result) return;
    let nextUi: Record<string, SharedCardUi> | undefined = cardUi;
    if (loc) {
      const panelKey = `${loc.depth}:${targetId}`;
      nextUi = pruneCardUiMap(nextUi, panelKey);
      if (cascade) {
        for (const id of descendants) {
          const dLoc = findCardLocation(columns, id);
          if (dLoc) nextUi = pruneCardUiMap(nextUi, `${dLoc.depth}:${id}`);
        }
      }
    }
    onChange(result.columns, result.focusId, nextUi);
  }

  function toggleLevelCollapsed(depth: number) {
    const next = new Set(collapsedLevels);
    if (next.has(depth)) next.delete(depth);
    else next.add(depth);
    // drop levels beyond current columns
    for (const d of [...next]) {
      if (d >= columns.length) next.delete(d);
    }
    onLayoutChange({ columnWidths, collapsedLevels: next });
  }

  function hideAllInLevel(depth: number) {
    setHideAllTokens((prev) => ({ ...prev, [depth]: (prev[depth] || 0) + 1 }));
  }

  return (
    <div className="cards-workspace" ref={workspaceRef}>
      {columns.map((col, depth) => {
        const collapsed = collapsedLevels.has(depth);
        if (collapsed) {
          return (
            <div key={`col-${depth}`} className="cards-column cards-column-collapsed">
              <button
                type="button"
                className="cards-level-chip"
                title={`Rozbalit úroveň ${depth}`}
                aria-expanded={false}
                onClick={() => toggleLevelCollapsed(depth)}
              >
                Úroveň {depth} ({col.length})
              </button>
            </div>
          );
        }
        return (
          <div
            key={`col-${depth}`}
            className="cards-column"
            style={{ width: columnWidths[depth] ?? DEFAULT_COLUMN_WIDTH }}
          >
            <div className="cards-column-header">
              <button
                type="button"
                className="cards-column-collapse"
                title={`Sbalit úroveň ${depth}`}
                aria-expanded={true}
                onClick={() => toggleLevelCollapsed(depth)}
              >
                Úroveň {depth}
              </button>
              <span className="empty">({col.length})</span>
              <button
                type="button"
                className="cards-column-hide-all"
                data-tooltip="Skrýt všechny sekce karet v úrovni"
                aria-label="Skrýt všechny sekce karet v úrovni"
                title="Skrýt všechny sekce karet v úrovni"
                onClick={() => hideAllInLevel(depth)}
              >
                <EyeIcon crossed />
              </button>
            </div>
            <div className="cards-pinboard">
              {col.map((ref) => (
                <CardPanel
                  key={`${depth}:${ref.entityId}`}
                  entityId={ref.entityId}
                  panelKey={`${depth}:${ref.entityId}`}
                  depth={depth}
                  isFocused={ref.entityId === focusId}
                  variant="column"
                  openedFrom={ref.openedFrom}
                  provenanceLabel={
                    ref.openedFrom ? labels[ref.openedFrom.entityId] || "…" : undefined
                  }
                  allowInplace
                  inplaceAncestors={[]}
                  forceHideAllToken={hideAllTokens[depth] || 0}
                  savedUi={cardUi[`${depth}:${ref.entityId}`]}
                  cardUi={cardUi}
                  onUiChange={upsertCardUi}
                  onPruneUi={prunePanelUi}
                  onClose={() => closeCard(ref.entityId)}
                  onOpenAsNewTab={onOpenAsNewTab}
                  onOpenNextLevel={(neighborId, meta) =>
                    openNextLevel(depth, ref.entityId, neighborId, meta)
                  }
                  onLabel={(label) => reportLabel(ref.entityId, label)}
                />
              ))}
            </div>
            <button
              type="button"
              className="cards-column-resize"
              aria-label={`Změnit šířku úrovně ${depth}`}
              title="Táhnout pro změnu šířky"
              onMouseDown={(e) => {
                e.preventDefault();
                startColumnResize(depth, e.clientX);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function NeighborTable({
  neighbors,
  canInplace,
  inplaceOpen,
  onToggleInplace,
  onOpenNextLevel,
  typeOf,
  renderInplace,
}: {
  neighbors: CardViewModel["slots"][number]["neighbors"] | CardViewModel["expertNeighbors"];
  canInplace: (entityId: string) => boolean;
  inplaceOpen: Record<string, boolean>;
  onToggleInplace: (key: string) => void;
  onOpenNextLevel: (neighbor: (typeof neighbors)[number]) => void;
  typeOf: (neighbor: (typeof neighbors)[number]) => string;
  renderInplace: (neighbor: (typeof neighbors)[number], key: string) => ReactNode;
}) {
  return (
    <table className="cards-neighbor-table">
      <thead>
        <tr>
          <th scope="col">Název</th>
          <th scope="col">Typ</th>
          <th scope="col" className="cards-neighbor-table-icon">
            <span className="visually-hidden">Inplace</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {neighbors.map((n) => {
          const key = neighborKey(n.relationshipId, n.entityId);
          const open = Boolean(inplaceOpen[key]);
          const showInplace = canInplace(n.entityId);
          return (
            <Fragment key={key}>
              <tr>
                <td>
                  <button
                    type="button"
                    className="cards-neighbor-name-btn"
                    onClick={() => onOpenNextLevel(n)}
                    title="Otevřít v další úrovni"
                  >
                    {n.entityLabel}
                  </button>
                </td>
                <td className="empty">{typeOf(n)}</td>
                <td className="cards-neighbor-table-icon">
                  {showInplace ? (
                    <button
                      type="button"
                      className={`cards-neighbor-action${open ? " active" : ""}`}
                      title="Otevřít inplace ve slotu"
                      aria-label="Otevřít inplace ve slotu"
                      aria-pressed={open}
                      onClick={() => onToggleInplace(key)}
                    >
                      ↓
                    </button>
                  ) : (
                    <span className="empty" title="Už je v inplace cestě">
                      —
                    </span>
                  )}
                </td>
              </tr>
              {open && showInplace ? (
                <tr className="cards-neighbor-inplace-row">
                  <td colSpan={3}>
                    <div className="cards-neighbor-inplace">{renderInplace(n, key)}</div>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function CardPanel({
  entityId,
  panelKey,
  depth,
  isFocused,
  variant,
  openedFrom,
  provenanceLabel,
  allowInplace,
  inplaceAncestors = [],
  forceHideAllToken = 0,
  savedUi,
  cardUi = {},
  onUiChange,
  onPruneUi,
  onClose,
  onOpenAsNewTab,
  onOpenNextLevel,
  onLabel,
}: {
  entityId: string;
  panelKey: string;
  depth: number;
  isFocused: boolean;
  variant: "column" | "inplace";
  openedFrom?: CardOpenedFrom;
  provenanceLabel?: string;
  allowInplace: boolean;
  /** Entity ids above this card in the inplace nest (cycle guard). */
  inplaceAncestors?: string[];
  forceHideAllToken?: number;
  savedUi?: SharedCardUi;
  cardUi?: Record<string, SharedCardUi>;
  onUiChange?: (panelKey: string, ui: SharedCardUi) => void;
  onPruneUi?: (panelKey: string) => void;
  onClose: () => void;
  onOpenAsNewTab?: (entityId: string, label?: string) => void;
  onOpenNextLevel: (
    neighborId: string,
    meta: {
      slotId?: string;
      slotLabel?: string;
      relationshipId?: string;
      relationshipType?: string;
      direction?: "outgoing" | "incoming";
    },
  ) => void;
  onLabel: (label: string) => void;
}) {
  const { orgPackage, pushChangeSet, graphEpoch } = useApp();
  const service = useMemo(() => new CardsService(), []);
  const model = useMemo(() => new ModelService(), []);
  const schema = getSchema();
  const [showSystem, setShowSystem] = useState(false);
  const [hiddenSections, setHiddenSections] = useState<Set<SectionKey>>(() => new Set());
  const [inplaceOpen, setInplaceOpen] = useState<Record<string, boolean>>({});
  const [showEmptyChips, setShowEmptyChips] = useState(false);
  const [card, setCard] = useState<CardViewModel | null>(null);
  const [stmts, setStmts] = useState<Statement[]>([]);
  const [labelMap, setLabelMap] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [propBusy, setPropBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState<Record<string, string>>(() => descriptionsDraftFrom());
  const [addTarget, setAddTarget] = useState<
    null | { kind: "slot"; slot: RelationSlotDef } | { kind: "expert" }
  >(null);
  const systemMenuRef = useRef<HTMLDivElement>(null);
  const defaultsForEntity = useRef<string | null>(null);
  const lastHideAllToken = useRef(0);
  const persistUi = useRef(onUiChange);
  persistUi.current = onUiChange;

  function emitUi(
    hidden: Set<SectionKey>,
    inplace: Record<string, boolean>,
    emptyChips: boolean,
  ) {
    persistUi.current?.(
      panelKey,
      snapshotCardUi({ hidden, inplaceOpen: inplace, emptyChips }),
    );
  }

  function applySavedOrDefault(vm: CardViewModel) {
    if (savedUi) {
      const hidden = new Set<SectionKey>(
        (savedUi.hidden || []).filter(Boolean) as SectionKey[],
      );
      const inplace: Record<string, boolean> = {};
      for (const k of savedUi.inplace || []) inplace[k] = true;
      const emptyChips = Boolean(savedUi.emptyChips);
      setHiddenSections(hidden);
      setInplaceOpen(inplace);
      setShowEmptyChips(emptyChips);
      return;
    }
    const hidden = defaultHiddenSections(vm, variant);
    setHiddenSections(hidden);
    setInplaceOpen({});
    setShowEmptyChips(false);
    emitUi(hidden, {}, false);
  }

  useEffect(() => {
    setShowSystem(false);
    setEditingDesc(false);
    setHiddenSections(new Set());
    setInplaceOpen({});
    setShowEmptyChips(false);
    defaultsForEntity.current = null;
    lastHideAllToken.current = forceHideAllToken;
  }, [entityId]); // eslint-disable-line react-hooks/exhaustive-deps -- sync token baseline on entity change only

  useEffect(() => {
    if (!card || forceHideAllToken === 0) return;
    if (forceHideAllToken === lastHideAllToken.current) return;
    lastHideAllToken.current = forceHideAllToken;
    const hidden = new Set(allHideableSections(card));
    setHiddenSections(hidden);
    emitUi(hidden, inplaceOpen, showEmptyChips);
  }, [forceHideAllToken, card]); // eslint-disable-line react-hooks/exhaustive-deps -- snapshot current inplace/chips

  useEffect(() => {
    if (!showSystem) return;
    function onDoc(e: MouseEvent) {
      if (!systemMenuRef.current?.contains(e.target as Node)) setShowSystem(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowSystem(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [showSystem]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const vm = await service.loadCard(entityId, { expert: true });
        if (cancelled) return;
        setCard(vm);
        const defaultsKey = `${entityId}:${variant}`;
        if (defaultsForEntity.current !== defaultsKey) {
          applySavedOrDefault(vm);
          defaultsForEntity.current = defaultsKey;
        }
        onLabel(vm.entityLabel);
        setDescDraft(descriptionsDraftFrom(vm.descriptions));
        setEditingDesc(false);
        const statements = await getKc().getStatements(entityId);
        if (cancelled) return;
        setStmts(statements.items);
        const refIds = statements.items
          .filter((s) => s.value.type === "EntityReference")
          .map((s) => (s.value.type === "EntityReference" ? s.value.entityId : ""))
          .filter(Boolean);
        setLabelMap(refIds.length ? await service.resolveEntityLabels(refIds) : new Map());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId, variant, service, reloadToken, onLabel, graphEpoch]);

  const propertyGroups = useMemo(
    () => groupStatementsByProperty(schema, stmts, card?.classLocal),
    [schema, stmts, card?.classLocal],
  );

  const searchTargetsFor = useCallback(
    (rangeClassLocals: string[]) => (query: string) =>
      service.searchPropertyTargets(orgPackage, rangeClassLocals, query),
    [service, orgPackage],
  );

  const searchSlotCandidates = useCallback(
    (query: string, classLocals: string[]) =>
      service.searchPropertyTargets(orgPackage, classLocals, query),
    [service, orgPackage],
  );

  const allowedEdges = useMemo(
    () => (card ? listAllowedForSubject(schema, card.classLocal) : []),
    [card, schema],
  );

  async function resolveElementDefaults(
    profileCodes: string[] | undefined,
  ): Promise<Record<string, string> | undefined> {
    if (!profileCodes || profileCodes.length !== 1) return undefined;
    const profiles = await getCardsProfileLoader().loadAllProfiles(false, orgPackage);
    const p = profiles.find((x) => x.profileCode === profileCodes[0]);
    return p?.matchProperties && Object.keys(p.matchProperties).length
      ? p.matchProperties
      : undefined;
  }

  async function handleSlotAddSubmit(payload: SlotAddSubmit) {
    if (!card || !addTarget) return;
    if (addTarget.kind === "slot") {
      const slot = addTarget.slot;
      if (payload.mode === "link") {
        const result = await addSlotNeighborLink(model, {
          packageCode: orgPackage,
          subjectId: entityId,
          subjectClassLocal: card.classLocal,
          slot,
          neighborId: payload.neighborId,
          relExtras: payload.relExtras,
        });
        pushChangeSet(result.changeSet);
      } else {
        const elementDefaults = await resolveElementDefaults(slot.targetProfileCodes);
        const result = await addSlotNeighborCreate(model, {
          packageCode: orgPackage,
          subjectId: entityId,
          subjectClassLocal: card.classLocal,
          slot,
          name: payload.name,
          descriptions: payload.descriptions,
          createClassLocal: payload.createClassLocal,
          elementDefaults,
          relExtras: payload.relExtras,
        });
        pushChangeSet(result.changeSet);
      }
    } else {
      const edge = payload.edge;
      if (!edge) throw new Error("Chybí vybraný typ vazby.");
      if (payload.mode === "link") {
        const result = await addExpertNeighborLink(model, {
          packageCode: orgPackage,
          subjectId: entityId,
          subjectClassLocal: card.classLocal,
          typeLocal: edge.typeLocal,
          direction: edge.direction,
          otherClassLocal: edge.otherClassLocal,
          neighborId: payload.neighborId,
          relExtras: payload.relExtras,
        });
        pushChangeSet(result.changeSet);
      } else {
        const result = await addExpertNeighborCreate(model, {
          packageCode: orgPackage,
          subjectId: entityId,
          subjectClassLocal: card.classLocal,
          typeLocal: edge.typeLocal,
          direction: edge.direction,
          otherClassLocal: edge.otherClassLocal,
          name: payload.name,
          descriptions: payload.descriptions,
          relExtras: payload.relExtras,
        });
        pushChangeSet(result.changeSet);
      }
    }
    setReloadToken((t) => t + 1);
  }

  function hideSection(key: SectionKey) {
    setHiddenSections((prev) => {
      const next = new Set(prev).add(key);
      emitUi(next, inplaceOpen, showEmptyChips);
      return next;
    });
  }

  function showSection(key: SectionKey) {
    setHiddenSections((prev) => {
      const next = new Set(prev);
      next.delete(key);
      emitUi(next, inplaceOpen, showEmptyChips);
      return next;
    });
  }

  function toggleAllSections() {
    if (!card) return;
    const hideable = allHideableSections(card);
    const anyVisible = hideable.some((k) => !hiddenSections.has(k));
    const next = anyVisible ? new Set(hideable) : new Set<SectionKey>();
    setHiddenSections(next);
    emitUi(next, inplaceOpen, showEmptyChips);
  }

  function toggleInplace(key: string) {
    setInplaceOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      emitUi(hiddenSections, next, showEmptyChips);
      return next;
    });
  }

  function toggleEmptyChips() {
    setShowEmptyChips((v) => {
      const next = !v;
      emitUi(hiddenSections, inplaceOpen, next);
      return next;
    });
  }

  async function handleReplace(
    propertyLocal: string,
    statement: Statement | undefined,
    newValue: string,
  ) {
    if (!card) return;
    setPropBusy(true);
    try {
      const editRules = propertyEditRules(schema, propertyLocal, card.classLocal);
      const cs = await model.replacePropertyValue({
        packageCode: orgPackage,
        subject: entityId,
        propertyLocal,
        newValue: statementValueFromInput(editRules, newValue),
        existingStatement: statement,
      });
      if (cs) {
        pushChangeSet(cs);
        setReloadToken((t) => t + 1);
      }
    } finally {
      setPropBusy(false);
    }
  }

  async function handleRemove(statement: Statement) {
    if (!window.confirm("Odebrat tuto hodnotu? Statement bude deprecated.")) return;
    setPropBusy(true);
    try {
      const cs = await model.deprecatePropertyStatement(statement);
      pushChangeSet(cs);
      setReloadToken((t) => t + 1);
    } finally {
      setPropBusy(false);
    }
  }

  async function handleAdd(propertyLocal: string, value: string) {
    if (!card) return;
    setPropBusy(true);
    try {
      const editRules = propertyEditRules(schema, propertyLocal, card.classLocal);
      const cs = await model.addPropertyValue({
        packageCode: orgPackage,
        subject: entityId,
        propertyLocal,
        value: statementValueFromInput(editRules, value),
      });
      pushChangeSet(cs);
      setReloadToken((t) => t + 1);
    } finally {
      setPropBusy(false);
    }
  }

  async function handleSaveDescription() {
    if (!card) return;
    const next = normalizeLangMap(descDraft);
    const original = normalizeLangMap(card.descriptions);
    if (langMapsEqual(next, original)) {
      setEditingDesc(false);
      return;
    }
    setPropBusy(true);
    setError(null);
    try {
      const cs = await model.saveEntityBasics({
        id: entityId,
        descriptions: next,
        revision: card.system.revisionNo,
      });
      if (cs) {
        pushChangeSet(cs);
        setReloadToken((t) => t + 1);
      }
      setEditingDesc(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPropBusy(false);
    }
  }

  const propertyCount = propertyGroups.filter((g) => !g.readonly).length;
  const trayItems: Array<{ key: SectionKey; label: string; count: number }> = [];
  if (card) {
    for (const key of allHideableSections(card)) {
      if (hiddenSections.has(key)) {
        trayItems.push({
          key,
          label: sectionLabel(key, card),
          count: sectionItemCount(key, card, propertyCount),
        });
      }
    }
  }
  const trayItemsWithCount = trayItems.filter((item) => item.count > 0);
  const trayItemsEmpty = trayItems.filter((item) => item.count === 0);
  const hideableKeys = card ? allHideableSections(card) : [];
  const anySectionVisible = hideableKeys.some((k) => !hiddenSections.has(k));
  const toggleAllLabel = anySectionVisible ? "Skrýt vše" : "Zobrazit vše";

  function renderNeighborList(
    neighbors: CardViewModel["slots"][number]["neighbors"] | CardViewModel["expertNeighbors"],
    slotId?: string,
    slotLabel?: string,
    expertMeta?: boolean,
  ) {
    const childAncestors = [...inplaceAncestors, entityId];
    return (
      <NeighborTable
        neighbors={neighbors}
        canInplace={(neighborId) =>
          allowInplace &&
          neighborId !== entityId &&
          !childAncestors.includes(neighborId)
        }
        inplaceOpen={inplaceOpen}
        onToggleInplace={toggleInplace}
        typeOf={(n) =>
          expertMeta
            ? `${n.relationshipType} · ${n.profileLabelCs || n.classLocal}`
            : n.profileLabelCs || n.classLocal
        }
        onOpenNextLevel={(n) =>
          onOpenNextLevel(n.entityId, {
            slotId,
            slotLabel: slotLabel || (expertMeta ? "Další vazby" : undefined),
            relationshipId: n.relationshipId,
            relationshipType: expertMeta ? n.relationshipType : undefined,
            direction: expertMeta ? n.direction : undefined,
          })
        }
        renderInplace={(n, key) => (
          <CardPanel
            entityId={n.entityId}
            panelKey={`${panelKey}:inplace:${key}`}
            depth={depth}
            isFocused={false}
            variant="inplace"
            openedFrom={{
              entityId,
              slotId,
              slotLabel: slotLabel || (expertMeta ? "Další vazby" : undefined),
              relationshipId: n.relationshipId,
              relationshipType: expertMeta ? n.relationshipType : undefined,
              direction: expertMeta ? n.direction : undefined,
            }}
            provenanceLabel={card?.entityLabel}
            allowInplace
            inplaceAncestors={childAncestors}
            savedUi={cardUi[`${panelKey}:inplace:${key}`]}
            cardUi={cardUi}
            onUiChange={onUiChange}
            onPruneUi={onPruneUi}
            onClose={() =>
              setInplaceOpen((prev) => {
                const next = { ...prev };
                delete next[key];
                emitUi(hiddenSections, next, showEmptyChips);
                onPruneUi?.(`${panelKey}:inplace:${key}`);
                return next;
              })
            }
            onOpenAsNewTab={onOpenAsNewTab}
            onOpenNextLevel={(neighborId, meta) => onOpenNextLevel(neighborId, meta)}
            onLabel={() => {
              /* nested labels reported via column instances when opened there */
            }}
          />
        )}
      />
    );
  }

  return (
    <div
      className={`cards-stack-item${isFocused ? " focused" : ""}`}
      data-card-depth={depth}
      data-card-variant={variant}
      data-opened-from={openedFrom?.entityId}
    >
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {busy && !card && <p className="empty">Načítám kartu…</p>}

      {card && (
        <article
          className={`element-card${variant === "inplace" ? " element-card-inplace" : ""}`}
        >
          <div className="element-card-system-anchor" ref={systemMenuRef}>
            <button
              type="button"
              className={`element-card-system-btn${showSystem ? " active" : ""}`}
              aria-label="Systémové údaje KC"
              aria-expanded={showSystem}
              title="Systémové údaje"
              onClick={() => setShowSystem((v) => !v)}
            >
              <span aria-hidden="true">{"{}"}</span>
            </button>
            {showSystem && (
              <CardSystemPanel system={card.system} classLocal={card.classLocal} />
            )}
          </div>

          <header className="element-card-header">
            <div className="element-card-title-row">
              <h2>{card.entityLabel}</h2>
              <div className="element-card-title-actions">
                {onOpenAsNewTab && (
                  <button
                    type="button"
                    className="element-card-open-tab"
                    data-tooltip="Otevřít jako novou záložku"
                    aria-label="Otevřít jako novou záložku"
                    title="Otevřít jako novou záložku"
                    onClick={() => onOpenAsNewTab(entityId, card.entityLabel)}
                  >
                    ↗
                  </button>
                )}
                <button
                  type="button"
                  className="element-card-close"
                  aria-label="Zavřít kartu"
                  title="Zavřít"
                  onClick={onClose}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="element-card-meta">
              {card.profile ? card.profile.labelCs : "ArchiMate (bez profilu)"}
              {" · "}
              <span className="mono">{card.classLocal}</span>
              {card.raw && <span className="cards-badge">raw</span>}
            </div>
            {variant !== "inplace" && (provenanceLabel || openedFrom) && (
              <div className="element-card-provenance">
                Otevřeno z:{" "}
                {provenanceLabel && <span>{provenanceLabel}</span>}
                {openedFrom?.slotLabel ? (
                  <>
                    {" · "}
                    <span>{openedFrom.slotLabel}</span>
                  </>
                ) : null}
                {openedFrom?.relationshipType ? (
                  <>
                    {" · "}
                    <span className="mono">{openedFrom.relationshipType}</span>
                  </>
                ) : null}
                {openedFrom?.direction === "outgoing" ? (
                  <>
                    {" · "}
                    <span>forward</span>
                  </>
                ) : openedFrom?.direction === "incoming" ? (
                  <>
                    {" · "}
                    <span>inverse</span>
                  </>
                ) : null}
              </div>
            )}
            {!hiddenSections.has("desc") && (
              <>
                <div className="element-card-section-head">
                  <span className="empty">Popis</span>
                  <SectionHideButton
                    label="Skrýt popis"
                    onClick={() => hideSection("desc")}
                  />
                </div>
                {editingDesc ? (
                  <div className="element-card-desc-edit">
                    <DescriptionEditor
                      value={descDraft}
                      onChange={setDescDraft}
                      disabled={propBusy}
                      idPrefix={`card-desc-${panelKey}`}
                    />
                    <div className="element-card-desc-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={propBusy}
                        onClick={() => void handleSaveDescription()}
                      >
                        Uložit
                      </button>
                      <button
                        type="button"
                        disabled={propBusy}
                        onClick={() => {
                          setDescDraft(descriptionsDraftFrom(card.descriptions));
                          setEditingDesc(false);
                        }}
                      >
                        Zrušit
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="element-card-desc-row">
                    {preferredDescription(card.descriptions) || card.description ? (
                      <div className="element-card-desc-list">
                        {Object.entries(card.descriptions || {}).length > 0
                          ? Object.entries(card.descriptions || {}).map(([lang, text]) =>
                              text.trim() ? (
                                <p key={lang} className="element-card-desc">
                                  <span className="element-card-desc-lang">{lang}</span>
                                  {text}
                                </p>
                              ) : null,
                            )
                          : card.description && (
                              <p className="element-card-desc">{card.description}</p>
                            )}
                      </div>
                    ) : (
                      <p className="element-card-desc empty">Bez popisu</p>
                    )}
                    <button
                      type="button"
                      className="element-card-desc-edit-btn"
                      disabled={propBusy}
                      onClick={() => {
                        setDescDraft(descriptionsDraftFrom(card.descriptions));
                        setEditingDesc(true);
                      }}
                    >
                      {preferredDescription(card.descriptions) || card.description
                        ? "Upravit popis"
                        : "Přidat popis"}
                    </button>
                  </div>
                )}
              </>
            )}
          </header>

          {card.fields.length > 0 && !hiddenSections.has("fields") && (
            <section className="element-card-section">
              <div className="element-card-section-head">
                <h3>Základní informace</h3>
                <SectionHideButton
                  label="Skrýt základní informace"
                  onClick={() => hideSection("fields")}
                />
              </div>
              <dl className="element-card-fields">
                {card.fields.map((f) => (
                  <div key={f.propertyLocal}>
                    <dt>{f.label}</dt>
                    <dd>{f.value || "—"}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {!hiddenSections.has("props") && (
            <section className="element-card-section">
              <div className="element-card-section-head">
                <h3>
                  Properties
                  <span className="empty" style={{ fontWeight: 400, marginLeft: "0.45rem" }}>
                    {propertyGroups.filter((g) => !g.readonly).length}
                    {propertyGroups.some((g) => g.readonly)
                      ? ` (+${propertyGroups.filter((g) => g.readonly).length} sys)`
                      : ""}
                  </span>
                </h3>
                <SectionHideButton
                  label="Skrýt properties"
                  onClick={() => hideSection("props")}
                />
              </div>
              <CardPropertiesPanel
                entityId={entityId}
                classLocal={card.classLocal}
                groups={propertyGroups}
                busy={propBusy}
                labelMap={labelMap}
                onReplace={handleReplace}
                onRemove={handleRemove}
                onAdd={handleAdd}
                searchTargetsFor={searchTargetsFor}
                onPropertyAdded={() => setReloadToken((t) => t + 1)}
              />
            </section>
          )}

          {card.slots.map((sv) => {
            const slotKey = `slot:${sv.slot.id}` as const;
            if (hiddenSections.has(slotKey)) return null;
            return (
              <section key={sv.slot.id} className="element-card-section">
                <div className="element-card-section-head">
                  <h3>
                    {sv.slot.labelCs}
                    {sv.empty && (
                      <span className="cards-empty-hint"> — zatím neuvedeno</span>
                    )}
                  </h3>
                  <div className="element-card-section-actions">
                    <button
                      type="button"
                      className="toolbar-btn"
                      onClick={() => setAddTarget({ kind: "slot", slot: sv.slot })}
                      title={`Přidat vazbu: ${sv.slot.labelCs}`}
                    >
                      + přidat
                    </button>
                    <SectionHideButton
                      label={`Skrýt: ${sv.slot.labelCs}`}
                      onClick={() => hideSection(slotKey)}
                    />
                  </div>
                </div>
                {sv.neighbors.length > 0 ? (
                  renderNeighborList(sv.neighbors, sv.slot.id, sv.slot.labelCs)
                ) : (
                  <p className="empty" style={{ textAlign: "left" }}>
                    Žádné vazby
                  </p>
                )}
              </section>
            );
          })}

          {!hiddenSections.has("expert") && (
            <section className="element-card-section">
              <div className="element-card-section-head">
                <h3>Další možné vazby</h3>
                <div className="element-card-section-actions">
                  <button
                    type="button"
                    className="toolbar-btn"
                    onClick={() => setAddTarget({ kind: "expert" })}
                    title="Přidat ArchiMate vazbu dle matice"
                    disabled={allowedEdges.length === 0}
                  >
                    + přidat vazbu
                  </button>
                  <SectionHideButton
                    label="Skrýt další vazby"
                    onClick={() => hideSection("expert")}
                  />
                </div>
              </div>
              {card.expertNeighbors.length > 0 ? (
                renderNeighborList(card.expertNeighbors, undefined, "Další vazby", true)
              ) : (
                <p className="empty" style={{ textAlign: "left" }}>
                  Žádné další vazby mimo sloty. Použijte „+ přidat vazbu“ pro typ z matice
                  AllowedRelationship.
                </p>
              )}
            </section>
          )}

          {card.raw && card.slots.length === 0 && card.expertNeighbors.length === 0 && (
            <p className="empty" style={{ textAlign: "left" }}>
              Pro tento typ není PresentationProfile a nejsou dostupné žádné vazby.
            </p>
          )}

          <div className="element-card-section-tray" aria-label="Skryté sekce">
            {trayItemsWithCount.map((item) => (
              <button
                key={item.key}
                type="button"
                className="element-card-section-chip"
                onClick={() => showSection(item.key)}
                title={`Zobrazit: ${item.label} (${item.count})`}
              >
                {item.label}
                <span className="element-card-section-chip-count">{item.count}</span>
              </button>
            ))}
            {showEmptyChips &&
              trayItemsEmpty.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="element-card-section-chip element-card-section-chip-empty"
                  onClick={() => showSection(item.key)}
                  title={`Zobrazit: ${item.label} (0)`}
                >
                  {item.label}
                  <span className="element-card-section-chip-count">0</span>
                </button>
              ))}
            {trayItemsEmpty.length > 0 && (
              <button
                type="button"
                className={`element-card-section-chip element-card-section-chip-more${showEmptyChips ? " active" : ""}`}
                aria-expanded={showEmptyChips}
                aria-label={
                  showEmptyChips
                    ? "Skrýt prázdné sekce"
                    : `Zobrazit prázdné sekce (${trayItemsEmpty.length})`
                }
                title={
                  showEmptyChips
                    ? "Skrýt prázdné sekce"
                    : `Další prázdné sekce (${trayItemsEmpty.length})`
                }
                onClick={toggleEmptyChips}
              >
                …
              </button>
            )}
            <button
              type="button"
              className="element-card-section-chip element-card-section-chip-toggle-all"
              data-tooltip={toggleAllLabel}
              aria-label={toggleAllLabel}
              title={toggleAllLabel}
              onClick={toggleAllSections}
            >
              <EyeIcon crossed={anySectionVisible} />
            </button>
          </div>
        </article>
      )}

      {addTarget && card && addTarget.kind === "slot" && (
        <SlotAddDialog
          kind="slot"
          slot={addTarget.slot}
          subjectLabel={card.entityLabel}
          subjectClassLocal={card.classLocal}
          linkedEntityIds={
            card.slots.find((s) => s.slot.id === addTarget.slot.id)?.neighbors.map((n) => n.entityId) ||
            []
          }
          onSearch={searchSlotCandidates}
          onSubmit={handleSlotAddSubmit}
          onClose={() => setAddTarget(null)}
        />
      )}
      {addTarget && card && addTarget.kind === "expert" && (
        <SlotAddDialog
          kind="expert"
          allowedEdges={allowedEdges}
          subjectLabel={card.entityLabel}
          subjectClassLocal={card.classLocal}
          linkedEntityIds={card.expertNeighbors.map((n) => n.entityId)}
          onSearch={searchSlotCandidates}
          onSubmit={handleSlotAddSubmit}
          onClose={() => setAddTarget(null)}
        />
      )}
    </div>
  );
}

function CopyableIri({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="empty">—</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      className="copyable-iri"
      title={label ? `${label} — kliknutím zkopírovat` : "Kliknutím zkopírovat"}
      onClick={() => void copy()}
    >
      <span className="mono">{value}</span>
      <span className="copyable-iri-hint">{copied ? "Zkopírováno" : "kopírovat"}</span>
    </button>
  );
}

function CardSystemPanel({
  system,
  classLocal,
}: {
  system: CardSystemInfo;
  classLocal: string;
}) {
  return (
    <div className="element-card-system-panel" role="dialog" aria-label="Systémové údaje KC">
      <dl className="element-card-system-dl">
        <div>
          <dt>ID</dt>
          <dd>
            <CopyableIri value={system.id} label="ID" />
          </dd>
        </div>
        {system.iri && (
          <div>
            <dt>IRI</dt>
            <dd>
              <CopyableIri value={system.iri} label="IRI" />
            </dd>
          </div>
        )}
        {system.iriLocal && (
          <div>
            <dt>local</dt>
            <dd className="mono">{system.iriLocal}</dd>
          </div>
        )}
        {system.iriAliases.length > 0 && (
          <div>
            <dt>aliasy</dt>
            <dd>
              <ul className="element-card-aliases">
                {system.iriAliases.map((a) => (
                  <li key={`${a.kind}:${a.iri}`}>
                    <CopyableIri value={a.iri} label={`Alias (${a.kind})`} />
                    <span className="empty">{a.kind}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <div>
          <dt>meta</dt>
          <dd className="mono">
            {[system.packageCode, classLocal, system.status, `r${system.revisionNo}`]
              .filter(Boolean)
              .join(" · ")}
          </dd>
        </div>
        {system.effectiveClassLocals.length > 0 && (
          <div>
            <dt>classes</dt>
            <dd className="mono">{system.effectiveClassLocals.join(", ")}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function CardPropertiesPanel({
  entityId,
  classLocal,
  groups,
  busy,
  labelMap,
  onReplace,
  onRemove,
  onAdd,
  searchTargetsFor,
  onPropertyAdded,
}: {
  entityId: string;
  classLocal: string;
  groups: PropertyValueGroup[];
  busy: boolean;
  labelMap: Map<string, string>;
  onReplace: (
    propertyLocal: string,
    statement: Statement | undefined,
    newValue: string,
  ) => Promise<void>;
  onRemove: (statement: Statement) => Promise<void>;
  onAdd: (propertyLocal: string, value: string) => Promise<void>;
  searchTargetsFor: (
    rangeClassLocals: string[],
  ) => (query: string) => Promise<Array<{ id: string; label: string; classLocal: string }>>;
  onPropertyAdded: () => void;
}) {
  const { orgPackage, pushChangeSet } = useApp();
  const schema = getSchema();
  const model = useMemo(() => new ModelService(), []);
  const [propQuery, setPropQuery] = useState("");
  const [propHits, setPropHits] = useState<PropertySearchHit[]>([]);
  const [openHits, setOpenHits] = useState(false);
  const [pendingProp, setPendingProp] = useState<PropertySearchHit | null>(null);
  const [newValue, setNewValue] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [showSystemProps, setShowSystemProps] = useState(false);
  const seq = useRef(0);

  const existingLocals = useMemo(
    () => new Set(groups.map((g) => g.propertyLocal)),
    [groups],
  );

  const systemGroups = useMemo(() => groups.filter((g) => g.readonly), [groups]);
  const visibleGroups = useMemo(
    () => (showSystemProps ? groups : groups.filter((g) => !g.readonly)),
    [groups, showSystemProps],
  );

  useEffect(() => {
    if (!openHits || pendingProp) return;
    const id = ++seq.current;
    const timer = window.setTimeout(() => {
      const hits = searchSchemaProperties(schema, propQuery, {
        classLocal,
        excludeLocals: existingLocals,
        limit: 15,
      });
      if (seq.current === id) setPropHits(hits);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [propQuery, openHits, pendingProp, schema, classLocal, existingLocals]);

  async function assignPending() {
    if (!pendingProp || !newValue.trim()) return;
    setLocalBusy(true);
    try {
      const cs = await model.addPropertyValue({
        packageCode: orgPackage,
        subject: entityId,
        propertyLocal: pendingProp.propertyLocal,
        value: statementValueFromInput(pendingProp.rules, newValue),
      });
      pushChangeSet(cs);
      setPendingProp(null);
      setNewValue("");
      setPropQuery("");
      onPropertyAdded();
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <div className="card-properties">
      {systemGroups.length > 0 && (
        <label className="card-system-props-toggle">
          <input
            type="checkbox"
            checked={showSystemProps}
            onChange={(e) => setShowSystemProps(e.target.checked)}
          />
          Systémové properties ({systemGroups.length})
        </label>
      )}

      {visibleGroups.map((group) => (
        <PropertyStatementEditor
          key={group.propertyLocal}
          group={group}
          compact
          busy={busy || localBusy}
          onReplace={(st, val) => onReplace(group.propertyLocal, st, val)}
          onRemove={onRemove}
          onAdd={(val) => onAdd(group.propertyLocal, val)}
          onSearchTargets={searchTargetsFor(group.rules.rangeClassLocals)}
          resolveLabel={(id) => labelMap.get(id)}
        />
      ))}

      <div className="card-add-property">
        <h4>Přidat property</h4>
        {!pendingProp ? (
          <div className="entity-target-picker">
            <input
              value={propQuery}
              onChange={(e) => {
                setPropQuery(e.target.value);
                setOpenHits(true);
              }}
              onFocus={() => setOpenHits(true)}
              placeholder="Hledat podle label / iriLocal…"
              autoComplete="off"
            />
            {openHits && (
              <ul className="entity-target-suggestions">
                {propHits.length === 0 && (
                  <li className="empty">
                    {propQuery.trim() ? "Žádná property" : "Začněte psát název…"}
                  </li>
                )}
                {propHits.map((h) => (
                  <li key={h.propertyLocal}>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingProp(h);
                        setNewValue(h.rules.enumValues[0] || "");
                        setOpenHits(false);
                        setPropQuery("");
                      }}
                    >
                      <span>{h.label}</span>
                      <span className="empty">
                        {h.propertyLocal} · {h.datatype}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="field">
            <p className="empty stmt-hint" style={{ textAlign: "left", marginTop: 0 }}>
              {pendingProp.label} <code>{pendingProp.propertyLocal}</code> · {pendingProp.datatype}
            </p>
            <PropertyValueInput
              rules={pendingProp.rules}
              value={newValue}
              onChange={setNewValue}
              onSearchTargets={searchTargetsFor(pendingProp.rules.rangeClassLocals)}
            />
            <div className="stmt-actions" style={{ marginTop: "0.35rem" }}>
              <button
                type="button"
                className="toolbar-btn primary"
                disabled={localBusy || !newValue.trim()}
                onClick={() => void assignPending()}
              >
                Přidat hodnotu
              </button>
              <button
                type="button"
                className="toolbar-btn"
                disabled={localBusy}
                onClick={() => {
                  setPendingProp(null);
                  setNewValue("");
                }}
              >
                Zrušit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
