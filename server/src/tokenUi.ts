import type { Express, Request, Response } from "express";
import type { McpServerConfig } from "./config.js";
import { tokenUiEnabled } from "./config.js";

export const TOKEN_UI_PATH = "/token";
export const TOKEN_UI_CALLBACK_PATH = "/token/callback";

export type TokenUiPublicConfig = {
  enabled: boolean;
  oidcIssuer: string;
  oidcClientId: string;
  oidcScopes: string;
  redirectPath: string;
  mcpPath: string;
  kcBaseUrl: string;
  authMode: McpServerConfig["authMode"];
  oauthEnabled: boolean;
};

export function buildTokenUiPublicConfig(cfg: McpServerConfig): TokenUiPublicConfig {
  const enabled = tokenUiEnabled(cfg);
  return {
    enabled,
    oidcIssuer: cfg.oauthIssuer,
    oidcClientId: cfg.oauthClientId,
    oidcScopes: (cfg.oauthScopes.length ? cfg.oauthScopes : ["openid", "profile", "email", "groups"]).join(
      " ",
    ),
    redirectPath: TOKEN_UI_CALLBACK_PATH,
    mcpPath: "/mcp",
    kcBaseUrl: cfg.kcBaseUrl,
    authMode: cfg.authMode,
    oauthEnabled: cfg.oauthEnabled,
  };
}

function tokenPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>ITMap MCP — access token</title>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a222c;
      --text: #e8eef4;
      --muted: #9aa8b5;
      --accent: #3d8bfd;
      --accent-hover: #5ca0ff;
      --border: #2c3845;
      --ok: #3dd68c;
      --err: #f07178;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --sans: "Segoe UI", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--sans);
      background:
        radial-gradient(1200px 600px at 10% -10%, #1b2a40 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #1a2f2a 0%, transparent 50%),
        var(--bg);
      color: var(--text);
      line-height: 1.45;
    }
    main {
      max-width: 52rem;
      margin: 0 auto;
      padding: 2.5rem 1.25rem 4rem;
    }
    h1 {
      font-size: 1.55rem;
      font-weight: 650;
      letter-spacing: -0.02em;
      margin: 0 0 0.35rem;
    }
    .sub { color: var(--muted); margin: 0 0 1.75rem; font-size: 0.95rem; }
    .panel {
      background: color-mix(in srgb, var(--panel) 92%, transparent);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem 1.35rem;
      margin-bottom: 1rem;
    }
    .row { display: flex; flex-wrap: wrap; gap: 0.65rem; align-items: center; }
    button, .btn {
      appearance: none;
      border: 0;
      border-radius: 8px;
      padding: 0.55rem 1rem;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      background: var(--accent);
      color: #fff;
    }
    button:hover, .btn:hover { background: var(--accent-hover); }
    button.secondary {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
    }
    button.secondary:hover { border-color: var(--muted); }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    label {
      display: block;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      margin: 0.85rem 0 0.35rem;
    }
    textarea, input[type="text"] {
      width: 100%;
      font-family: var(--mono);
      font-size: 0.78rem;
      background: #0c1015;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.7rem 0.75rem;
      resize: vertical;
    }
    .meta { color: var(--muted); font-size: 0.85rem; margin-top: 0.5rem; }
    .ok { color: var(--ok); }
    .err { color: var(--err); white-space: pre-wrap; }
    .hint {
      font-size: 0.88rem;
      color: var(--muted);
      margin-top: 0.75rem;
    }
    code { font-family: var(--mono); font-size: 0.85em; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <main>
    <h1>ITMap MCP — access token</h1>
    <p class="sub">Přihlášení přes Pocket ID / OIDC a zobrazení Bearer tokenu pro MCP klienty a Knowledge Core.</p>

    <div id="status" class="panel">Načítám konfiguraci…</div>

    <div id="loginPanel" class="panel hidden">
      <div class="row">
        <button type="button" id="loginBtn">Přihlásit přes OIDC</button>
        <button type="button" class="secondary hidden" id="logoutBtn">Odhlásit / vymazat</button>
      </div>
      <p class="hint">Redirect URI v IdP: <code id="redirectHint"></code></p>
    </div>

    <div id="tokenPanel" class="panel hidden">
      <label for="recToken">Doporučený Bearer (id_token || access_token)</label>
      <textarea id="recToken" rows="5" readonly></textarea>
      <div class="row" style="margin-top:0.65rem">
        <button type="button" id="copyRec">Kopírovat</button>
        <span id="copyRecMsg" class="meta"></span>
      </div>

      <label for="accessToken">access_token</label>
      <textarea id="accessToken" rows="4" readonly></textarea>
      <div class="row" style="margin-top:0.65rem">
        <button type="button" class="secondary" id="copyAccess">Kopírovat access_token</button>
      </div>

      <label for="idToken">id_token</label>
      <textarea id="idToken" rows="4" readonly></textarea>
      <div class="row" style="margin-top:0.65rem">
        <button type="button" class="secondary" id="copyId">Kopírovat id_token</button>
      </div>

      <p id="expiresMeta" class="meta"></p>
      <p class="hint">
        MCP HTTP: hlavička <code>Authorization: Bearer &lt;token&gt;</code> na
        <code id="mcpHint"></code>. KC API: stejný Bearer na <code id="kcHint"></code>.
      </p>
    </div>
  </main>
  <script>
(function () {
  const PKCE_KEY = "itmap.mcp.pkce.verifier";
  const STATE_KEY = "itmap.mcp.oidc.state";
  const TOKENS_KEY = "itmap.mcp.oidc.tokens";

  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");
  const loginPanel = $("loginPanel");
  const tokenPanel = $("tokenPanel");

  function b64url(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }

  async function sha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  }

  function setStatus(html, kind) {
    statusEl.innerHTML = html;
    statusEl.classList.toggle("err", kind === "err");
    statusEl.classList.toggle("ok", kind === "ok");
  }

  function redirectUri(cfg) {
    return window.location.origin + cfg.redirectPath;
  }

  async function discovery(issuer) {
    const base = issuer.replace(/\\/$/, "");
    const res = await fetch(base + "/.well-known/openid-configuration");
    if (!res.ok) throw new Error("OIDC discovery failed: " + res.status);
    return res.json();
  }

  function saveTokens(t) {
    sessionStorage.setItem(TOKENS_KEY, JSON.stringify(t));
  }

  function loadTokens() {
    try {
      const raw = sessionStorage.getItem(TOKENS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearTokens() {
    sessionStorage.removeItem(TOKENS_KEY);
    sessionStorage.removeItem(PKCE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  }

  function recommended(tokens) {
    return tokens.id_token || tokens.access_token || "";
  }

  function showTokens(tokens) {
    tokenPanel.classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");
    $("recToken").value = recommended(tokens);
    $("accessToken").value = tokens.access_token || "";
    $("idToken").value = tokens.id_token || "";
    const exp = tokens.expires_at
      ? new Date(tokens.expires_at).toLocaleString()
      : "neznámá";
    $("expiresMeta").textContent = "Platnost (approx.): " + exp;
    setStatus("Přihlášeno. Token je v této kartě prohlížeče (sessionStorage) — po zavření tabu zmizí.", "ok");
  }

  async function startLogin(cfg) {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
    const challenge = b64url(await sha256(verifier));
    sessionStorage.setItem(PKCE_KEY, verifier);
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
    sessionStorage.setItem(STATE_KEY, state);
    const disc = await discovery(cfg.oidcIssuer);
    const params = new URLSearchParams({
      client_id: cfg.oidcClientId,
      response_type: "code",
      scope: cfg.oidcScopes || "openid profile email groups",
      redirect_uri: redirectUri(cfg),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    window.location.href = disc.authorization_endpoint + "?" + params;
  }

  async function finishLogin(cfg, code, state) {
    const expected = sessionStorage.getItem(STATE_KEY);
    if (!expected || expected !== state) throw new Error("Neplatný OIDC state");
    const verifier = sessionStorage.getItem(PKCE_KEY);
    if (!verifier) throw new Error("Chybí PKCE verifier");
    const disc = await discovery(cfg.oidcIssuer);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cfg.oidcClientId,
      code,
      redirect_uri: redirectUri(cfg),
      code_verifier: verifier,
    });
    const tokenRes = await fetch(disc.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenRes.ok) throw new Error("Token exchange failed: " + (await tokenRes.text()));
    const tokens = await tokenRes.json();
    sessionStorage.removeItem(PKCE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    const expiresIn = typeof tokens.expires_in === "number" ? tokens.expires_in : 3600;
    const packed = {
      access_token: tokens.access_token || "",
      id_token: tokens.id_token || "",
      refresh_token: tokens.refresh_token || "",
      expires_at: Date.now() + expiresIn * 1000,
      token_type: tokens.token_type || "Bearer",
    };
    if (!recommended(packed)) throw new Error("Odpověď neobsahuje access_token ani id_token");
    saveTokens(packed);
    history.replaceState({}, "", ${JSON.stringify(TOKEN_UI_PATH)});
    return packed;
  }

  async function copyText(text, msgEl) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    if (msgEl) {
      msgEl.textContent = "Zkopírováno";
      msgEl.className = "meta ok";
      setTimeout(() => { msgEl.textContent = ""; }, 2000);
    }
  }

  async function main() {
    const cfgRes = await fetch(${JSON.stringify(TOKEN_UI_PATH + "/config")});
    if (!cfgRes.ok) throw new Error("config " + cfgRes.status);
    const cfg = await cfgRes.json();

    $("redirectHint").textContent = redirectUri(cfg);
    $("mcpHint").textContent = window.location.origin + cfg.mcpPath;
    $("kcHint").textContent = cfg.kcBaseUrl;

    if (!cfg.enabled) {
      setStatus(
        "Token UI není nakonfigurováno. Nastavte <code>ITMAP_MCP_OIDC_ISSUER</code> a volitelně <code>ITMAP_MCP_OIDC_CLIENT_ID</code> (default <code>knowledge-core</code>).",
        "err",
      );
      return;
    }

    loginPanel.classList.remove("hidden");
    $("loginBtn").onclick = () => startLogin(cfg).catch((e) => setStatus(String(e.message || e), "err"));
    $("logoutBtn").onclick = () => {
      clearTokens();
      tokenPanel.classList.add("hidden");
      $("logoutBtn").classList.add("hidden");
      setStatus("Token vymazán. Můžete se znovu přihlásit.", "ok");
    };
    $("copyRec").onclick = () => copyText($("recToken").value, $("copyRecMsg"));
    $("copyAccess").onclick = () => copyText($("accessToken").value, $("copyRecMsg"));
    $("copyId").onclick = () => copyText($("idToken").value, $("copyRecMsg"));

    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) {
      setStatus("OIDC error: " + err + " " + (params.get("error_description") || ""), "err");
      history.replaceState({}, "", ${JSON.stringify(TOKEN_UI_PATH)});
      return;
    }

    const code = params.get("code");
    const state = params.get("state");
    if (code && state) {
      setStatus("Vyměňuji authorization code…");
      try {
        const tokens = await finishLogin(cfg, code, state);
        showTokens(tokens);
      } catch (e) {
        setStatus(String(e.message || e), "err");
      }
      return;
    }

    const existing = loadTokens();
    if (existing && recommended(existing)) {
      showTokens(existing);
      return;
    }

    setStatus("Přihlaste se pro získání access tokenu (bez tokenu MCP endpoint vyžaduje Bearer).");
  }

  main().catch((e) => setStatus(String(e.message || e), "err"));
})();
  </script>
</body>
</html>`;
}

/** Mount browser token login UI on the MCP HTTP app (when OIDC issuer is configured). */
export function mountTokenUi(app: Express, cfg: McpServerConfig): void {
  const sendPage = (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(tokenPageHtml());
  };

  app.get(TOKEN_UI_PATH, sendPage);
  app.get(TOKEN_UI_CALLBACK_PATH, sendPage);
  app.get(`${TOKEN_UI_PATH}/config`, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(buildTokenUiPublicConfig(cfg));
  });

  if (tokenUiEnabled(cfg)) {
    app.get("/", (_req, res) => {
      res.redirect(302, TOKEN_UI_PATH);
    });
  }
}
