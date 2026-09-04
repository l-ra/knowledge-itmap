import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getKc, type AuthConfig } from "@/kc/client";
import { useApp } from "@/state/AppContext";

export function SettingsPage() {
  const { auth, setAuth, orgPackage, orgPackageLabel, setOrgPackage, reloadSchema, ready, error } =
    useApp();
  const [form, setForm] = useState<AuthConfig>(auth);
  const [pkg, setPkg] = useState(orgPackage);
  const [me, setMe] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const navigate = useNavigate();

  async function testConnection() {
    try {
      getKc().setAuth(form);
      const h = await getKc().healthz();
      const m = await getKc().me();
      setMe(JSON.stringify({ health: h, me: m }, null, 2));
      setMsg("OK");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  function save() {
    setAuth(form);
    setOrgPackage(pkg);
    setMsg("Uloženo — schema se znovu načte");
  }

  return (
    <div className="page">
      <h2>Settings — Knowledge Core</h2>
      <p>
        Stav schema:{" "}
        {ready ? (
          <span style={{ color: "var(--accent)" }}>ready</span>
        ) : (
          <span style={{ color: "var(--danger)" }}>not ready</span>
        )}
        {error ? ` — ${error}` : ""}
      </p>

      <div className="field">
        <label>Auth mode</label>
        <select
          value={form.mode}
          onChange={(e) => setForm({ ...form, mode: e.target.value as AuthConfig["mode"] })}
        >
          <option value="bootstrap">bootstrap (Bearer token = heslo)</option>
          <option value="dev">dev (X-Subject / X-Roles)</option>
          <option value="bearer">bearer / OIDC token</option>
        </select>
      </div>

      {(form.mode === "bootstrap" || form.mode === "bearer" || form.mode === "oidc") && (
        <div className="field">
          <label>Token / bootstrap heslo</label>
          <input
            type="password"
            value={form.token || ""}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            placeholder="KC bootstrap password"
          />
        </div>
      )}

      {form.mode === "dev" && (
        <>
          <div className="field">
            <label>X-Subject</label>
            <input
              value={form.subject || ""}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </div>
          <div className="field">
            <label>X-Roles</label>
            <input
              value={form.roles || ""}
              onChange={(e) => setForm({ ...form, roles: e.target.value })}
            />
          </div>
        </>
      )}

      <div className="field">
        <label>Org package (code)</label>
        <input value={pkg} onChange={(e) => setPkg(e.target.value)} />
        {orgPackageLabel && orgPackageLabel !== orgPackage && (
          <p className="empty" style={{ textAlign: "left", marginTop: "0.35rem" }}>
            Zobrazovaný název: <strong>{orgPackageLabel}</strong>
          </p>
        )}
      </div>

      <p className="empty" style={{ textAlign: "left" }}>
        V dev režimu Vite proxy směruje <code>/v1</code> a <code>/healthz</code> na{" "}
        <code>KC_PROXY_TARGET</code> (default <code>http://localhost:8080</code>).
      </p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="toolbar-btn" onClick={() => void testConnection()}>
          Test connection
        </button>
        <button type="button" className="toolbar-btn primary" onClick={save}>
          Uložit
        </button>
        <button type="button" className="toolbar-btn" onClick={() => void reloadSchema()}>
          Reload schema
        </button>
        <button type="button" className="toolbar-btn" onClick={() => navigate("/")}>
          Zpět na browser
        </button>
      </div>

      {msg && <p>{msg}</p>}
      {me && (
        <pre className="mono" style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>
          {me}
        </pre>
      )}

      <h3 style={{ marginTop: "2rem" }}>Lokální Knowledge Core</h3>
      <ol style={{ color: "var(--text-muted)", lineHeight: 1.7 }}>
        <li>
          V <code>knowledge-core</code>:{" "}
          <code>docker compose -f deploy/docker-compose.yml up -d postgres</code>
        </li>
        <li>
          <code>export KC_AUTH_MODE=bootstrap</code> a <code>make dev</code> (API :8080)
        </li>
        <li>
          Import bundleů: kc-base 1.1.0 → archimate-lite 3.0.0 → archimate-ui-traversal
          1.0.0 (UI nebo <code>scripts/seed-demo.sh</code>)
        </li>
        <li>
          Sem: <code>npm run dev</code> → http://localhost:5174
        </li>
      </ol>
    </div>
  );
}
