import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { PropertyInfoButton } from "./PropertyInfoButton";

function IconPencil() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M11.5 2.5a1.5 1.5 0 0 1 2.1 2.1L5.2 13H3v-2.2L11.5 2.5Z" strokeLinejoin="round" />
      <path d="M10 4l2 2" strokeLinecap="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4.5h10M6 4.5V3h4v1.5M5 4.5l.6 8h4.8l.6-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconX() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  variant,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`toolbar-btn icon-btn${variant === "primary" ? " primary" : ""}${variant === "danger" ? " danger" : ""}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export type EntityTargetHit = {
  id: string;
  label: string;
  classLocal?: string;
};

interface Props {
  group: PropertyValueGroup;
  busy: boolean;
  onReplace: (statement: Statement | undefined, newValue: string) => Promise<void>;
  onRemove: (statement: Statement) => Promise<void>;
  onAdd: (value: string) => Promise<void>;
  /** Search targets for EntityReference properties. */
  onSearchTargets?: (query: string) => Promise<EntityTargetHit[]>;
  /** Resolve display label for an entity id (object properties). */
  resolveLabel?: (entityId: string) => string | undefined;
  /** Compact card layout: single-value on one row; multi = name row + value list. */
  compact?: boolean;
}

export function PropertyStatementEditor({
  group,
  busy,
  onReplace,
  onRemove,
  onAdd,
  onSearchTargets,
  resolveLabel,
  compact = false,
}: Props) {
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [addValue, setAddValue] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { propertyLocal, propertyLabel, statements, rules, readonly } = group;
  const count = statements.length;
  const allowRemove = !readonly && canRemoveValue(rules, count);
  const allowAdd = !readonly && rules.appliesToClass && canAddValue(rules, count);
  const isObject = rules.datatype === "EntityReference";
  const singleValued = rules.maxCount === 1;

  function displayValue(st: Statement): string {
    const raw = stringFromValue(st.value);
    if (isObject && resolveLabel) {
      return resolveLabel(raw) || valueToDisplay(st.value);
    }
    return valueToDisplay(st.value);
  }

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

  const label = (
    <span className="prop-label-with-info">
      <span className="prop" title={propertyLocal}>
        {propertyLabel || propertyLocal}
      </span>
      <PropertyInfoButton propertyLocal={propertyLocal} />
    </span>
  );

  function valueActions(st: Statement) {
    return (
      <div className="stmt-actions">
        {!readonly && rules.appliesToClass && (
          <IconBtn label="Upravit" disabled={busy} onClick={() => startEdit(st)}>
            <IconPencil />
          </IconBtn>
        )}
        {!readonly && allowRemove && (
          <IconBtn
            label="Odebrat hodnotu (deprecate statement)"
            variant="danger"
            disabled={busy}
            onClick={() => void onRemove(st)}
          >
            <IconTrash />
          </IconBtn>
        )}
      </div>
    );
  }

  function editBlock(st: Statement) {
    return (
      <>
        <div className="stmt-edit">
          {renderValueInput(rules, editValue, setEditValue, onSearchTargets)}
        </div>
        <div className="stmt-actions">
          <IconBtn
            label="Uložit"
            variant="primary"
            disabled={busy || !editValue.trim()}
            onClick={() => void saveEdit(st)}
          >
            <IconCheck />
          </IconBtn>
          <IconBtn label="Zrušit" disabled={busy} onClick={cancelEdit}>
            <IconX />
          </IconBtn>
        </div>
      </>
    );
  }

  function addControls() {
    if (!allowAdd) return null;
    if (!showAdd) {
      return (
        <IconBtn label="Přidat hodnotu" disabled={busy} onClick={() => setShowAdd(true)}>
          <IconPlus />
        </IconBtn>
      );
    }
    return (
      <div className="field prop-add-field">
        {renderValueInput(rules, addValue, setAddValue, onSearchTargets)}
        <div className="stmt-actions">
          <IconBtn
            label="Přidat"
            variant="primary"
            disabled={busy || !addValue.trim()}
            onClick={() => void submitAdd()}
          >
            <IconPlus />
          </IconBtn>
          <IconBtn
            label="Zrušit"
            disabled={busy}
            onClick={() => {
              setShowAdd(false);
              setAddValue("");
            }}
          >
            <IconX />
          </IconBtn>
        </div>
      </div>
    );
  }

  const hints = (
    <>
      {readonly && <p className="empty stmt-hint">Systémová property — nelze upravovat.</p>}
      {!readonly && !rules.appliesToClass && (
        <p className="empty stmt-hint">Property neplatí pro tento typ objektu.</p>
      )}
    </>
  );

  if (compact) {
    if (singleValued) {
      const st = statements[0];
      return (
        <div className={`prop-group prop-group-compact prop-group-single${readonly ? " prop-group-system" : ""}`}>
          {st && editId === st.id ? (
            <div className="prop-compact-edit">
              <div className="prop-compact-label">{label}</div>
              {editBlock(st)}
            </div>
          ) : (
            <div className="prop-compact-row">
              <div className="prop-compact-label">{label}</div>
              <div className="prop-compact-value">{st ? displayValue(st) : "—"}</div>
              {st ? valueActions(st) : <span />}
            </div>
          )}
          {allowAdd ? <div className="prop-compact-add">{addControls()}</div> : null}
          {hints}
        </div>
      );
    }

    return (
      <div className={`prop-group prop-group-compact prop-group-multi${readonly ? " prop-group-system" : ""}`}>
        <div className="prop-compact-name-row">
          {label}
          <span className="prop-cardinality">{count}</span>
          {allowAdd && !showAdd ? addControls() : null}
        </div>
        {showAdd && <div className="prop-compact-add">{addControls()}</div>}
        <ul className="prop-compact-values">
          {statements.map((st) => (
            <li key={st.id} className="prop-compact-value-row">
              {editId === st.id ? (
                editBlock(st)
              ) : (
                <>
                  <div className="prop-compact-value">{displayValue(st)}</div>
                  {valueActions(st)}
                </>
              )}
            </li>
          ))}
        </ul>
        {hints}
      </div>
    );
  }

  return (
    <div className="prop-group">
      <div className="prop-group-header">
        {label}
        <span className="prop-cardinality">
          {rules.minCount > 0 || rules.maxCount !== null
            ? `${count}${rules.maxCount !== null ? ` / ${rules.maxCount}` : ""} · min ${rules.minCount}`
            : `${count}`}
        </span>
      </div>

      {statements.map((st) => (
        <div className="stmt-row" key={st.id}>
          {editId === st.id ? (
            editBlock(st)
          ) : (
            <>
              <div>{displayValue(st)}</div>
              {valueActions(st)}
            </>
          )}
        </div>
      ))}

      {hints}
      {allowAdd && <div className="prop-compact-add">{addControls()}</div>}
    </div>
  );
}

function renderValueInput(
  rules: PropertyEditRules,
  value: string,
  onChange: (v: string) => void,
  onSearchTargets?: (query: string) => Promise<EntityTargetHit[]>,
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
  if (rules.datatype === "EntityReference" && onSearchTargets) {
    return (
      <EntityTargetPicker
        value={value}
        onChange={onChange}
        onSearch={onSearchTargets}
        rangeHint={
          rules.rangeClassLocals.length
            ? `Typy: ${rules.rangeClassLocals.join(", ")}`
            : undefined
        }
      />
    );
  }
  if (rules.datatype === "Boolean") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  return <input value={value} onChange={(e) => onChange(e.target.value)} />;
}

/** Standalone value input for a property (enum / object / scalar). */
export function PropertyValueInput({
  rules,
  value,
  onChange,
  onSearchTargets,
}: {
  rules: PropertyEditRules;
  value: string;
  onChange: (v: string) => void;
  onSearchTargets?: (query: string) => Promise<EntityTargetHit[]>;
}) {
  return <>{renderValueInput(rules, value, onChange, onSearchTargets)}</>;
}

function EntityTargetPicker({
  value,
  onChange,
  onSearch,
  rangeHint,
}: {
  value: string;
  onChange: (v: string) => void;
  onSearch: (query: string) => Promise<EntityTargetHit[]>;
  rangeHint?: string;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<EntityTargetHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = ++seq.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void onSearch(query)
        .then((items) => {
          if (seq.current !== id) return;
          setHits(items);
        })
        .catch(() => {
          if (seq.current !== id) return;
          setHits([]);
        })
        .finally(() => {
          if (seq.current === id) setSearching(false);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query, open, onSearch]);

  function pick(hit: EntityTargetHit) {
    onChange(hit.id);
    setSelectedLabel(hit.label);
    setQuery(hit.label);
    setOpen(false);
  }

  return (
    <div className="entity-target-picker">
      <input
        value={open ? query : selectedLabel || value}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedLabel(null);
          if (value) onChange("");
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          if (!query && selectedLabel) setQuery(selectedLabel);
        }}
        placeholder="Hledat cílovou entitu…"
        autoComplete="off"
      />
      {rangeHint && <p className="empty stmt-hint">{rangeHint}</p>}
      {open && (
        <ul className="entity-target-suggestions">
          {searching && <li className="empty">Hledám…</li>}
          {!searching && hits.length === 0 && <li className="empty">Žádné výsledky</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => pick(h)}>
                <span>{h.label}</span>
                {h.classLocal && <span className="empty">{h.classLocal}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
