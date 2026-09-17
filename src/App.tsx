import { useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider, useApp } from "@/state/AppContext";
import { Toast } from "@/components/Toast";
import { BrowserPage } from "@/pages/BrowserPage";
import { PackagesPage } from "@/pages/PackagesPage";
import { ChangeSetsPage } from "@/pages/ChangeSetsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SearchPage } from "@/pages/SearchPage";
import { NavigationConfigPage } from "@/pages/NavigationConfigPage";
import { CardsPage } from "@/pages/CardsPage";
import { CardProfilesPage } from "@/pages/CardProfilesPage";
import { LoginPage } from "@/pages/LoginPage";
import { OidcCallbackPage } from "@/pages/OidcCallbackPage";
import { loadUiConfig, type UiConfig } from "@/auth/oidc";

function ChangeSetBar() {
  const {
    activeChangeSet,
    enableManualChangeSet,
    commitManualChangeSet,
    cancelManualChangeSet,
  } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isOpen = !!activeChangeSet?.id;

  async function toggle() {
    setErr(null);
    setBusy(true);
    try {
      if (isOpen) {
        setErr("Nejdřív Commit nebo Cancel aktivního ChangeSetu.");
        return;
      }
      await enableManualChangeSet();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setErr(null);
    setBusy(true);
    try {
      await commitManualChangeSet();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setErr(null);
    setBusy(true);
    try {
      await cancelManualChangeSet();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`cs-bar ${isOpen ? "open" : ""}`}>
      <label className="cs-toggle">
        <input type="checkbox" checked={isOpen} disabled={busy} onChange={() => void toggle()} />
        Manuální ChangeSet
      </label>
      {isOpen && (
        <>
          <span className="cs-meta mono" title={activeChangeSet?.comment || ""}>
            {activeChangeSet?.id}
            {typeof activeChangeSet?.claimCount === "number"
              ? ` · ${activeChangeSet.claimCount} claims`
              : ""}
          </span>
          <button type="button" className="toolbar-btn primary" disabled={busy} onClick={() => void commit()}>
            Commit
          </button>
          <button type="button" className="toolbar-btn" disabled={busy} onClick={() => void cancel()}>
            Cancel
          </button>
        </>
      )}
      {err && <span className="cs-err">{err}</span>}
    </div>
  );
}

function CardsNav() {
  const { pathname } = useLocation();
  const active = pathname === "/cards" || pathname.startsWith("/cards/");
  return (
    <div className={`nav-dropdown ${active ? "active" : ""}`}>
      <button type="button" className="nav-dropdown-trigger" aria-haspopup="true">
        Karty
      </button>
      <div className="nav-dropdown-menu" role="menu">
        <NavLink to="/cards" end role="menuitem">
          Procházet karty
        </NavLink>
        <NavLink to="/cards/profiles" role="menuitem">
          Upravit profily karet
        </NavLink>
      </div>
    </div>
  );
}

function Shell() {
  const { orgPackage, orgPackageLabel, actorSubject } = useApp();
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">IT Map</div>
        <span className="topbar-package" title={orgPackage}>
          {orgPackageLabel}
        </span>
        <ChangeSetBar />
        <nav className="nav-links">
          <CardsNav />
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/packages">Packages</NavLink>
          <NavLink to="/changes">Changes</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        {actorSubject && (
          <span className="topbar-actor muted" title={actorSubject}>
            {actorSubject}
          </span>
        )}
      </header>
      <div className="page-outlet">
        <Routes>
          <Route path="/" element={<Navigate to="/cards" replace />} />
          <Route path="/browser" element={<BrowserPage />} />
          <Route path="/cards/profiles" element={<CardProfilesPage />} />
          <Route path="/cards/:entityId" element={<CardsPage />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/packages" element={<PackagesPage />} />
          <Route path="/navigation" element={<NavigationConfigPage />} />
          <Route path="/changes" element={<ChangeSetsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
      <Toast />
    </div>
  );
}

function needsLogin(cfg: UiConfig | null, authToken: string | undefined, authMode: string): boolean {
  if (!cfg) return false;
  if (cfg.authMode === "oidc") return !authToken;
  if (cfg.authMode === "bootstrap") return !authToken;
  if (cfg.authMode === "dev") return authMode !== "dev";
  return false;
}

function AuthGate({ children }: { children: ReactNode }) {
  const { auth } = useApp();
  const location = useLocation();
  const [cfg, setCfg] = useState<UiConfig | null>(null);
  const [cfgReady, setCfgReady] = useState(false);

  useEffect(() => {
    loadUiConfig()
      .then(setCfg)
      .catch(() => setCfg(null))
      .finally(() => setCfgReady(true));
  }, []);

  const path = location.pathname;
  if (path === "/login" || path === "/callback") {
    return <>{children}</>;
  }

  if (!cfgReady) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="muted">Načítám…</p>
        </div>
      </div>
    );
  }

  if (needsLogin(cfg, auth.token, auth.mode)) {
    return <Navigate to="/login" replace state={{ from: path }} />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/callback" element={<OidcCallbackPage />} />
        <Route
          path="/*"
          element={
            <AuthGate>
              <Shell />
            </AuthGate>
          }
        />
      </Routes>
    </AppProvider>
  );
}
