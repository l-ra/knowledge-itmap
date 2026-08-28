import { useState, type ReactNode } from "react";
import type { Statement } from "@/kc/types";
import {
  canAddValue,
  canRemoveValue,
  stringFromValue,
  stringValuesEqual,
  type PropertyEditRules,
  type PropertyValueGroup,
} from "@/domain/propertyEdit";
import { valueToDisplay } from "@/domain/modelService";

interface Props {
  group: PropertyValueGroup;
  busy: boolean;
  onReplace: (statement: Statement | undefined, newValue: string) => Promise<void>;
  onRemove: (statement: Statement) => Promise<void>;
  onAdd: (value: string) => Promise<void>;
}

export function PropertyStatementEditor({ group, busy, onReplace, onRemove, onAdd }: Props) {
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [addValue, setAddValue] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { propertyLocal, statements, rules, readonly } = group;
  const count = statements.length;
  const allowRemove = !readonly && canRemoveValue(rules, count);
  const allowAdd = !readonly && rules.appliesToClass && canAddValue(rules, count);

  function startEdit(st: Statement) {
    setEditId(st.id);
    setEditValue(stringFromValue(st.value));
  }

  function cancelEdit() {
    setEditId(null);
    setEditValue("");
  }

  async function saveEdit(st: Statement) {
    if (stringValuesEqual(editValue, stringFromValue(st.value))) {
      cancelEdit();
      return;
    }
    await onReplace(st, editValue);
    cancelEdit();
  }

  async function submitAdd() {
    if (!addValue.trim()) return;
    await onAdd(addValue.trim());
    setAddValue("");
    setShowAdd(false);
  }

  return (
    <div className="prop-group">
      <div className="prop-group-header">
        <span className="prop">{propertyLocal}</span>
        <span className="prop-cardinality">
          {rules.minCount > 0 || rules.maxCount !== null
            ? `${count}${rules.maxCount !== null ? ` / ${rules.maxCount}` : ""} · min ${rules.minCount}`
            : `${count}`}
        </span>
      </div>

      {statements.map((st) => (
        <div className="stmt-row" key={st.id}>
          {editId === st.id ? (
            <>
              <div className="stmt-edit">
                {renderValueInput(rules, editValue, setEditValue)}
              </div>
              <div className="stmt-actions">
                <button
                  type="button"
                  className="toolbar-btn primary"
                  disabled={busy}
                  onClick={() => void saveEdit(st)}
                >
                  Uložit
                </button>
                <button type="button" className="toolbar-btn" disabled={busy} onClick={cancelEdit}>
                  Zrušit
                </button>
              </div>
            </>
          ) : (
            <>
              <div>{valueToDisplay(st.value)}</div>
              <div className="stmt-actions">
                {!readonly && rules.appliesToClass && (
                  <button type="button" className="toolbar-btn" disabled={busy} onClick={() => startEdit(st)}>
                    Upravit
                  </button>
                )}
                {!readonly && allowRemove && (
                  <button
                    type="button"
                    className="toolbar-btn danger"
                    disabled={busy}
                    title="Odebrat hodnotu (deprecate statement)"
                    onClick={() => void onRemove(st)}
                  >
                    Odebrat
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ))}

      {readonly && (
        <p className="empty stmt-hint">Systémová property — nelze upravovat.</p>
      )}

      {!readonly && !rules.appliesToClass && (
        <p className="empty stmt-hint">Property neplatí pro tento typ objektu.</p>
      )}

      {allowAdd && !showAdd && (
        <button
          type="button"
          className="toolbar-btn"
          style={{ marginTop: "0.35rem" }}
          disabled={busy}
          onClick={() => setShowAdd(true)}
        >
          Přidat hodnotu
        </button>
      )}

      {allowAdd && showAdd && (
        <div className="field" style={{ marginTop: "0.35rem" }}>
          {renderValueInput(rules, addValue, setAddValue)}
          <div className="stmt-actions" style={{ marginTop: "0.35rem" }}>
            <button type="button" className="toolbar-btn primary" disabled={busy} onClick={() => void submitAdd()}>
              Přidat
            </button>
            <button
              type="button"
              className="toolbar-btn"
              disabled={busy}
              onClick={() => {
                setShowAdd(false);
                setAddValue("");
              }}
            >
              Zrušit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function renderValueInput(
  rules: PropertyEditRules,
  value: string,
  onChange: (v: string) => void,
): ReactNode {
  if (rules.enumValues.length > 0) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {rules.enumValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  return <input value={value} onChange={(e) => onChange(e.target.value)} />;
}
