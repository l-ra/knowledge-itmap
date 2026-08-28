import { useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { AppProvider, useApp } from "@/state/AppContext";
import { Toast } from "@/components/Toast";
import { BrowserPage } from "@/pages/BrowserPage";
import { PackagesPage } from "@/pages/PackagesPage";
import { ChangeSetsPage } from "@/pages/ChangeSetsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SearchPage } from "@/pages/SearchPage";
import { NavigationConfigPage } from "@/pages/NavigationConfigPage";

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
        // Must Commit or Cancel — do not silently drop
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

function Shell() {
  const { orgPackage, orgPackageLabel } = useApp();
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">IT Map</div>
        <span className="topbar-package" title={orgPackage}>
          {orgPackageLabel}
        </span>
        <ChangeSetBar />
        <nav className="nav-links">
          <NavLink to="/" end>
            Browser
          </NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/packages">Packages</NavLink>
          <NavLink to="/navigation">Navigace</NavLink>
          <NavLink to="/changes">Changes</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <div className="page-outlet">
        <Routes>
          <Route path="/" element={<BrowserPage />} />
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

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
