import { FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { loadUiConfig, startOidcLogin, type UiConfig } from "@/auth/oidc";
import { getKc, loadAuth, type AuthConfig } from "@/kc/client";
import { useApp } from "@/state/AppContext";

export function LoginPage() {
  const { auth, setAuth } = useApp();
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<UiConfig | null>(null);
  const [cfgError, setCfgError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [subject, setSubject] = useState("admin");
  const [roles, setRoles] = useState("admin,editor");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadUiConfig()
      .then(setCfg)
      .catch((e) => setCfgError(e instanceof Error ? e.message : String(e)));
  }, []);

  const hasSession = Boolean(auth.token) || auth.mode === "dev";
  if (hasSession && cfg?.authMode === "oidc") {
    return <Navigate to="/" replace />;
  }
  if (hasSession && cfg?.authMode === "bootstrap" && auth.token) {
    return <Navigate to="/" replace />;
  }

  if (!cfg && !cfgError) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="muted">Načítám konfiguraci autentizace…</p>
        </div>
      </div>
    );
  }

  if (cfgError || !cfg) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>IT Map</h1>
          <p className="error">{cfgError || "Chybí konfigurace"}</p>
          <p className="muted">
            Zkontrolujte, že Knowledge Core běží a <code>/v1/ui/config</code> je dostupné.
          </p>
          <button type="button" className="toolbar-btn" onClick={() => navigate("/settings")}>
            Settings (manuální token)
          </button>
        </div>
      </div>
    );
  }

  async function onBootstrapOrDev(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let next: AuthConfig;
      if (cfg!.authMode === "bootstrap") {
        next = { mode: "bootstrap", token: password, subject: "admin", roles: "admin" };
      } else {
        next = { mode: "dev", subject, roles, token: "" };
      }
      getKc().setAuth(next);
      await getKc().me();
      setAuth(next);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={(e) => void onBootstrapOrDev(e)}>
        <div>
          <h1>IT Map</h1>
          <p className="muted">Přihlášení k Knowledge Core ({cfg.authMode})</p>
        </div>

        {cfg.authMode === "oidc" && (
          <button
            type="button"
            className="toolbar-btn primary"
            disabled={busy || !cfg.oidcIssuer}
            onClick={() => {
              setBusy(true);
              void startOidcLogin(cfg).catch((err) => {
                setBusy(false);
                setError(err instanceof Error ? err.message : String(err));
              });
            }}
          >
            Přihlásit přes Pocket ID / OIDC
          </button>
        )}

        {cfg.authMode === "bootstrap" && (
          <label className="field">
            Bootstrap heslo
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
        )}

        {cfg.authMode === "dev" && (
          <>
            <label className="field">
              X-Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </label>
            <label className="field">
              X-Roles
              <input value={roles} onChange={(e) => setRoles(e.target.value)} />
            </label>
          </>
        )}

        {cfg.authMode !== "oidc" && (
          <button className="toolbar-btn primary" type="submit" disabled={busy}>
            Přihlásit
          </button>
        )}

        {error && <p className="error">{error}</p>}

        <p className="muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
          Aktuální session: {loadAuth().mode}
          {loadAuth().token ? " (token)" : ""}
        </p>
      </form>
    </div>
  );
}
