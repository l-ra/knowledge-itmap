import { useEffect, useState } from "react";
import { getKc } from "@/kc/client";
import type { ChangeSet } from "@/kc/types";

export function ChangeSetsPage() {
  const [items, setItems] = useState<ChangeSet[]>([]);
  const [detail, setDetail] = useState<ChangeSet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await getKc().listChangeSets(80);
        setItems(res.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  async function openDetail(id: string) {
    try {
      const cs = await getKc().getChangeSet(id);
      setDetail(cs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="page">
      <h2>Change history</h2>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>ID</th>
            <th>Actor</th>
            <th>Operation</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((cs) => (
            <tr key={cs.id}>
              <td>{cs.committedAt || "—"}</td>
              <td className="mono">{cs.id}</td>
              <td>{cs.actor || "—"}</td>
              <td>{cs.operationType || "—"}</td>
              <td>
                <button type="button" className="toolbar-btn" onClick={() => void openDetail(cs.id)}>
                  Detail
                </button>
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
