import { useEffect, useId, useRef, useState } from "react";
import { entityLabel, getSchema, type SchemaResolver } from "@/kc/schema";
import type { PropertyEntity } from "@/kc/types";
import { rangeClassLocals } from "@/domain/propertyEdit";

function domainClassLocals(schema: SchemaResolver, prop: PropertyEntity): string[] {
  const domains = prop.constraints?.domainClasses ?? [];
  const out: string[] = [];
  for (const d of domains) {
    const local =
      schema.snapshot.classIriToLocal.get(d) ||
      (d.includes("/") ? d.slice(d.lastIndexOf("/") + 1) : d);
    if (local && !out.includes(local)) out.push(local);
  }
  return out;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="prop-info-row">
      <dt>{label}</dt>
      <dd>
        <button
          type="button"
          className="copyable-iri"
          title="Kliknutím zkopírovat"
          onClick={() => void copy()}
        >
          <span className="mono">{value}</span>
          <span className="copyable-iri-hint">{copied ? "Zkopírováno" : "kopírovat"}</span>
        </button>
      </dd>
    </div>
  );
}

function TextRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="prop-info-row">
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </div>
  );
}

export function PropertyInfoButton({ propertyLocal }: { propertyLocal: string }) {
  const schema = getSchema();
  const prop = schema.snapshot.propertiesByLocal.get(propertyLocal);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!prop) return null;

  const domains = domainClassLocals(schema, prop);
  const ranges = rangeClassLocals(schema, prop);
  const desc = prop.descriptions?.cs || prop.descriptions?.en;

  return (
    <div className="prop-info" ref={rootRef}>
      <button
        type="button"
        className="prop-info-btn"
        aria-label={`Informace o property ${propertyLocal}`}
        aria-expanded={open}
        aria-controls={panelId}
        title="Informace o property"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        i
      </button>
      {open && (
        <div className="prop-info-panel" id={panelId} role="dialog" aria-label={`Property ${propertyLocal}`}>
          <header className="prop-info-panel-header">
            <strong>{entityLabel(prop)}</strong>
            <button type="button" className="toolbar-btn" onClick={() => setOpen(false)}>
              Zavřít
            </button>
          </header>
          {desc && <p className="prop-info-desc">{desc}</p>}
          <dl className="prop-info-dl">
            <TextRow label="iriLocal" value={prop.iriLocal || propertyLocal} />
            <CopyRow label="IRI" value={prop.iri || ""} />
            <CopyRow label="ID" value={prop.id} />
            <TextRow label="Datatype" value={prop.datatype} />
            <TextRow label="Package" value={prop.packageCode} />
            <TextRow label="Status" value={prop.status} />
            <TextRow label="Revision" value={prop.revisionNo} />
            <TextRow
              label="Cardinality"
              value={
                prop.constraints
                  ? `min ${prop.constraints.minCount ?? 0}${
                      prop.constraints.maxCount != null ? ` · max ${prop.constraints.maxCount}` : ""
                    }`
                  : undefined
              }
            />
            <TextRow label="Domain" value={domains.length ? domains.join(", ") : undefined} />
            <TextRow label="Range" value={ranges.length ? ranges.join(", ") : undefined} />
            {prop.labels?.cs && <TextRow label="Label (cs)" value={prop.labels.cs} />}
            {prop.labels?.en && <TextRow label="Label (en)" value={prop.labels.en} />}
            <TextRow label="Vytvořeno" value={prop.createdAt} />
            <TextRow label="Upraveno" value={prop.updatedAt} />
          </dl>
        </div>
      )}
    </div>
  );
}
