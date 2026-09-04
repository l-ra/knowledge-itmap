import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CardsService } from "@/domain/cards";
import type { CardViewModel } from "@/domain/cards";
import { entityLabel } from "@/kc/schema";
import { useApp } from "@/state/AppContext";

type HubRow = Awaited<ReturnType<CardsService["listBrowsableEntities"]>>[number];

export function CardsPage() {
  const { entityId } = useParams<{ entityId?: string }>();
  if (entityId) return <CardDetail entityId={decodeURIComponent(entityId)} />;
  return <CardsHub />;
}

function CardsHub() {
  const { orgPackage, ready } = useApp();
  const navigate = useNavigate();
  const service = useMemo(() => new CardsService(), []);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<HubRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(query?: string) {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const items = await service.listBrowsableEntities(orgPackage, query);
      setRows(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [orgPackage, ready]);

  return (
    <div className="page cards-page">
      <div className="cards-toolbar">
        <h2 style={{ margin: 0 }}>Karty</h2>
        <form
          className="cards-search"
          onSubmit={(e) => {
            e.preventDefault();
            void load(q);
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
      <p className="empty" style={{ textAlign: "left", marginTop: 0 }}>
        Procházení modelu po kartách elementů (read-only). Package: <code>{orgPackage}</code>
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {busy && <p className="empty">Načítám…</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Název</th>
            <th>Profil</th>
            <th>ArchiMate</th>
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
    </div>
  );
}

function CardDetail({ entityId }: { entityId: string }) {
  const navigate = useNavigate();
  const service = useMemo(() => new CardsService(), []);
  const [expert, setExpert] = useState(false);
  const [card, setCard] = useState<CardViewModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void service
      .loadCard(entityId, { expert })
      .then((vm) => {
        if (!cancelled) setCard(vm);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId, expert, service]);

  function openNeighbor(nextId: string) {
    setHistory((h) => [...h, entityId]);
    navigate(`/cards/${encodeURIComponent(nextId)}`);
  }

  function goBack() {
    if (history.length === 0) {
      navigate("/cards");
      return;
    }
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    navigate(`/cards/${encodeURIComponent(prev)}`);
  }

  return (
    <div className="page cards-page">
      <div className="cards-toolbar">
        <button type="button" className="toolbar-btn" onClick={goBack}>
          {history.length ? "← Zpět" : "← Hub"}
        </button>
        <Link to="/cards" className="toolbar-btn">
          Všechny karty
        </Link>
        <label className="cards-expert">
          <input
            type="checkbox"
            checked={expert}
            onChange={(e) => setExpert(e.target.checked)}
          />
          Expert (další vazby)
        </label>
      </div>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {busy && !card && <p className="empty">Načítám kartu…</p>}

      {card && (
        <article className="element-card">
          <header className="element-card-header">
            <h2>{card.entityLabel}</h2>
            <div className="element-card-meta">
              {card.profile ? card.profile.labelCs : "ArchiMate (bez profilu)"}
              {" · "}
              <span className="mono">{card.classLocal}</span>
              {card.raw && <span className="cards-badge">raw</span>}
            </div>
            {card.description && <p className="element-card-desc">{card.description}</p>}
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
                        onClick={() => openNeighbor(n.entityId)}
                      >
                        <span>{n.entityLabel}</span>
                        <span className="empty">
                          {n.profileLabelCs || n.classLocal}
                        </span>
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
                      onClick={() => openNeighbor(n.entityId)}
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
