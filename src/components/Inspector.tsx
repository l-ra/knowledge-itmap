import { useEffect, useMemo, useState } from "react";
import { entityLabel, getSchema } from "@/kc/schema";
import type { Entity, Statement } from "@/kc/types";
import { ModelService, valueToDisplay } from "@/domain/modelService";
import { domainLabelFor, TraversalEngine } from "@/domain/traversal";
import { useApp } from "@/state/AppContext";

interface Props {
  entity: Entity | null;
  classLocal?: string;
  onUpdated: () => void;
}

export function Inspector({ entity, classLocal, onUpdated }: Props) {
  const { orgPackage, pushChangeSet } = useApp();
  const [tab, setTab] = useState<"basic" | "extended">("basic");
  const [stmts, setStmts] = useState<Statement[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [actorKind, setActorKind] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [newPropLocal, setNewPropLocal] = useState("");
  const [newPropLabel, setNewPropLabel] = useState("");
  const [newPropValue, setNewPropValue] = useState("");
  const [editPropLocal, setEditPropLocal] = useState("");
  const [editPropValue, setEditPropValue] = useState("");

  const engine = useMemo(() => new TraversalEngine(), []);
  const model = useMemo(() => new ModelService(), []);
  const schema = getSchema();

  useEffect(() => {
    if (!entity) {
      setStmts([]);
      return;
    }
    setName(entity.labels?.cs || entity.labels?.en || "");
    setDesc(entity.descriptions?.cs || entity.descriptions?.en || "");
    void (async () => {
      const s = await engine.loadAllStatements(entity.id);
      setStmts(s);
      const ak = await engine.readStringProp(entity.id, "actorKind");
      setActorKind(ak || "");
    })();
  }, [entity, engine]);

  if (!entity) {
    return (
      <aside className="inspector">
        <div className="inspector-body">
          <p className="empty">Vyberte objekt ve sloupci</p>
        </div>
      </aside>
    );
  }

  const domain = domainLabelFor(classLocal || "?", actorKind);

  async function saveBasic() {
    setBusy(true);
    try {
      const cs = await model.updateLabels(
        entity!.id,
        { en: name, cs: name },
        desc ? { en: desc, cs: desc } : undefined,
        entity!.revisionNo,
      );
      pushChangeSet(cs);
      if (classLocal === "BusinessActor" && actorKind) {
        const cs2 = await model.setStringProperty(orgPackage, entity!.id, "actorKind", actorKind);
        pushChangeSet(cs2);
      }
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  async function saveProperty() {
    if (!editPropLocal) return;
    setBusy(true);
    try {
      const cs = await model.setStringProperty(orgPackage, entity!.id, editPropLocal, editPropValue);
      pushChangeSet(cs);
      const s = await engine.loadAllStatements(entity!.id);
      setStmts(s);
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  async function createOpenWorld() {
    if (!newPropLocal || !newPropLabel) return;
    setBusy(true);
    try {
      const res = await model.addOpenWorldProperty({
        packageCode: orgPackage,
        iriLocal: newPropLocal,
        label: newPropLabel,
        subjectId: entity!.id,
        value: newPropValue,
      });
      pushChangeSet(res.changeSets[res.changeSets.length - 1] || null);
      const s = await engine.loadAllStatements(entity!.id);
      setStmts(s);
      setNewPropLocal("");
      setNewPropLabel("");
      setNewPropValue("");
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <h2>{entityLabel(entity)}</h2>
        <div className="meta" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          {domain}
          {classLocal ? ` · ${classLocal}` : ""}
        </div>
        <div className="inspector-tabs">
          <button type="button" className={tab === "basic" ? "active" : ""} onClick={() => setTab("basic")}>
            Základní
          </button>
          <button
            type="button"
            className={tab === "extended" ? "active" : ""}
            onClick={() => setTab("extended")}
          >
            Rozšířený
          </button>
        </div>
      </div>
      <div className="inspector-body">
        {tab === "basic" ? (
          <>
            <div className="field">
              <label>Název</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>Popis</label>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            {classLocal === "BusinessActor" && (
              <div className="field">
                <label>Typ (actorKind)</label>
                <select value={actorKind} onChange={(e) => setActorKind(e.target.value)}>
                  <option value="">—</option>
                  {(schema.enumValues("actorKind").length
                    ? schema.enumValues("actorKind")
                    : ["department", "person", "external"]
                  ).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Package / IRI</label>
              <div className="mono" style={{ wordBreak: "break-all" }}>
                {entity.packageCode}
                <br />
                {entity.id}
              </div>
            </div>
            <button type="button" className="toolbar-btn primary" disabled={busy} onClick={() => void saveBasic()}>
              Uložit
            </button>
          </>
        ) : (
          <>
            <h4 style={{ marginTop: 0 }}>Statements</h4>
            {stmts.map((s) => {
              const pl = schema.propertyLocal(s.property) || s.property;
              return (
                <div className="stmt-row" key={s.id}>
                  <div className="prop">{pl}</div>
                  <div>{valueToDisplay(s.value)}</div>
                  <button
                    type="button"
                    className="toolbar-btn"
                    onClick={() => {
                      setEditPropLocal(pl);
                      setEditPropValue(s.value.type === "String" ? s.value.string : valueToDisplay(s.value));
                    }}
                  >
                    Edit
                  </button>
                </div>
              );
            })}

            {editPropLocal && (
              <div className="field" style={{ marginTop: "1rem" }}>
                <label>Upravit {editPropLocal}</label>
                <input value={editPropValue} onChange={(e) => setEditPropValue(e.target.value)} />
                <button
                  type="button"
                  className="toolbar-btn primary"
                  style={{ marginTop: "0.4rem" }}
                  disabled={busy}
                  onClick={() => void saveProperty()}
                >
                  Uložit property
                </button>
              </div>
            )}

            <h4>Nová property (open-world)</h4>
            <div className="field">
              <label>iriLocal</label>
              <input
                value={newPropLocal}
                onChange={(e) => setNewPropLocal(e.target.value)}
                placeholder="contractId"
              />
            </div>
            <div className="field">
              <label>Label</label>
              <input value={newPropLabel} onChange={(e) => setNewPropLabel(e.target.value)} />
            </div>
            <div className="field">
              <label>Hodnota</label>
              <input value={newPropValue} onChange={(e) => setNewPropValue(e.target.value)} />
            </div>
            <button
              type="button"
              className="toolbar-btn primary"
              disabled={busy}
              onClick={() => void createOpenWorld()}
            >
              Vytvořit &amp; přiřadit
            </button>
            <p className="empty" style={{ textAlign: "left" }}>
              Property se vytvoří v package <code>{orgPackage}</code> (tenant-specific).
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
