import { useCallback, useEffect, useState } from "react";
import { getKc } from "@/kc/client";
import type { ChangeSet, ChangeSetStatus } from "@/kc/types";
import { useApp } from "@/state/AppContext";

type StatusFilter = "committed" | "open" | "cancelled" | "all";

export function ChangeSetsPage() {
  const { actorSubject, actorRoles, resumeChangeSet, activeChangeSet } = useApp();
  const [status, setStatus] = useState<StatusFilter>("committed");
  const [items, setItems] = useState<ChangeSet[]>([]);
  const [detail, setDetail] = useState<ChangeSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = actorRoles.includes("admin");

  const load = useCallback(async () => {
    try {
      const res = await getKc().listChangeSets({ limit: 80, status });
      setItems(res.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(id: string) {
    try {
      const cs = await getKc().getChangeSet(id);
      setDetail(cs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function canResume(cs: ChangeSet): boolean {
    if (cs.status !== "open") return false;
    if (activeChangeSet?.id === cs.id) return false;
    if (isAdmin) return true;
    if (!actorSubject || !cs.actor) return false;
    return cs.actor === actorSubject;
  }

  async function onResume(id: string) {
    setBusy(true);
    setError(null);
    try {
      await resumeChangeSet(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function whenLabel(cs: ChangeSet): string {
    if (cs.status === "open") return cs.openedAt || "—";
    return cs.committedAt || cs.openedAt || "—";
  }

  function statusLabel(s?: ChangeSetStatus | string): string {
    return s || "committed";
  }

  return (
    <div className="page">
      <h2>Change history</h2>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
        <label>
          Status{" "}
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="committed">committed</option>
            <option value="open">open</option>
            <option value="cancelled">cancelled</option>
            <option value="all">all</option>
          </select>
        </label>
        <button type="button" className="toolbar-btn" onClick={() => void load()}>
          Obnovit
        </button>
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Status</th>
            <th>ID</th>
            <th>Actor</th>
            <th>Operation</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((cs) => (
            <tr key={cs.id}>
              <td>{whenLabel(cs)}</td>
              <td>{statusLabel(cs.status)}</td>
              <td className="mono">{cs.id}</td>
              <td>{cs.actor || "—"}</td>
              <td>{cs.operationType || "—"}</td>
              <td style={{ display: "flex", gap: "0.35rem" }}>
                <button type="button" className="toolbar-btn" onClick={() => void openDetail(cs.id)}>
                  Detail
                </button>
                {canResume(cs) && (
                  <button
                    type="button"
                    className="toolbar-btn primary"
                    disabled={busy}
                    onClick={() => void onResume(cs.id)}
                  >
                    Pokračovat
                  </button>
                )}
                {activeChangeSet?.id === cs.id && <span className="empty">aktivní</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>ChangeSet {detail.id}</h3>
            <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "0.75rem" }}>
              {JSON.stringify(detail, null, 2)}
            </pre>
            <div className="modal-actions">
              <button type="button" className="toolbar-btn" onClick={() => setDetail(null)}>
                Zavřít
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
