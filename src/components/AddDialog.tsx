import { useState, type FormEvent } from "react";
import type { AddActionDef } from "@/domain/templates";
import { getSchema } from "@/kc/schema";

interface Props {
  stageLabel: string;
  actions: AddActionDef[];
  onClose: () => void;
  onSubmit: (action: AddActionDef, name: string, description: string, extras: Record<string, string>) => Promise<void>;
}

export function AddDialog({ stageLabel, actions, onClose, onSubmit }: Props) {
  const [actionCode, setActionCode] = useState(actions[0]?.code || "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [flowLabel, setFlowLabel] = useState("");
  const [associationKind, setAssociationKind] = useState("reportsTo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schema = getSchema();

  const action = actions.find((a) => a.code === actionCode) || actions[0];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!action || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const extras: Record<string, string> = {};
      if (flowLabel) extras.flowLabel = flowLabel;
      if (action.derivesRelationship === "Association") {
        extras.associationKind =
          action.relationshipDefaults?.associationKind || associationKind;
      }
      if (action.derivesRelationship === "Flow" && !flowLabel) {
        throw new Error("Flow vyžaduje popis (flowLabel)");
      }
      await onSubmit(action, name.trim(), description.trim(), extras);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
          <div className="field">
            <label>Název</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label>Popis</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {action?.derivesRelationship === "Flow" && (
            <div className="field">
              <label>Co teče (flowLabel) *</label>
              <input value={flowLabel} onChange={(e) => setFlowLabel(e.target.value)} required />
            </div>
          )}
          {action?.derivesRelationship === "Association" &&
            !action.relationshipDefaults?.associationKind && (
              <div className="field">
                <label>associationKind</label>
                <select value={associationKind} onChange={(e) => setAssociationKind(e.target.value)}>
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
            <button type="submit" className="toolbar-btn primary" disabled={busy}>
              Vytvořit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
