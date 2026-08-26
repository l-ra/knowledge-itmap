import { useEffect, useState } from "react";
import { getKc } from "@/kc/client";
import type { PackageInfo, PackageRelease } from "@/kc/types";
import { ModelService } from "@/domain/modelService";
import { useApp } from "@/state/AppContext";

export function PackagesPage() {
  const { orgPackage, setOrgPackage, pushChangeSet, reloadSchema } = useApp();
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [releases, setReleases] = useState<PackageRelease[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("org-demo");
  const [relVersion, setRelVersion] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const res = await getKc().listPackages();
      setPackages(res.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function loadReleases(code: string) {
    try {
      const res = await getKc().listReleases(code);
      setReleases(res.items);
    } catch {
      setReleases([]);
    }
  }

  async function ensureOrg() {
    setBusy(true);
    try {
      const model = new ModelService();
      await model.ensureOrgPackage(newCode);
      setOrgPackage(newCode);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importBundle(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      await getKc().importRelease(json);
      await reloadSchema();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function publish(code: string) {
    if (!relVersion) return;
    setBusy(true);
    try {
      const res = await getKc().publishRelease(code, relVersion);
      pushChangeSet(res.changeSet);
      await loadReleases(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h2>Packages &amp; Releases</h2>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <section style={{ marginBottom: "1.5rem" }}>
        <h3>Aktivní org package</h3>
        <p>
          Aktuální: <strong>{orgPackage}</strong>
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="org-demo" />
          <button type="button" className="toolbar-btn primary" disabled={busy} onClick={() => void ensureOrg()}>
            Vytvořit / použít org package
          </button>
        </div>
        <p className="empty" style={{ textAlign: "left" }}>
          Závislost: <code>archimate-lite ^2.1.0</code>
        </p>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h3>Import release bundle</h3>
        <p className="empty" style={{ textAlign: "left" }}>
          Nejdřív <code>kc-base-1.0.0.bundle.json</code>, pak{" "}
          <code>archimate-lite-2.1.0.bundle.json</code>
        </p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importBundle(f);
          }}
        />
      </section>

      <section>
        <h3>Packages</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Lifecycle</th>
              <th>Labels</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => (
              <tr key={p.code}>
                <td className="mono">{p.code}</td>
                <td>{p.lifecycle}</td>
                <td>{p.labels?.cs || p.labels?.en}</td>
                <td>
                  <button type="button" className="toolbar-btn" onClick={() => setOrgPackage(p.code)}>
                    Použít
                  </button>{" "}
                  <button type="button" className="toolbar-btn" onClick={() => void loadReleases(p.code)}>
                    Releases
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {releases.length > 0 && (
        <section style={{ marginTop: "1rem" }}>
          <h3>Releases</h3>
          <ul>
            {releases.map((r) => (
              <li key={r.version}>
                {r.version} {r.publishedAt ? `· ${r.publishedAt}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h3>Publish release</h3>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={relVersion}
            onChange={(e) => setRelVersion(e.target.value)}
            placeholder="1.0.0"
          />
          <button
            type="button"
            className="toolbar-btn primary"
            disabled={busy}
            onClick={() => void publish(orgPackage)}
          >
            Publish {orgPackage}
          </button>
        </div>
      </section>
    </div>
  );
}
