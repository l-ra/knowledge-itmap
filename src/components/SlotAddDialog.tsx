import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  DescriptionEditor,
  descriptionsDraftFrom,
  normalizeLangMap,
} from "./DescriptionEditor";
import { getSchema } from "@/kc/schema";
import type { AllowedEdgeOption, RelationSlotDef, SlotDirection } from "@/domain/cards";

export type SlotAddCandidate = {
  id: string;
  label: string;
  classLocal: string;
};

export type SlotAddSubmit =
  | {
      mode: "link";
      neighborId: string;
      createClassLocal?: string;
      relExtras: Record<string, string>;
      edge?: AllowedEdgeOption;
    }
  | {
      mode: "create";
      name: string;
      descriptions: Record<string, string>;
      createClassLocal: string;
      relExtras: Record<string, string>;
      edge?: AllowedEdgeOption;
    };

type SlotModeProps = {
  kind: "slot";
  slot: RelationSlotDef;
  allowedEdges?: undefined;
};

type ExpertModeProps = {
  kind: "expert";
  slot?: undefined;
  allowedEdges: AllowedEdgeOption[];
};

type Props = (SlotModeProps | ExpertModeProps) & {
  subjectLabel: string;
  subjectClassLocal: string;
  linkedEntityIds: string[];
  /** Optional create-class choices when slot has multiple targetClasses. */
  createClassOptions?: string[];
  onSearch: (query: string, classLocals: string[]) => Promise<SlotAddCandidate[]>;
  onSubmit: (payload: SlotAddSubmit) => Promise<void>;
  onClose: () => void;
};

function classOptionsFor(
  kind: "slot" | "expert",
  slot: RelationSlotDef | undefined,
  edge: AllowedEdgeOption | null,
  createClassOptions?: string[],
): string[] {
  if (kind === "expert") {
    return edge ? [edge.otherClassLocal] : [];
  }
  if (createClassOptions?.length) return createClassOptions;
  return slot?.targetClasses?.length ? slot.targetClasses : [];
}

export function SlotAddDialog(props: Props) {
  const {
    kind,
    subjectLabel,
    linkedEntityIds,
    createClassOptions,
    onSearch,
    onSubmit,
    onClose,
  } = props;
  const slot = kind === "slot" ? props.slot : undefined;
  const allowedEdges = kind === "expert" ? props.allowedEdges : [];

  const schema = getSchema();
  const linkedSet = useMemo(() => new Set(linkedEntityIds), [linkedEntityIds]);

  const [edgeKey, setEdgeKey] = useState(() =>
    allowedEdges[0]
      ? `${allowedEdges[0].direction}:${allowedEdges[0].typeLocal}:${allowedEdges[0].otherClassLocal}`
      : "",
  );
  const [edgeFilter, setEdgeFilter] = useState("");
  const selectedEdge = useMemo(() => {
    if (kind !== "expert") return null;
    return (
      allowedEdges.find(
        (e) => `${e.direction}:${e.typeLocal}:${e.otherClassLocal}` === edgeKey,
      ) || allowedEdges[0] || null
    );
  }, [kind, allowedEdges, edgeKey]);

  const relationshipType =
    kind === "slot" ? slot!.relationshipType : selectedEdge?.typeLocal || "";
  const direction: SlotDirection =
    kind === "slot" ? slot!.direction : selectedEdge?.direction || "outgoing";
  const relationshipDefaults = kind === "slot" ? slot?.relationshipDefaults : undefined;

  const classes = classOptionsFor(kind, slot, selectedEdge, createClassOptions);
  const [createClassLocal, setCreateClassLocal] = useState(classes[0] || "");

  useEffect(() => {
    const next = classOptionsFor(kind, slot, selectedEdge, createClassOptions);
    setCreateClassLocal((prev) => (next.includes(prev) ? prev : next[0] || ""));
  }, [kind, slot, selectedEdge, createClassOptions]);

  const [query, setQuery] = useState("");
  const [descriptions, setDescriptions] = useState<Record<string, string>>(() =>
    descriptionsDraftFrom(),
  );
  const [flowLabel, setFlowLabel] = useState("");
  const [associationKind, setAssociationKind] = useState(
    relationshipDefaults?.associationKind || "reportsTo",
  );
  const [suggestions, setSuggestions] = useState<SlotAddCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [openSuggestions, setOpenSuggestions] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [selected, setSelected] = useState<SlotAddCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  const needsFlowLabel = relationshipType === "Flow";
  const needsAssociationKind =
    relationshipType === "Association" && !relationshipDefaults?.associationKind;
  const canLink = Boolean(relationshipType) && (kind === "slot" || Boolean(selectedEdge));
  const showCreateFields = createMode || !canLink;
  const showRelFields = showCreateFields || (selected && !createMode);

  const filteredEdges = useMemo(() => {
    const needle = edgeFilter.trim().toLocaleLowerCase("cs");
    if (!needle) return allowedEdges;
    return allowedEdges.filter((e) => {
      const hay = `${e.label} ${e.typeLocal} ${e.otherClassLocal} ${e.direction}`.toLocaleLowerCase(
        "cs",
      );
      return hay.includes(needle);
    });
  }, [allowedEdges, edgeFilter]);

  const outgoingEdges = filteredEdges.filter((e) => e.direction === "outgoing");
  const incomingEdges = filteredEdges.filter((e) => e.direction === "incoming");

  useEffect(() => {
    setSelected(null);
    setCreateMode(false);
    setQuery("");
    setSuggestions([]);
  }, [edgeKey, kind]);

  useEffect(() => {
    if (!canLink || !openSuggestions) return;
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      const searchClasses =
        classes.length > 0 ? classes : createClassLocal ? [createClassLocal] : [];
      void onSearch(query, searchClasses)
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
  }, [canLink, openSuggestions, query, onSearch, classes, createClassLocal]);

  function pickExisting(item: SlotAddCandidate) {
    if (linkedSet.has(item.id)) return;
    setSelected(item);
    setQuery(item.label);
    setCreateMode(false);
    setOpenSuggestions(false);
  }

  function pickCreateNew() {
    setSelected(null);
    setCreateMode(true);
    setOpenSuggestions(false);
  }

  function buildExtras(): Record<string, string> {
    const extras: Record<string, string> = { ...(relationshipDefaults || {}) };
    if (flowLabel.trim()) extras.flowLabel = flowLabel.trim();
    if (relationshipType === "Association") {
      extras.associationKind =
        relationshipDefaults?.associationKind || associationKind;
    }
    return extras;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (kind === "expert" && !selectedEdge) {
      setError("Vyberte typ vazby z matice.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const extras = buildExtras();
      if (needsFlowLabel && !flowLabel.trim()) {
        throw new Error("Flow vyžaduje popis (flowLabel)");
      }
      if (selected && !createMode) {
        if (linkedSet.has(selected.id)) {
          throw new Error("Entita je v této vazbě už napojená.");
        }
        await onSubmit({
          mode: "link",
          neighborId: selected.id,
          createClassLocal: createClassLocal || undefined,
          relExtras: extras,
          edge: selectedEdge || undefined,
        });
        onClose();
        return;
      }

      const name = query.trim();
      if (!name) throw new Error("Zadejte název nové entity.");
      const cls = createClassLocal || classes[0];
      if (!cls) throw new Error("Vyberte třídu nové entity.");
      await onSubmit({
        mode: "create",
        name,
        descriptions: normalizeLangMap(descriptions),
        createClassLocal: cls,
        relExtras: extras,
        edge: selectedEdge || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const title =
    kind === "slot"
      ? `Přidat — ${slot!.labelCs}`
      : "Přidat vazbu (expert)";
  const submitLabel = selected && !createMode ? "Připojit" : "Vytvořit";
  const submitDisabled =
    busy ||
    (kind === "expert" && !selectedEdge) ||
    (selected && !createMode
      ? linkedSet.has(selected.id) || (needsFlowLabel && !flowLabel.trim())
      : !query.trim() ||
        !createClassLocal ||
        (needsFlowLabel && !flowLabel.trim()));

  function renderEdgeGroup(label: string, edges: AllowedEdgeOption[]) {
    if (edges.length === 0) return null;
    return (
      <optgroup label={label}>
        {edges.map((e) => {
          const key = `${e.direction}:${e.typeLocal}:${e.otherClassLocal}`;
          return (
            <option key={key} value={key}>
              {e.typeLocal} · {e.otherClassLocal}
            </option>
          );
        })}
      </optgroup>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal slot-add-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="add-dialog-context">
          Připojí k: <strong>{subjectLabel}</strong>
          {relationshipType && (
            <>
              {" "}
              · {relationshipType} ({direction === "outgoing" ? "odchozí" : "příchozí"})
            </>
          )}
        </p>
        <form onSubmit={(e) => void handleSubmit(e)}>
          {kind === "expert" && (
            <>
              <div className="field">
                <label>Filtrovat typy vazeb</label>
                <input
                  value={edgeFilter}
                  onChange={(e) => setEdgeFilter(e.target.value)}
                  placeholder="Serving, BusinessProcess…"
                />
              </div>
              <div className="field">
                <label>Typ vazby (AllowedRelationship)</label>
                <select
                  value={
                    selectedEdge
                      ? `${selectedEdge.direction}:${selectedEdge.typeLocal}:${selectedEdge.otherClassLocal}`
                      : ""
                  }
                  onChange={(e) => setEdgeKey(e.target.value)}
                  size={Math.min(10, Math.max(4, filteredEdges.length || 4))}
                  className="slot-add-edge-select"
                >
                  {renderEdgeGroup("Odchozí", outgoingEdges)}
                  {renderEdgeGroup("Příchozí", incomingEdges)}
                </select>
                {filteredEdges.length === 0 && (
                  <p className="empty" style={{ textAlign: "left" }}>
                    Žádný typ neodpovídá filtru.
                  </p>
                )}
              </div>
            </>
          )}

          {classes.length > 1 && (
            <div className="field">
              <label>Třída cíle</label>
              <select
                value={createClassLocal}
                onChange={(e) => setCreateClassLocal(e.target.value)}
              >
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {schema.classLabel(c)}
                  </option>
                ))}
              </select>
            </div>
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
                autoFocus={kind === "slot"}
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
                    const linked = linkedSet.has(item.id);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`add-dialog-suggestion ${linked ? "disabled" : ""}`}
                          disabled={linked}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickExisting(item)}
                        >
                          <span className="name">{item.label}</span>
                          <span className="meta">{item.classLocal}</span>
                          {linked && <span className="badge">napojeno</span>}
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
              Připojíte existující: <strong>{selected.label}</strong>
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
            <DescriptionEditor
              value={descriptions}
              onChange={setDescriptions}
              disabled={busy}
              idPrefix="slot-add-desc"
            />
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
                  : [
                      "reportsTo",
                      "deputizesFor",
                      "locatedIn",
                      "connectedTo",
                      "memberOf",
                      "other",
                    ]
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
