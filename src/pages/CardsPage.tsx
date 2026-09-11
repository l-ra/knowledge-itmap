import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { PropertyStatementEditor, PropertyValueInput } from "@/components/PropertyStatementEditor";
import {
  DescriptionEditor,
  descriptionsDraftFrom,
  langMapsEqual,
  normalizeLangMap,
  preferredDescription,
} from "@/components/DescriptionEditor";
import { CardsService } from "@/domain/cards";
import type { CardSystemInfo, CardViewModel, CardsHubRow } from "@/domain/cards";
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

type CardsTrailState = { trail?: string[] };

function resolveTrail(entityId: string, state: unknown): string[] {
  const trail = (state as CardsTrailState | null)?.trail;
  if (Array.isArray(trail) && trail.length > 0 && trail[trail.length - 1] === entityId) {
    return trail;
  }
  return [entityId];
}

export function CardsPage() {
  const { entityId } = useParams<{ entityId?: string }>();
  if (entityId) return <CardTrail entityId={decodeURIComponent(entityId)} />;
  return <CardsHub />;
}

function Breadcrumbs({
  items,
}: {
  items: Array<{
    label: string;
    to?: string;
    onClick?: (e: React.MouseEvent) => void;
  }>;
}) {
  return (
    <nav className="breadcrumbs" aria-label="Drobečková navigace">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="breadcrumbs-item">
            {i > 0 && <span className="breadcrumbs-sep">/</span>}
            {item.to && !last ? (
              <Link to={item.to} onClick={item.onClick}>
                {item.label}
              </Link>
            ) : (
              <span
                className={last ? "breadcrumbs-current" : undefined}
                aria-current={last ? "page" : undefined}
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function CardsHub() {
  const { orgPackage, ready, graphEpoch } = useApp();
  const navigate = useNavigate();
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

  return (
    <div className="page cards-page">
      <div className="cards-toolbar">
        <div className="cards-toolbar-main">
          <Breadcrumbs items={[{ label: "Karty" }]} />
          <h2 style={{ margin: 0 }}>Karty</h2>
        </div>
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
      </div>

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
        Procházení modelu po kartách elementů. Package: <code>{orgPackage}</code>
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
              onClick={() => navigate(`/cards/${encodeURIComponent(row.entity.id)}`)}
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

function CardTrail({ entityId }: { entityId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const trail = useMemo(
    () => resolveTrail(entityId, location.state),
    [entityId, location.state],
  );
  const [labels, setLabels] = useState<Record<string, string>>({});
  const stackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = stackRef.current?.querySelector(".cards-stack-item.current");
    current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [trail.length, entityId]);

  const reportLabel = useCallback((id: string, label: string) => {
    setLabels((prev) => (prev[id] === label ? prev : { ...prev, [id]: label }));
  }, []);

  function navigateTrail(nextTrail: string[]) {
    if (nextTrail.length === 0) {
      navigate("/cards");
      return;
    }
    const nextId = nextTrail[nextTrail.length - 1];
    navigate(`/cards/${encodeURIComponent(nextId)}`, {
      state: { trail: nextTrail } satisfies CardsTrailState,
    });
  }

  function openNeighbor(fromIndex: number, nextId: string) {
    navigateTrail([...trail.slice(0, fromIndex + 1), nextId]);
  }

  function goBack() {
    if (trail.length <= 1) {
      navigate("/cards");
      return;
    }
    navigateTrail(trail.slice(0, -1));
  }

  function jumpTo(index: number) {
    navigateTrail(trail.slice(0, index + 1));
  }

  const crumbItems = [
    { label: "Karty", to: "/cards" },
    ...trail.map((id, i) => {
      const last = i === trail.length - 1;
      return {
        label: labels[id] || "…",
        to: last
          ? undefined
          : `/cards/${encodeURIComponent(id)}`,
        onClick: last
          ? undefined
          : (e: React.MouseEvent) => {
              e.preventDefault();
              jumpTo(i);
            },
      };
    }),
  ];

  return (
    <div className="page cards-page">
      <div className="cards-toolbar cards-toolbar-sticky">
        <div className="cards-toolbar-main">
          <Breadcrumbs items={crumbItems} />
          <div className="cards-toolbar-actions">
            <button type="button" className="toolbar-btn" onClick={goBack}>
              {trail.length > 1 ? "← Zpět" : "← Hub"}
            </button>
            <Link to="/cards" className="toolbar-btn">
              Všechny karty
            </Link>
          </div>
        </div>
      </div>

      <div className="cards-stack" ref={stackRef}>
        {trail.map((id, index) => (
          <CardPanel
            key={`${id}:${index}`}
            entityId={id}
            trailIndex={index}
            isCurrent={index === trail.length - 1}
            onOpenNeighbor={(nextId) => openNeighbor(index, nextId)}
            onLabel={(label) => reportLabel(id, label)}
          />
        ))}
      </div>
    </div>
  );
}

function CardPanel({
  entityId,
  trailIndex,
  isCurrent,
  onOpenNeighbor,
  onLabel,
}: {
  entityId: string;
  trailIndex: number;
  isCurrent: boolean;
  onOpenNeighbor: (nextId: string) => void;
  onLabel: (label: string) => void;
}) {
  const { orgPackage, pushChangeSet, graphEpoch } = useApp();
  const service = useMemo(() => new CardsService(), []);
  const model = useMemo(() => new ModelService(), []);
  const schema = getSchema();
  const [expert, setExpert] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const [propsOpen, setPropsOpen] = useState(true);
  const [card, setCard] = useState<CardViewModel | null>(null);
  const [stmts, setStmts] = useState<Statement[]>([]);
  const [labelMap, setLabelMap] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [propBusy, setPropBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState<Record<string, string>>(() => descriptionsDraftFrom());
  const systemMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShowSystem(false);
    setPropsOpen(true);
    setEditingDesc(false);
  }, [entityId]);

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
        const vm = await service.loadCard(entityId, { expert });
        if (cancelled) return;
        setCard(vm);
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
  }, [entityId, expert, service, reloadToken, onLabel, graphEpoch]);

  const propertyGroups = useMemo(
    () => groupStatementsByProperty(schema, stmts, card?.classLocal),
    [schema, stmts, card?.classLocal],
  );

  const searchTargetsFor = useCallback(
    (rangeClassLocals: string[]) => (query: string) =>
      service.searchPropertyTargets(orgPackage, rangeClassLocals, query),
    [service, orgPackage],
  );

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

  return (
    <div
      className={`cards-stack-item${isCurrent ? " current" : ""}`}
      data-trail-index={trailIndex}
    >
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {busy && !card && <p className="empty">Načítám kartu…</p>}

      {card && (
        <article className="element-card">
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
              <label className="cards-expert">
                <input
                  type="checkbox"
                  checked={expert}
                  onChange={(e) => setExpert(e.target.checked)}
                />
                Expert (další vazby)
              </label>
            </div>
            <div className="element-card-meta">
              {card.profile ? card.profile.labelCs : "ArchiMate (bez profilu)"}
              {" · "}
              <span className="mono">{card.classLocal}</span>
              {card.raw && <span className="cards-badge">raw</span>}
            </div>
            {editingDesc ? (
              <div className="element-card-desc-edit">
                <DescriptionEditor
                  value={descDraft}
                  onChange={setDescDraft}
                  disabled={propBusy}
                  idPrefix={`card-desc-${trailIndex}`}
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
          </header>

          {card.fields.length > 0 && (
            <section className="element-card-section">
              <h3>Základní informace</h3>
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

          <section className="element-card-section">
            <button
              type="button"
              className="element-card-section-toggle"
              aria-expanded={propsOpen}
              onClick={() => setPropsOpen((v) => !v)}
            >
              <span className="element-card-section-toggle-label">
                {propsOpen ? "▾" : "▸"} Properties
              </span>
              <span className="empty">
                {propertyGroups.filter((g) => !g.readonly).length}
                {propertyGroups.some((g) => g.readonly)
                  ? ` (+${propertyGroups.filter((g) => g.readonly).length} sys)`
                  : ""}
              </span>
            </button>
            {propsOpen && (
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
            )}
          </section>

          {card.slots.map((sv) => (
            <section key={sv.slot.id} className="element-card-section">
              <h3>
                {sv.slot.labelCs}
                {sv.empty && <span className="cards-empty-hint"> — zatím neuvedeno</span>}
              </h3>
              {sv.neighbors.length > 0 ? (
                <ul className="element-card-neighbors">
                  {sv.neighbors.map((n) => (
                    <li key={`${n.relationshipId}-${n.entityId}`}>
                      <button
                        type="button"
                        className="cards-neighbor-btn"
                        onClick={() => onOpenNeighbor(n.entityId)}
                      >
                        <span>{n.entityLabel}</span>
                        <span className="empty">{n.profileLabelCs || n.classLocal}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty" style={{ textAlign: "left" }}>
                  Žádné vazby
                </p>
              )}
            </section>
          ))}

          {expert && card.expertNeighbors.length > 0 && (
            <section className="element-card-section">
              <h3>Další možné vazby (expert)</h3>
              <ul className="element-card-neighbors">
                {card.expertNeighbors.map((n) => (
                  <li key={`${n.relationshipId}-${n.entityId}`}>
                    <button
                      type="button"
                      className="cards-neighbor-btn"
                      onClick={() => onOpenNeighbor(n.entityId)}
                    >
                      <span>{n.entityLabel}</span>
                      <span className="empty">
                        {n.relationshipType} · {n.profileLabelCs || n.classLocal}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {card.raw && card.slots.length === 0 && !expert && (
            <p className="empty" style={{ textAlign: "left" }}>
              Pro tento typ není PresentationProfile — zapněte Expert pro všechny vazby.
            </p>
          )}
        </article>
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
