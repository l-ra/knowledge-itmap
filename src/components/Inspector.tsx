import { useEffect, useMemo, useState } from "react";
import { entityLabel, getSchema } from "@/kc/schema";
import type { Entity, Statement } from "@/kc/types";
import { ModelService } from "@/domain/modelService";
import {
  groupStatementsByProperty,
  propertyEditRules,
  stringFromValue,
  stringValuesEqual,
} from "@/domain/propertyEdit";
import { domainLabelFor, TraversalEngine } from "@/domain/traversal";
import { useApp } from "@/state/AppContext";
import { PropertyStatementEditor } from "./PropertyStatementEditor";

interface Props {
  entity: Entity | null;
  classLocal?: string;
  onUpdated: () => void;
}

export function Inspector({ entity, classLocal, onUpdated }: Props) {
  const { orgPackage, orgPackageLabel, packageDisplayName, pushChangeSet } = useApp();
  const [tab, setTab] = useState<"basic" | "extended">("basic");
  const [stmts, setStmts] = useState<Statement[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [actorKind, setActorKind] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [originalDesc, setOriginalDesc] = useState("");
  const [originalActorKind, setOriginalActorKind] = useState("");
  const [actorKindStmt, setActorKindStmt] = useState<Statement | undefined>();
  const [busy, setBusy] = useState(false);
  const [newPropLocal, setNewPropLocal] = useState("");
  const [newPropLabel, setNewPropLabel] = useState("");
  const [newPropValue, setNewPropValue] = useState("");

  const engine = useMemo(() => new TraversalEngine(), []);
  const model = useMemo(() => new ModelService(), []);
  const schema = getSchema();

  async function reloadStatements(entityId: string) {
    const s = await engine.loadAllStatements(entityId);
    setStmts(s);
    if (classLocal === "BusinessActor") {
      const akStmts = await engine.loadPropertyStatements(entityId, "actorKind");
      const ak = akStmts[0];
      setActorKindStmt(ak);
      const val = ak ? stringFromValue(ak.value) : "";
      setActorKind(val);
      setOriginalActorKind(val);
    }
  }

  useEffect(() => {
    if (!entity) {
      setStmts([]);
      return;
    }
    const initialName = entity.labels?.cs || entity.labels?.en || "";
    const initialDesc = entity.descriptions?.cs || entity.descriptions?.en || "";
    setName(initialName);
    setDesc(initialDesc);
    setOriginalName(initialName);
    setOriginalDesc(initialDesc);
    void reloadStatements(entity.id);
  }, [entity, engine, classLocal]);

  const propertyGroups = useMemo(
    () => groupStatementsByProperty(schema, stmts, classLocal),
    [schema, stmts, classLocal],
  );

  const actorKindRules = useMemo(
    () => (classLocal === "BusinessActor" ? propertyEditRules(schema, "actorKind", classLocal) : null),
    [schema, classLocal],
  );

  const actorKindInvalid =
    classLocal === "BusinessActor" &&
    actorKindRules !== null &&
    actorKindRules.minCount >= 1 &&
    !actorKind.trim();

  const hasBasicChanges = useMemo(() => {
    const nameChanged = !stringValuesEqual(name, originalName);
    const descChanged = !stringValuesEqual(desc, originalDesc);
    const actorKindChanged =
      classLocal === "BusinessActor" && !stringValuesEqual(actorKind, originalActorKind);
    return nameChanged || descChanged || actorKindChanged;
  }, [name, originalName, desc, originalDesc, actorKind, originalActorKind, classLocal]);

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
    if (!hasBasicChanges) return;
    setBusy(true);
    try {
      const nameChanged = !stringValuesEqual(name, originalName);
      const descChanged = !stringValuesEqual(desc, originalDesc);
      const actorKindChanged =
        classLocal === "BusinessActor" && !stringValuesEqual(actorKind, originalActorKind);

      let actorKindPatch: { newValue?: string; existingStatement?: Statement; remove?: boolean } | undefined;
      if (actorKindChanged) {
        if (actorKind) {
          actorKindPatch = { newValue: actorKind, existingStatement: actorKindStmt };
        } else if (actorKindStmt) {
          actorKindPatch = { remove: true, existingStatement: actorKindStmt };
        }
      }

      const cs = await model.saveEntityBasics({
        id: entity!.id,
        labels: nameChanged ? { en: name, cs: name } : undefined,
        descriptions: descChanged ? (desc ? { en: desc, cs: desc } : {}) : undefined,
        revision: entity!.revisionNo,
        packageCode: orgPackage,
        actorKind: actorKindPatch,
      });
      if (cs) {
        pushChangeSet(cs);
        setOriginalName(name);
        setOriginalDesc(desc);
        if (actorKindChanged) setOriginalActorKind(actorKind);
        await reloadStatements(entity!.id);
        onUpdated();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleReplace(propertyLocal: string, statement: Statement | undefined, newValue: string) {
    setBusy(true);
    try {
      const cs = await model.replaceStringProperty({
        packageCode: orgPackage,
        subject: entity!.id,
        propertyLocal,
        newValue,
        existingStatement: statement,
      });
      if (cs) {
        pushChangeSet(cs);
        await reloadStatements(entity!.id);
        onUpdated();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(statement: Statement) {
    if (!window.confirm("Odebrat tuto hodnotu? Statement bude deprecated.")) return;
    setBusy(true);
    try {
      const cs = await model.deprecatePropertyStatement(statement);
      pushChangeSet(cs);
      await reloadStatements(entity!.id);
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(propertyLocal: string, value: string) {
    setBusy(true);
    try {
      const cs = await model.addStringPropertyValue({
        packageCode: orgPackage,
        subject: entity!.id,
        propertyLocal,
        value,
      });
      pushChangeSet(cs);
      await reloadStatements(entity!.id);
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
      pushChangeSet(res.changeSet);
      await reloadStatements(entity!.id);
      setNewPropLocal("");
      setNewPropLabel("");
      setNewPropValue("");
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  const actorKindEnum =
    actorKindRules?.enumValues.length
      ? actorKindRules.enumValues
      : ["department", "person", "external"];

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
                  {!(actorKindRules && actorKindRules.minCount >= 1) && <option value="">—</option>}
                  {actorKindEnum.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                {actorKindRules && actorKindRules.minCount >= 1 && !actorKind && (
                  <p className="empty stmt-hint">Povinná hodnota (min {actorKindRules.minCount}).</p>
                )}
              </div>
            )}
            <div className="field">
              <label>Package / IRI</label>
              <div style={{ wordBreak: "break-all" }}>
                {entity.packageCode ? packageDisplayName(entity.packageCode) : "—"}
                {entity.packageCode && (
                  <div className="mono empty">{entity.packageCode}</div>
                )}
                <div className="mono">{entity.id}</div>
              </div>
            </div>
            <button
              type="button"
              className="toolbar-btn primary"
              disabled={busy || !hasBasicChanges || actorKindInvalid}
              onClick={() => void saveBasic()}
            >
              Uložit
            </button>
          </>
        ) : (
          <>
            <h4 style={{ marginTop: 0 }}>Statements</h4>
            {propertyGroups.map((group) => (
              <PropertyStatementEditor
                key={group.propertyLocal}
                group={group}
                busy={busy}
                onReplace={(st, val) => handleReplace(group.propertyLocal, st, val)}
                onRemove={handleRemove}
                onAdd={(val) => handleAdd(group.propertyLocal, val)}
              />
            ))}

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
              Property se vytvoří v package <code>{orgPackageLabel}</code> (
              <code>{orgPackage}</code>, tenant-specific).
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
