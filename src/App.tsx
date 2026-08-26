import { NavLink, Route, Routes } from "react-router-dom";
import { AppProvider, useApp } from "@/state/AppContext";
import { Toast } from "@/components/Toast";
import { BrowserPage } from "@/pages/BrowserPage";
import { PackagesPage } from "@/pages/PackagesPage";
import { ChangeSetsPage } from "@/pages/ChangeSetsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SearchPage } from "@/pages/SearchPage";

function Shell() {
  const { orgPackage } = useApp();
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">IT Map</div>
        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{orgPackage}</span>
        <nav className="nav-links">
          <NavLink to="/" end>
            Browser
          </NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/packages">Packages</NavLink>
          <NavLink to="/changes">Changes</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<BrowserPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/packages" element={<PackagesPage />} />
        <Route path="/changes" element={<ChangeSetsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
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
