import { useEffect, useState } from "react";
import { getKc } from "@/kc/client";
import { packageLabel } from "@/kc/schema";
import type { PackageInfo, PackageRelease } from "@/kc/types";
import { ModelService } from "@/domain/modelService";
import { useApp } from "@/state/AppContext";

export function PackagesPage() {
  const {
    orgPackage,
    orgPackageLabel,
    setOrgPackage,
    pushChangeSet,
    reloadSchema,
    reloadPackages,
    packages,
  } = useApp();
  const [detail, setDetail] = useState<PackageInfo | null>(null);
  const [releases, setReleases] = useState<PackageRelease[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("org-demo");
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [iriPrefix, setIriPrefix] = useState("https://example.org/");
  const [relVersion, setRelVersion] = useState("");
  const [busy, setBusy] = useState(false);

  const previewIriBase = (() => {
    const base = iriPrefix.replace(/\/+$/, "");
    const code = newCode.trim();
    return code ? `${base}/${code}/` : `${base}/`;
  })();

  async function refresh() {
    try {
      await reloadPackages();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function loadDetail(code: string) {
    try {
      const pkg = await getKc().getPackage(code);
      setDetail(pkg);
      const res = await getKc().listReleases(code);
      setReleases(res.items);
    } catch (e) {
      setDetail(null);
      setReleases([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function ensureOrg() {
    const code = newCode.trim();
    if (!code) {
      setError("Vyplňte code package (např. org-demo), ne celou URL.");
      return;
    }
    setBusy(true);
    try {
      const model = new ModelService();
      await model.ensureOrgPackage(code, iriPrefix.trim() || "https://example.org/", {
        label: newLabel.trim() || undefined,
        description: newDescription.trim() || undefined,
      });
      setOrgPackage(code);
      await refresh();
      await loadDetail(code);
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
      await loadDetail(code);
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
          Aktuální: <strong>{orgPackageLabel}</strong>
          {orgPackageLabel !== orgPackage && (
            <span className="empty" style={{ marginLeft: "0.5rem" }}>
              (<code>{orgPackage}</code>)
            </span>
          )}
        </p>
        <div className="field">
          <label htmlFor="pkg-code">Code package</label>
          <input
            id="pkg-code"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="org-demo"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="empty" style={{ textAlign: "left", marginTop: "0.35rem" }}>
            Vyplňte jen <strong>code</strong> (např. <code>org-demo</code>), ne celou URL package.
          </p>
        </div>
        <div className="field">
          <label htmlFor="pkg-label">Label (package-root)</label>
          <input
            id="pkg-label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Org Demo"
            autoComplete="off"
          />
          <p className="empty" style={{ textAlign: "left", marginTop: "0.35rem" }}>
            Uloží se na root entitu třídy <code>Package</code>. Bez labelu se použije code.
          </p>
        </div>
        <div className="field">
          <label htmlFor="pkg-desc">Description (volitelné)</label>
          <input
            id="pkg-desc"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Popis organizace / instance package"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="pkg-iri-prefix">IRI base prefix</label>
          <input
            id="pkg-iri-prefix"
            value={iriPrefix}
            onChange={(e) => setIriPrefix(e.target.value)}
            placeholder="https://example.org/"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="empty" style={{ textAlign: "left", marginTop: "0.35rem" }}>
            Výsledné <code>iriBase</code>: <code>{previewIriBase}</code> (= publicId package-root)
          </p>
        </div>
        <button type="button" className="toolbar-btn primary" disabled={busy} onClick={() => void ensureOrg()}>
          Vytvořit / použít org package
        </button>
        <p className="empty" style={{ textAlign: "left" }}>
          Závislost: <code>archimate-lite ^2.3.0</code>
        </p>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h3>Import release bundle</h3>
        <p className="empty" style={{ textAlign: "left" }}>
          Nejdřív <code>kc-base-1.0.0.bundle.json</code>, pak{" "}
          <code>archimate-lite-2.3.0.bundle.json</code>
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
              <th>Název</th>
              <th>Code</th>
              <th>Lifecycle</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => {
              const name = packageLabel(p);
              return (
                <tr key={p.code}>
                  <td>{name}</td>
                  <td className="mono">{p.code}</td>
                  <td>{p.lifecycle}</td>
                  <td>
                    <button type="button" className="toolbar-btn" onClick={() => setOrgPackage(p.code)}>
                      Použít
                    </button>{" "}
                    <button type="button" className="toolbar-btn" onClick={() => void loadDetail(p.code)}>
                      Detail
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {detail && (
        <section style={{ marginTop: "1rem" }}>
          <h3>{packageLabel(detail)}</h3>
          <p className="empty" style={{ textAlign: "left" }}>
            <code>{detail.code}</code>
            {detail.lifecycle ? ` · ${detail.lifecycle}` : ""}
          </p>
          {detail.descriptions && (detail.descriptions.cs || detail.descriptions.en) && (
            <p>{detail.descriptions.cs || detail.descriptions.en}</p>
          )}
          {detail.rootEntityId && (
            <p className="empty" style={{ textAlign: "left" }}>
              Package-root: <code className="mono">{detail.rootEntityId}</code>
            </p>
          )}
          {detail.iriBase && (
            <p className="empty" style={{ textAlign: "left" }}>
              iriBase: <code className="mono">{detail.iriBase}</code>
            </p>
          )}
          {releases.length > 0 && (
            <>
              <h4>Releases</h4>
              <ul>
                {releases.map((r) => (
                  <li key={r.version}>
                    {r.version} {r.publishedAt ? `· ${r.publishedAt}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h3>Publish release</h3>
        <div className="field" style={{ maxWidth: "16rem", display: "inline-block", marginRight: "0.5rem" }}>
          <label htmlFor="rel-version">Verze</label>
          <input
            id="rel-version"
            value={relVersion}
            onChange={(e) => setRelVersion(e.target.value)}
            placeholder="1.0.0"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          className="toolbar-btn primary"
          disabled={busy}
          onClick={() => void publish(orgPackage)}
        >
          Publish {orgPackageLabel}
        </button>
      </section>
    </div>
  );
}
