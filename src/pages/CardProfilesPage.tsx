import { useCallback, useEffect, useMemo, useState } from "react";
import {
  draftFromProfile,
  emptyProfileDraft,
  emptySlotDraft,
  formatProfileDefinition,
  getCardProfileService,
  type ProfileDraft,
  type ProfileSlotDraft,
} from "@/domain/cards/cardProfileService";
import { elementClassOptions, relClassOptions } from "@/domain/navigationProfileService";
import type { PresentationProfileDef } from "@/domain/cards";
import { UI_CARDS_PKG } from "@/domain/cards";
import { useApp } from "@/state/AppContext";

export function CardProfilesPage() {
  const {
    ready,
    error,
    orgPackage,
    orgPackageLabel,
    activeChangeSet,
    pushChangeSet,
    bumpGraphEpoch,
    graphEpoch,
  } = useApp();

  const svc = useMemo(() => getCardProfileService(), []);
  const [profiles, setProfiles] = useState<PresentationProfileDef[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [editing, setEditing] = useState(false);

  const canEdit = !!activeChangeSet?.id;
  const elementOpts = useMemo(() => elementClassOptions(), [ready]);
  const relOpts = useMemo(() => relClassOptions(), [ready]);

  const selected = profiles.find((p) => p.id === selectedId) || null;
  const selectedEditable = selected
    ? svc.isEditableInPackage(selected, orgPackage)
    : false;

  const load = useCallback(async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const list = await svc.listResolvedProfiles(orgPackage);
      setProfiles(list);
      setSelectedId((prev) => {
        if (prev && list.some((p) => p.id === prev)) return prev;
        return list[0]?.id || null;
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [ready, svc, orgPackage]);

  useEffect(() => {
    void load();
  }, [load, graphEpoch]);

  function startCreate() {
    if (!canEdit) {
      setMsg("Otevřete manuální ChangeSet pro úpravu profilů karet.");
      return;
    }
    setSelectedId(null);
    setDraft(emptyProfileDraft());
    setEditing(true);
    setMsg(null);
  }

  function startEdit(profile: PresentationProfileDef) {
    if (!canEdit) {
      setMsg("Otevřete manuální ChangeSet pro úpravu profilů karet.");
      return;
    }
    if (!svc.isEditableInPackage(profile, orgPackage)) {
      setMsg(null);
      void forkAndEdit(profile);
      return;
    }
    setSelectedId(profile.id);
    setDraft(draftFromProfile(profile));
    setEditing(true);
    setMsg(null);
  }

  async function forkAndEdit(profile: PresentationProfileDef) {
    setBusy(true);
    setMsg(null);
    try {
      const { profileId, changeSet } = await svc.forkProfileToOrg(profile.id, orgPackage);
      pushChangeSet(changeSet);
      bumpGraphEpoch();
      const list = await svc.listResolvedProfiles(orgPackage);
      setProfiles(list);
      const forked = list.find((p) => p.id === profileId);
      if (forked) {
        setSelectedId(forked.id);
        setDraft(draftFromProfile(forked));
        setEditing(true);
        setMsg(`Profil zkopírován do ${orgPackageLabel} — můžete upravit.`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    if (!canEdit) {
      setMsg("Otevřete manuální ChangeSet pro úpravu profilů karet.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const { profileId, changeSet } = await svc.upsertProfile(orgPackage, draft);
      pushChangeSet(changeSet);
      bumpGraphEpoch();
      const list = await svc.listResolvedProfiles(orgPackage);
      setProfiles(list);
      setSelectedId(profileId);
      const saved = list.find((p) => p.id === profileId);
      setDraft(saved ? draftFromProfile(saved) : draft);
      setEditing(false);
      setMsg("Profil uložen do otevřeného ChangeSetu.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(patch: Partial<ProfileDraft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function updateSlot(index: number, patch: Partial<ProfileSlotDraft>) {
    setDraft((d) => {
      if (!d) return d;
      const slots = d.slots.map((s, i) => (i === index ? { ...s, ...patch } : s));
      return { ...d, slots };
    });
  }

  function addSlot() {
    setDraft((d) => (d ? { ...d, slots: [...d.slots, emptySlotDraft()] } : d));
  }

  function removeSlot(index: number) {
    setDraft((d) => (d ? { ...d, slots: d.slots.filter((_, i) => i !== index) } : d));
  }

  return (
    <div className="page card-profiles-page">
      <h2>Profily karet</h2>
      <p className="muted">
        Prezentační profily řídí, jak se entity zobrazují v režimu Karty. Úpravy jen v manuálním
        ChangeSetu; org kopie přepisují systémové profily se stejným kódem.
      </p>

      {(error || !ready) && (
        <div className={`status-banner ${error ? "error" : ""}`}>
          {error || "Načítám schema…"}
        </div>
      )}

      {!canEdit && (
        <div className="status-banner">
          Pro úpravy profilů zapněte manuální ChangeSet v horní liště.
        </div>
      )}

      {msg && <p className="nav-msg">{msg}</p>}

      <div className="card-profiles-layout">
        <section className="nav-section card-profiles-list">
          <div className="card-profiles-list-head">
            <h3>Profily ({profiles.length})</h3>
            <button
              type="button"
              className="toolbar-btn primary"
              disabled={busy || !ready || !canEdit}
              onClick={startCreate}
            >
              Nový profil
            </button>
          </div>
          <ul className="nav-template-list">
            {profiles.map((p) => {
              const orgOwned = p.packageCode === orgPackage && p.packageCode !== UI_CARDS_PKG;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`nav-template-btn ${selectedId === p.id ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedId(p.id);
                      setDraft(null);
                      setEditing(false);
                      setMsg(null);
                    }}
                  >
                    <span>{p.labelCs || p.profileCode}</span>
                    <span className="badge">{orgOwned ? "org" : "systém"}</span>
                    <span className="mono">{p.profileCode}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {busy && profiles.length === 0 && <p className="empty">Načítám…</p>}
        </section>

        <section className="nav-section card-profiles-detail">
          {editing && draft ? (
            <ProfileEditor
              draft={draft}
              canEdit={canEdit}
              busy={busy}
              elementOpts={elementOpts}
              relOpts={relOpts}
              onChange={updateDraft}
              onSlotChange={updateSlot}
              onAddSlot={addSlot}
              onRemoveSlot={removeSlot}
              onSave={() => void save()}
              onCancel={() => {
                setEditing(false);
                setDraft(null);
              }}
            />
          ) : selected ? (
            <>
              <div className="card-profiles-list-head">
                <h3>{selected.labelCs || selected.profileCode}</h3>
                <button
                  type="button"
                  className="toolbar-btn primary"
                  disabled={busy || !ready || !canEdit}
                  onClick={() => startEdit(selected)}
                >
                  {selectedEditable ? "Upravit" : "Upravit (kopie do org)"}
                </button>
              </div>
              <dl className="nav-meta">
                <dt>Kód</dt>
                <dd className="mono">{selected.profileCode}</dd>
                <dt>Balíček</dt>
                <dd className="mono">{selected.packageCode || "—"}</dd>
                <dt>Popis</dt>
                <dd>{selected.descriptionCs || "—"}</dd>
              </dl>
              <pre className="profile-definition">{formatProfileDefinition(selected)}</pre>
            </>
          ) : (
            <p className="empty">Vyberte profil ze seznamu.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function ProfileEditor({
  draft,
  canEdit,
  busy,
  elementOpts,
  relOpts,
  onChange,
  onSlotChange,
  onAddSlot,
  onRemoveSlot,
  onSave,
  onCancel,
}: {
  draft: ProfileDraft;
  canEdit: boolean;
  busy: boolean;
  elementOpts: string[];
  relOpts: string[];
  onChange: (patch: Partial<ProfileDraft>) => void;
  onSlotChange: (index: number, patch: Partial<ProfileSlotDraft>) => void;
  onAddSlot: () => void;
  onRemoveSlot: (index: number) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="nav-form">
      <h3>{draft.id ? "Upravit profil" : "Nový profil"}</h3>
      <div className="field">
        <label htmlFor="pp-code">Kód profilu</label>
        <input
          id="pp-code"
          value={draft.profileCode}
          disabled={busy || !!draft.id}
          onChange={(e) => onChange({ profileCode: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="pp-label-cs">Label (CS)</label>
        <input
          id="pp-label-cs"
          value={draft.labelCs}
          disabled={busy}
          onChange={(e) => onChange({ labelCs: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="pp-label-en">Label (EN)</label>
        <input
          id="pp-label-en"
          value={draft.labelEn}
          disabled={busy}
          onChange={(e) => onChange({ labelEn: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="pp-desc">Popis</label>
        <textarea
          id="pp-desc"
          rows={2}
          value={draft.descriptionCs}
          disabled={busy}
          onChange={(e) => onChange({ descriptionCs: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="pp-aml">ArchiMate typ</label>
        <select
          id="pp-aml"
          value={draft.archimateElementType}
          disabled={busy}
          onChange={(e) => onChange({ archimateElementType: e.target.value })}
        >
          {!elementOpts.includes(draft.archimateElementType) && (
            <option value={draft.archimateElementType}>{draft.archimateElementType}</option>
          )}
          {elementOpts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="pp-match">Match properties (JSON)</label>
        <textarea
          id="pp-match"
          rows={4}
          className="mono"
          value={draft.matchPropertiesJson}
          disabled={busy}
          onChange={(e) => onChange({ matchPropertiesJson: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="pp-fields">Pole na kartě (CSV iriLocal)</label>
        <input
          id="pp-fields"
          value={draft.fieldProperties}
          disabled={busy}
          onChange={(e) => onChange({ fieldProperties: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="pp-sort">Pořadí</label>
        <input
          id="pp-sort"
          type="number"
          value={draft.sortOrder}
          disabled={busy}
          onChange={(e) => onChange({ sortOrder: Number(e.target.value) || 0 })}
        />
      </div>

      <h4>Sloty vazeb</h4>
      {draft.slots.map((slot, i) => (
        <div key={slot.id || `new-${i}`} className="slot-editor">
          <div className="card-profiles-list-head">
            <strong>{slot.labelCs || slot.slotCode || `Slot ${i + 1}`}</strong>
            <button
              type="button"
              className="toolbar-btn danger"
              disabled={busy}
              onClick={() => onRemoveSlot(i)}
            >
              Odebrat
            </button>
          </div>
          <div className="field">
            <label>Kód slotu</label>
            <input
              value={slot.slotCode}
              disabled={busy || !!slot.id}
              onChange={(e) => onSlotChange(i, { slotCode: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Label (CS)</label>
            <input
              value={slot.labelCs}
              disabled={busy}
              onChange={(e) => onSlotChange(i, { labelCs: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Typ vztahu</label>
            <select
              value={slot.relationshipType}
              disabled={busy}
              onChange={(e) => onSlotChange(i, { relationshipType: e.target.value })}
            >
              {!relOpts.includes(slot.relationshipType) && (
                <option value={slot.relationshipType}>{slot.relationshipType}</option>
              )}
              {relOpts.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Směr</label>
            <select
              value={slot.direction}
              disabled={busy}
              onChange={(e) =>
                onSlotChange(i, { direction: e.target.value as ProfileSlotDraft["direction"] })
              }
            >
              <option value="outgoing">outgoing (→)</option>
              <option value="incoming">incoming (←)</option>
            </select>
          </div>
          <div className="field">
            <label>Cílové třídy (CSV)</label>
            <input
              value={slot.targetClasses}
              disabled={busy}
              onChange={(e) => onSlotChange(i, { targetClasses: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Cílové profily (CSV kódů)</label>
            <input
              value={slot.targetProfileCodes}
              disabled={busy}
              onChange={(e) => onSlotChange(i, { targetProfileCodes: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Důležitost</label>
            <select
              value={slot.importance}
              disabled={busy}
              onChange={(e) =>
                onSlotChange(i, {
                  importance: e.target.value as ProfileSlotDraft["importance"],
                })
              }
            >
              <option value="recommended">recommended</option>
              <option value="optional">optional</option>
            </select>
          </div>
          <div className="field">
            <label>Pořadí</label>
            <input
              type="number"
              value={slot.sortOrder}
              disabled={busy}
              onChange={(e) => onSlotChange(i, { sortOrder: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
      ))}
      <button type="button" className="toolbar-btn" disabled={busy} onClick={onAddSlot}>
        Přidat slot
      </button>

      <div className="nav-actions" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="toolbar-btn primary"
          disabled={busy || !canEdit}
          onClick={onSave}
        >
          Uložit
        </button>
        <button type="button" className="toolbar-btn" disabled={busy} onClick={onCancel}>
          Zrušit
        </button>
      </div>
    </div>
  );
}
