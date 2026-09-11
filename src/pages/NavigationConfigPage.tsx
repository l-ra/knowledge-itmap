import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ChangeSet } from "@/kc/types";
import {
  elementClassOptions,
  getNavigationService,
  relClassOptions,
  sourceBadgeLabel,
} from "@/domain/navigationProfileService";
import type {
  TemplateBundle,
  UiAddActionMeta,
  UiStageMeta,
  UiTransitionMeta,
  ValidationIssue,
} from "@/domain/navigationProfileTypes";
import { saveStoredTemplateCode } from "@/domain/navigationProfile";
import { useApp } from "@/state/AppContext";

type EditPanel = "stages" | "transitions" | "addActions";

export function NavigationConfigPage() {
  const {
    ready,
    error,
    orgPackage,
    orgPackageLabel,
    activeChangeSet,
    navigationProfile,
    navigationLoading,
    reloadNavigationProfile,
    pushChangeSet,
    setTemplateCode,
    bumpGraphEpoch,
  } = useApp();

  const nav = useMemo(() => getNavigationService(), []);
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [allProfiles, setAllProfiles] = useState<
    Array<{ id: string; profileCode: string; labelCs: string; packageCode?: string }>
  >([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateBundle, setTemplateBundle] = useState<TemplateBundle | null>(null);
  const [panel, setPanel] = useState<EditPanel>("stages");
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);

  const canEdit = !!activeChangeSet?.id;
  const templateInOrg = !!(
    templateBundle?.meta.packageCode === orgPackage ||
    templateBundle?.meta.packageCode?.startsWith(orgPackage)
  );
  const canEditTemplate = canEdit && templateInOrg;

  const loadProfiles = useCallback(async () => {
    if (!ready) return;
    const list = await nav.listAllProfiles();
    setAllProfiles(
      list.map((p) => ({
        id: p.id,
        profileCode: p.profileCode,
        labelCs: p.labelCs || p.profileCode,
        packageCode: p.packageCode,
      })),
    );
  }, [ready, nav]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles, navigationProfile]);

  const loadTemplate = useCallback(
    async (templateId: string) => {
      setBusy(true);
      try {
        const bundle = await nav.loadTemplateForEdit(templateId);
        setTemplateBundle(bundle);
        setSelectedTemplateId(templateId);
        if (bundle.stages.length && !selectedStageId) {
          setSelectedStageId(bundle.stages[0].id);
        }
        const profileId =
          navigationProfile?.orgProfileLinkId || navigationProfile?.systemProfile?.id;
        if (profileId) {
          setValidationIssues(await nav.validateProfile(profileId));
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [nav, navigationProfile, selectedStageId],
  );

  async function runAction(label: string, fn: () => Promise<ChangeSet | void>) {
    setMsg(null);
    setBusy(true);
    try {
      const cs = await fn();
      if (cs) pushChangeSet(cs);
      await reloadNavigationProfile();
      bumpGraphEpoch();
      setMsg(label);
      if (selectedTemplateId) await loadTemplate(selectedTemplateId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function useDefault() {
    await runAction("Výchozí profil aktivní", () => nav.setOrgProfileLink(orgPackage, null));
  }

  async function duplicateDefault() {
    if (!canEdit) {
      setMsg("Otevřete manuální ChangeSet pro editaci.");
      return;
    }
    await runAction("Profil zduplikován", async () => {
      const { changeSet } = await nav.duplicateDefaultProfile(orgPackage, `${orgPackageLabel} — navigace`);
      return changeSet;
    });
  }

  async function connectProfile(profileId: string) {
    if (!canEdit) {
      setMsg("Otevřete manuální ChangeSet pro editaci.");
      return;
    }
    await runAction("Profil připojen", () => nav.setOrgProfileLink(orgPackage, profileId));
  }

  return (
    <div className="page navigation-page">
      <h2>Navigace — traversal profil</h2>

      {(error || !ready) && (
        <div className={`status-banner ${error ? "error" : ""}`}>
          {error || "Načítám schema…"}
        </div>
      )}

      {!canEdit && (
        <div className="status-banner">
          Pro úpravy pravidel zapněte manuální ChangeSet v horní liště.
        </div>
      )}

      {msg && <p className="nav-msg">{msg}</p>}

      <section className="nav-section">
        <h3>Organizace: {orgPackageLabel}</h3>
        <dl className="nav-meta">
          <dt>Systémový profil</dt>
          <dd>{navigationProfile?.systemProfile?.labelCs || "—"}</dd>
          <dt>Org profil</dt>
          <dd>
            {navigationProfile?.orgProfile
              ? `${navigationProfile.orgProfile.labelCs || navigationProfile.orgProfile.profileCode} (${navigationProfile.orgProfile.packageCode})`
              : "— (výchozí systémový)"}
          </dd>
        </dl>
        <div className="nav-actions">
          <button type="button" className="toolbar-btn" disabled={busy || !ready} onClick={() => void useDefault()}>
            Použít výchozí
          </button>
          <button
            type="button"
            className="toolbar-btn primary"
            disabled={busy || !ready || !canEdit}
            onClick={() => void duplicateDefault()}
          >
            Duplikovat výchozí do org
          </button>
        </div>
        {allProfiles.length > 0 && (
          <div className="field" style={{ marginTop: "1rem" }}>
            <label>Připojit existující profil</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <select id="connect-profile" defaultValue="">
                <option value="" disabled>
                  Vyberte profil…
                </option>
                {allProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.labelCs} ({p.packageCode || "?"})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="toolbar-btn"
                disabled={busy || !canEdit}
                onClick={() => {
                  const sel = document.getElementById("connect-profile") as HTMLSelectElement;
                  if (sel?.value) void connectProfile(sel.value);
                }}
              >
                Připojit
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="nav-section">
        <h3>Šablony ({navigationLoading ? "…" : navigationProfile?.templates.length || 0})</h3>
        <ul className="nav-template-list">
          {navigationProfile?.templates.map((t) => (
            <li key={t.template.code}>
              <button
                type="button"
                className={`nav-template-btn ${selectedTemplateId === t.templateEntityId ? "selected" : ""}`}
                onClick={() => {
                  if (t.templateEntityId) void loadTemplate(t.templateEntityId);
                }}
              >
                <span>{t.template.labelCs}</span>
                <span className="badge">{sourceBadgeLabel(t.source)}</span>
                <span className="mono">{t.template.code}</span>
              </button>
              <button
                type="button"
                className="toolbar-btn"
                title="Otevřít v Browseru"
                onClick={() => {
                  setTemplateCode(t.template.code);
                  saveStoredTemplateCode(t.template.code);
                  navigate("/browser");
                }}
              >
                Browser
              </button>
            </li>
          ))}
        </ul>
      </section>

      {validationIssues.length > 0 && (
        <section className="nav-section">
          <h3>Validace</h3>
          <ul className="nav-issues">
            {validationIssues.map((issue, i) => (
              <li key={`${issue.code}-${i}`} className={issue.severity}>
                [{issue.severity}] {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {templateBundle && (
        <section className="nav-section nav-editor">
          <h3>
            Editor: {templateBundle.meta.labelCs}{" "}
            <span className="mono">({templateBundle.meta.templateCode})</span>
          </h3>
          {!templateInOrg && (
            <p className="nav-hint">
              Systémová šablona je jen pro čtení. Duplikujte profil do org pro úpravy.
            </p>
          )}

          <div className="nav-panel-tabs">
            {(["stages", "transitions", "addActions"] as EditPanel[]).map((p) => (
              <button
                key={p}
                type="button"
                className={panel === p ? "active" : ""}
                onClick={() => setPanel(p)}
              >
                {p === "stages" ? "Stages" : p === "transitions" ? "Transitions" : "Add actions"}
              </button>
            ))}
          </div>

          {panel === "stages" && (
            <StagesPanel
              stages={templateBundle.stages}
              selectedId={selectedStageId}
              onSelect={setSelectedStageId}
              canEdit={canEditTemplate}
              busy={busy}
              packageCode={orgPackage}
              templateId={templateBundle.meta.id}
              nav={nav}
              onSaved={(cs) => {
                pushChangeSet(cs);
                void reloadNavigationProfile();
                void loadTemplate(templateBundle.meta.id);
              }}
              onError={setMsg}
            />
          )}

          {panel === "transitions" && (
            <TransitionsPanel
              stages={templateBundle.stages}
              transitions={templateBundle.transitions}
              selectedStageId={selectedStageId}
              canEdit={canEditTemplate}
              busy={busy}
              packageCode={orgPackage}
              templateId={templateBundle.meta.id}
              nav={nav}
              onSaved={(cs) => {
                pushChangeSet(cs);
                void reloadNavigationProfile();
                void loadTemplate(templateBundle.meta.id);
              }}
              onError={setMsg}
            />
          )}

          {panel === "addActions" && (
            <AddActionsPanel
              stages={templateBundle.stages}
              actions={templateBundle.addActions}
              selectedStageId={selectedStageId}
              canEdit={canEditTemplate}
              busy={busy}
              packageCode={orgPackage}
              templateId={templateBundle.meta.id}
              nav={nav}
              onSaved={(cs) => {
                pushChangeSet(cs);
                void reloadNavigationProfile();
                void loadTemplate(templateBundle.meta.id);
              }}
              onError={setMsg}
            />
          )}
        </section>
      )}
    </div>
  );
}

function StagesPanel({
  stages,
  selectedId,
  onSelect,
  canEdit,
  busy,
  packageCode,
  templateId,
  nav,
  onSaved,
  onError,
}: {
  stages: UiStageMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  canEdit: boolean;
  busy: boolean;
  packageCode: string;
  templateId: string;
  nav: ReturnType<typeof getNavigationService>;
  onSaved: (cs: ChangeSet) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    stageCode: "",
    columnLabelCs: "",
    stageOrder: stages.length + 1,
    targetClasses: [] as string[],
    actorKinds: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const classOptions = useMemo(() => elementClassOptions(), []);

  useEffect(() => {
    const s = stages.find((x) => x.id === selectedId);
    if (s) {
      setForm({
        stageCode: s.stageCode,
        columnLabelCs: s.columnLabelCs,
        stageOrder: s.stageOrder,
        targetClasses: [...s.targetClassLocals],
        actorKinds: s.actorKinds?.join(",") || "",
      });
      setEditingId(s.id);
    }
  }, [selectedId, stages]);

  async function save() {
    if (!canEdit) return;
    try {
      const { changeSet } = await nav.upsertStage({
        packageCode,
        templateId,
        stageId: editingId || undefined,
        stageCode: form.stageCode,
        columnLabelCs: form.columnLabelCs,
        stageOrder: form.stageOrder,
        targetClasses: form.targetClasses,
        actorKinds: form.actorKinds || undefined,
      });
      onSaved(changeSet);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="nav-split">
      <ul className="nav-item-list">
        {stages.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={selectedId === s.id ? "selected" : ""}
              onClick={() => onSelect(s.id)}
            >
              {s.stageOrder}. {s.columnLabelCs} <span className="mono">({s.stageCode})</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="nav-form">
        <div className="field">
          <label>stageCode</label>
          <input
            value={form.stageCode}
            disabled={!canEdit || busy}
            onChange={(e) => setForm({ ...form, stageCode: e.target.value })}
          />
        </div>
        <div className="field">
          <label>columnLabelCs</label>
          <input
            value={form.columnLabelCs}
            disabled={!canEdit || busy}
            onChange={(e) => setForm({ ...form, columnLabelCs: e.target.value })}
          />
        </div>
        <div className="field">
          <label>stageOrder</label>
          <input
            type="number"
            value={form.stageOrder}
            disabled={!canEdit || busy}
            onChange={(e) => setForm({ ...form, stageOrder: parseInt(e.target.value, 10) || 0 })}
          />
        </div>
        <div className="field">
          <label>targetClasses</label>
          <select
            multiple
            size={6}
            disabled={!canEdit || busy}
            value={form.targetClasses}
            onChange={(e) => {
              const selected = [...e.target.selectedOptions].map((o) => o.value);
              setForm({ ...form, targetClasses: selected });
            }}
          >
            {classOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>actorKinds (CSV)</label>
          <input
            value={form.actorKinds}
            disabled={!canEdit || busy}
            placeholder="department,person,external"
            onChange={(e) => setForm({ ...form, actorKinds: e.target.value })}
          />
        </div>
        <div className="nav-form-actions">
          <button type="button" className="toolbar-btn primary" disabled={!canEdit || busy} onClick={() => void save()}>
            Uložit stage
          </button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={!canEdit || busy || !editingId}
            onClick={() => {
              if (!editingId) return;
              void nav.deleteStage(packageCode, editingId).then(onSaved).catch((e) => onError(String(e)));
            }}
          >
            Smazat
          </button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={!canEdit || busy}
            onClick={() => {
              setEditingId(null);
              setForm({
                stageCode: "",
                columnLabelCs: "",
                stageOrder: stages.length + 1,
                targetClasses: [],
                actorKinds: "",
              });
            }}
          >
            Nový
          </button>
        </div>
      </div>
    </div>
  );
}

function TransitionsPanel({
  stages,
  transitions,
  selectedStageId,
  canEdit,
  busy,
  packageCode,
  templateId,
  nav,
  onSaved,
  onError,
}: {
  stages: UiStageMeta[];
  transitions: UiTransitionMeta[];
  selectedStageId: string | null;
  canEdit: boolean;
  busy: boolean;
  packageCode: string;
  templateId: string;
  nav: ReturnType<typeof getNavigationService>;
  onSaved: (cs: ChangeSet) => void;
  onError: (msg: string) => void;
}) {
  const relOptions = useMemo(() => relClassOptions(), []);
  const stageCode = (id: string) => stages.find((s) => s.id === id)?.stageCode || id;
  const filtered = selectedStageId
    ? transitions.filter((t) => t.fromStageId === selectedStageId || t.toStageId === selectedStageId)
    : transitions;

  const [form, setForm] = useState({
    transitionId: "" as string | undefined,
    fromStageId: stages[0]?.id || "",
    toStageId: stages[1]?.id || stages[0]?.id || "",
    relationshipClass: "Assignment",
    traverseDirection: "model" as "model" | "inverse",
    uiEdgeLabelCs: "",
    requireProperty: "",
  });

  return (
    <div className="nav-split">
      <table className="nav-table">
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th>Vztah</th>
            <th>Směr</th>
            <th>Label</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filtered.map((t) => (
            <tr key={t.id}>
              <td>{stageCode(t.fromStageId)}</td>
              <td>{stageCode(t.toStageId)}</td>
              <td>{t.relationshipClassLocal}</td>
              <td>{t.traverseDirection}</td>
              <td>{t.uiEdgeLabelCs}</td>
              <td>
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() =>
                    setForm({
                      transitionId: t.id,
                      fromStageId: t.fromStageId,
                      toStageId: t.toStageId,
                      relationshipClass: t.relationshipClassLocal,
                      traverseDirection: t.traverseDirection,
                      uiEdgeLabelCs: t.uiEdgeLabelCs,
                      requireProperty: t.requireProperty ? JSON.stringify(t.requireProperty) : "",
                    })
                  }
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="nav-form">
        <div className="field">
          <label>fromStage</label>
          <select
            disabled={!canEdit || busy}
            value={form.fromStageId}
            onChange={(e) => setForm({ ...form, fromStageId: e.target.value })}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.stageCode}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>toStage</label>
          <select
            disabled={!canEdit || busy}
            value={form.toStageId}
            onChange={(e) => setForm({ ...form, toStageId: e.target.value })}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.stageCode}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>relationshipClass</label>
          <select
            disabled={!canEdit || busy}
            value={form.relationshipClass}
            onChange={(e) => setForm({ ...form, relationshipClass: e.target.value })}
          >
            {relOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>traverseDirection</label>
          <select
            disabled={!canEdit || busy}
            value={form.traverseDirection}
            onChange={(e) =>
              setForm({
                ...form,
                traverseDirection: e.target.value as "model" | "inverse",
              })
            }
          >
            <option value="model">model</option>
            <option value="inverse">inverse</option>
          </select>
        </div>
        <div className="field">
          <label>uiEdgeLabelCs</label>
          <input
            disabled={!canEdit || busy}
            value={form.uiEdgeLabelCs}
            onChange={(e) => setForm({ ...form, uiEdgeLabelCs: e.target.value })}
          />
        </div>
        <button
          type="button"
          className="toolbar-btn primary"
          disabled={!canEdit || busy}
          onClick={() => {
            void nav
              .upsertTransition({
                packageCode,
                templateId,
                transitionId: form.transitionId,
                fromStageId: form.fromStageId,
                toStageId: form.toStageId,
                relationshipClass: form.relationshipClass,
                traverseDirection: form.traverseDirection,
                uiEdgeLabelCs: form.uiEdgeLabelCs,
                requireProperty: form.requireProperty || undefined,
              })
              .then(({ changeSet }) => onSaved(changeSet))
              .catch((e) => onError(e instanceof Error ? e.message : String(e)));
          }}
        >
          Uložit transition
        </button>
      </div>
    </div>
  );
}

function AddActionsPanel({
  stages,
  actions,
  selectedStageId,
  canEdit,
  busy,
  packageCode,
  templateId,
  nav,
  onSaved,
  onError,
}: {
  stages: UiStageMeta[];
  actions: UiAddActionMeta[];
  selectedStageId: string | null;
  canEdit: boolean;
  busy: boolean;
  packageCode: string;
  templateId: string;
  nav: ReturnType<typeof getNavigationService>;
  onSaved: (cs: ChangeSet) => void;
  onError: (msg: string) => void;
}) {
  const classOptions = useMemo(() => elementClassOptions(), []);
  const relOptions = useMemo(() => relClassOptions(), []);
  const filtered = selectedStageId
    ? actions.filter((a) => a.stageId === selectedStageId)
    : actions;

  const [form, setForm] = useState({
    actionId: "" as string | undefined,
    stageId: stages[0]?.id || "",
    actionCode: "",
    domainLabelCs: "",
    createsClass: "BusinessFunction",
    derivesRelationship: "",
    relationshipDirection: "from-selected-to-new",
    defaultProperties: "",
    relationshipDefaults: "",
  });

  return (
    <div className="nav-split">
      <ul className="nav-item-list">
        {filtered.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() =>
                setForm({
                  actionId: a.id,
                  stageId: a.stageId,
                  actionCode: a.actionCode,
                  domainLabelCs: a.domainLabelCs,
                  createsClass: a.createsClassLocal,
                  derivesRelationship: a.derivesRelationship || "",
                  relationshipDirection: a.relationshipDirection || "from-selected-to-new",
                  defaultProperties: a.defaultProperties
                    ? JSON.stringify(a.defaultProperties)
                    : "",
                  relationshipDefaults: a.relationshipDefaults
                    ? JSON.stringify(a.relationshipDefaults)
                    : "",
                })
              }
            >
              {a.domainLabelCs} → {a.createsClassLocal}
            </button>
          </li>
        ))}
      </ul>
      <div className="nav-form">
        <div className="field">
          <label>stage</label>
          <select
            disabled={!canEdit || busy}
            value={form.stageId}
            onChange={(e) => setForm({ ...form, stageId: e.target.value })}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.stageCode}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>actionCode</label>
          <input
            disabled={!canEdit || busy}
            value={form.actionCode}
            onChange={(e) => setForm({ ...form, actionCode: e.target.value })}
          />
        </div>
        <div className="field">
          <label>domainLabelCs</label>
          <input
            disabled={!canEdit || busy}
            value={form.domainLabelCs}
            onChange={(e) => setForm({ ...form, domainLabelCs: e.target.value })}
          />
        </div>
        <div className="field">
          <label>createsClass</label>
          <select
            disabled={!canEdit || busy}
            value={form.createsClass}
            onChange={(e) => setForm({ ...form, createsClass: e.target.value })}
          >
            {classOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>derivesRelationship</label>
          <select
            disabled={!canEdit || busy}
            value={form.derivesRelationship}
            onChange={(e) => setForm({ ...form, derivesRelationship: e.target.value })}
          >
            <option value="">—</option>
            {relOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="toolbar-btn primary"
          disabled={!canEdit || busy}
          onClick={() => {
            void nav
              .upsertAddAction({
                packageCode,
                templateId,
                actionId: form.actionId,
                stageId: form.stageId,
                actionCode: form.actionCode,
                domainLabelCs: form.domainLabelCs,
                createsClass: form.createsClass,
                derivesRelationship: form.derivesRelationship || undefined,
                relationshipDirection: form.relationshipDirection,
                defaultProperties: form.defaultProperties || undefined,
                relationshipDefaults: form.relationshipDefaults || undefined,
              })
              .then(({ changeSet }) => onSaved(changeSet))
              .catch((e) => onError(e instanceof Error ? e.message : String(e)));
          }}
        >
          Uložit add action
        </button>
      </div>
    </div>
  );
}
