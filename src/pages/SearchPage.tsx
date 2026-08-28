import { useState, type FormEvent } from "react";
import { getKc } from "@/kc/client";
import { entityLabel } from "@/kc/schema";
import type { Entity } from "@/kc/types";
import { useApp } from "@/state/AppContext";

export function SearchPage() {
  const { packageDisplayName } = useApp();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Entity[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await getKc().search(q);
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page">
      <h2>Search</h2>
      <p className="empty" style={{ textAlign: "left", marginTop: 0 }}>
        Full-text hledá jen v committed datech — rozpracované open ChangeSety ve výsledcích nejsou.
      </p>
      <form onSubmit={(e) => void run(e)} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          style={{ flex: 1 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="full-text…"
        />
        <button type="submit" className="toolbar-btn primary">
          Hledat
        </button>
      </form>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <table className="table" style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>Label</th>
            <th>Package</th>
            <th>IRI</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>{entityLabel(it)}</td>
              <td title={it.packageCode}>{it.packageCode ? packageDisplayName(it.packageCode) : ""}</td>
              <td className="mono">{it.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
