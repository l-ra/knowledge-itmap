import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { finishOidcLogin, loadUiConfig } from "@/auth/oidc";
import { getKc } from "@/kc/client";
import { useApp } from "@/state/AppContext";

export function OidcCallbackPage() {
  const { setAuth } = useApp();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setError("Chybí code/state z IdP");
      return;
    }
    void (async () => {
      try {
        const cfg = await loadUiConfig();
        const { token } = await finishOidcLogin(cfg, code, state);
        const next = { mode: "oidc" as const, token, subject: "", roles: "" };
        getKc().setAuth(next);
        try {
          const me = await getKc().me();
          next.subject = me.subject || "";
        } catch {
          /* me optional — token still saved */
        }
        setAuth(next);
        nav("/", { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [params, setAuth, nav]);

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>OIDC přihlášení</h1>
        {error ? <p className="error">{error}</p> : <p className="muted">Dokončuji přihlášení…</p>}
      </div>
    </div>
  );
}
