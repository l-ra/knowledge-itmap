import { useEffect, useRef, useState, type FormEvent } from "react";
import { entityLabel } from "@/kc/schema";
import type { AddActionDef } from "@/domain/templates";
import type { ColumnItem } from "@/domain/traversal";
import { getSchema } from "@/kc/schema";

export type AddDialogSubmit =
  | {
      mode: "create";
      action: AddActionDef;
      name: string;
      description: string;
      extras: Record<string, string>;
    }
  | {
      mode: "link";
      action: AddActionDef;
      entityId: string;
      extras: Record<string, string>;
    };

interface Props {
  stageLabel: string;
  actions: AddActionDef[];
  contextLabel?: string;
  linkedEntityIds: string[];
  onSearch: (action: AddActionDef, query: string) => Promise<ColumnItem[]>;
  onClose: () => void;
  onSubmit: (payload: AddDialogSubmit) => Promise<void>;
}

export function AddDialog({
  stageLabel,
  actions,
  contextLabel,
  linkedEntityIds,
  onSearch,
  onClose,
  onSubmit,
}: Props) {
  const [actionCode, setActionCode] = useState(actions[0]?.code || "");
  const [query, setQuery] = useState("");
  const [description, setDescription] = useState("");
  const [flowLabel, setFlowLabel] = useState("");
  const [associationKind, setAssociationKind] = useState("reportsTo");
  const [suggestions, setSuggestions] = useState<ColumnItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [openSuggestions, setOpenSuggestions] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [selected, setSelected] = useState<ColumnItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);
  const schema = getSchema();

  const action = actions.find((a) => a.code === actionCode) || actions[0];
  const linkedSet = new Set(linkedEntityIds);
  const canLink = Boolean(action?.derivesRelationship && contextLabel);
  const showCreateFields = createMode || !canLink;
  const needsFlowLabel = action?.derivesRelationship === "Flow";
  const needsAssociationKind =
    action?.derivesRelationship === "Association" &&
    !action.relationshipDefaults?.associationKind;
  const showRelFields = showCreateFields || (selected && !createMode);

  useEffect(() => {
    if (!action) return;
    setSelected(null);
    setCreateMode(false);
    setQuery("");
    setSuggestions([]);
  }, [actionCode, action]);

  useEffect(() => {
    if (!action || !openSuggestions) return;

    const seq = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void onSearch(action, query)
        .then((items) => {
          if (searchSeq.current !== seq) return;
          setSuggestions(items);
        })
        .catch(() => {
          if (searchSeq.current !== seq) return;
          setSuggestions([]);
        })
        .finally(() => {
          if (searchSeq.current === seq) setSearching(false);
        });
    }, 200);

    return () => window.clearTimeout(timer);
  }, [action, query, openSuggestions, onSearch]);

  function pickExisting(item: ColumnItem) {
    if (linkedSet.has(item.entity.id)) return;
    setSelected(item);
    setQuery(entityLabel(item.entity));
    setCreateMode(false);
    setOpenSuggestions(false);
  }

  function pickCreateNew() {
    setSelected(null);
    setCreateMode(true);
    setOpenSuggestions(false);
  }

  function buildExtras(): Record<string, string> {
    const extras: Record<string, string> = {};
    if (flowLabel) extras.flowLabel = flowLabel;
    if (action?.derivesRelationship === "Association") {
      extras.associationKind =
        action.relationshipDefaults?.associationKind || associationKind;
    }
    return extras;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!action) return;

    setBusy(true);
    setError(null);
    try {
      const extras = buildExtras();
      if (action.derivesRelationship === "Flow" && !flowLabel.trim()) {
        throw new Error("Flow vyžaduje popis (flowLabel)");
      }

      if (selected && !createMode) {
        if (linkedSet.has(selected.entity.id)) {
          throw new Error("Entita je už ve sloupci.");
        }
        await onSubmit({ mode: "link", action, entityId: selected.entity.id, extras });
        onClose();
        return;
      }

      const name = query.trim();
      if (!name) return;
      await onSubmit({
        mode: "create",
        action,
        name,
        description: description.trim(),
        extras,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = selected && !createMode ? "Připojit" : "Vytvořit";
  const submitDisabled =
    busy ||
    (selected && !createMode
      ? linkedSet.has(selected.entity.id) ||
        (needsFlowLabel && !flowLabel.trim())
      : !query.trim() || (needsFlowLabel && !flowLabel.trim()));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Přidat — {stageLabel}</h3>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="field">
            <label>Co chcete přidat?</label>
            <select value={actionCode} onChange={(e) => setActionCode(e.target.value)}>
              {actions.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.labelCs}
                </option>
              ))}
            </select>
          </div>

          {contextLabel && action?.derivesRelationship && (
            <p className="add-dialog-context">
              Připojí k: <strong>{contextLabel}</strong>
            </p>
          )}

          <div className="field">
            <label>Název / hledat</label>
            <div className="add-dialog-search">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null);
                  setCreateMode(false);
                  setOpenSuggestions(true);
                }}
                onFocus={() => setOpenSuggestions(true)}
                onBlur={() => window.setTimeout(() => setOpenSuggestions(false), 150)}
                required={createMode || !canLink}
                autoFocus
                placeholder="Zadejte název nebo vyhledejte existující…"
              />
              {openSuggestions && canLink && (
                <ul className="add-dialog-suggestions" role="listbox">
                  {searching && suggestions.length === 0 && (
                    <li className="add-dialog-suggestion muted">Hledám…</li>
                  )}
                  {!searching && suggestions.length === 0 && query.trim() && (
                    <li className="add-dialog-suggestion muted">Žádná shoda</li>
                  )}
                  {suggestions.map((item) => {
                    const inColumn = linkedSet.has(item.entity.id);
                    return (
                      <li key={item.entity.id}>
                        <button
                          type="button"
                          className={`add-dialog-suggestion ${inColumn ? "disabled" : ""}`}
                          disabled={inColumn}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickExisting(item)}
                        >
                          <span className="name">{entityLabel(item.entity)}</span>
                          <span className="meta">{item.domainLabel}</span>
                          {inColumn && <span className="badge">ve sloupci</span>}
                        </button>
                      </li>
                    );
                  })}
                  {query.trim() && (
                    <li>
                      <button
                        type="button"
                        className="add-dialog-suggestion create-new"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickCreateNew()}
                      >
                        Vytvořit nový: „{query.trim()}“
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>

          {selected && !createMode && (
            <p className="add-dialog-hint">
              Připojíte existující: <strong>{entityLabel(selected.entity)}</strong>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setSelected(null);
                  setCreateMode(true);
                }}
              >
                Vytvořit nový místo toho
              </button>
            </p>
          )}

          {showCreateFields && (
            <div className="field">
              <label>Popis</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          )}
          {showRelFields && needsFlowLabel && (
            <div className="field">
              <label>Co teče (flowLabel) *</label>
              <input
                value={flowLabel}
                onChange={(e) => setFlowLabel(e.target.value)}
                required
              />
            </div>
          )}
          {showRelFields && needsAssociationKind && (
            <div className="field">
              <label>associationKind</label>
              <select
                value={associationKind}
                onChange={(e) => setAssociationKind(e.target.value)}
              >
                {(schema.enumValues("associationKind").length
                  ? schema.enumValues("associationKind")
                  : ["reportsTo", "deputizesFor", "locatedIn", "connectedTo", "memberOf", "other"]
                ).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="toolbar-btn" onClick={onClose}>
              Zrušit
            </button>
            <button type="submit" className="toolbar-btn primary" disabled={submitDisabled}>
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
