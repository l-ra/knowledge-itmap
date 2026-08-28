import { useCallback, useEffect, useMemo, useState } from "react";
import { getKc } from "@/kc/client";
import { entityLabel } from "@/kc/schema";
import type { Entity } from "@/kc/types";
import { ModelService } from "@/domain/modelService";
import {
  getTemplate,
  TEMPLATES,
  type AddActionDef,
  type TraversalTemplate,
} from "@/domain/templates";
import {
  type ColumnItem,
  type ColumnState,
  type FocusStep,
  TraversalEngine,
} from "@/domain/traversal";
import { useApp } from "@/state/AppContext";
import { AddDialog } from "@/components/AddDialog";
import { Inspector } from "@/components/Inspector";

export function BrowserPage() {
  const { ready, error, orgPackage, orgPackageLabel, pushChangeSet, graphEpoch } = useApp();
  const [templateCode, setTemplateCode] = useState("business-exploration");
  const [columns, setColumns] = useState<ColumnState[]>([]);
  const [focus, setFocus] = useState<FocusStep[]>([]);
  const [selected, setSelected] = useState<{ entity: Entity; classLocal: string } | null>(null);
  const [addStage, setAddStage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const engine = useMemo(() => new TraversalEngine(), []);
  const model = useMemo(() => new ModelService(), []);
  const template: TraversalTemplate = getTemplate(templateCode);

  const refreshRoot = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const root = await engine.loadRootColumn(orgPackage, templateCode);
      setColumns([root]);
      setFocus([]);
      setSelected(null);
    } catch (e) {
      setColumns([
        {
          stage: template.stages[0],
          items: [],
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [ready, orgPackage, templateCode, engine, template.stages]);

  useEffect(() => {
    void refreshRoot();
  }, [refreshRoot, graphEpoch]);

  async function selectItem(colIndex: number, item: ColumnItem) {
    const step: FocusStep = {
      entityId: item.entity.id,
      label: entityLabel(item.entity),
      stageCode: columns[colIndex].stage.code,
      classLocal: item.classLocal,
    };
    const newFocus = [...focus.slice(0, colIndex), step];
    setFocus(newFocus);
    setSelected({ entity: item.entity, classLocal: item.classLocal });

    setLoading(true);
    try {
      const next = await engine.loadNextColumn(
        orgPackage,
        template,
        item.entity,
        item.classLocal,
        columns[colIndex].stage.code,
      );
      const kept = columns.slice(0, colIndex + 1);
      // update selection highlight data is via focus
      if (next) setColumns([...kept, next]);
      else setColumns(kept);
    } finally {
      setLoading(false);
    }
  }

  function jumpFocus(index: number) {
    const truncated = focus.slice(0, index + 1);
    setFocus(truncated);
    void (async () => {
      setLoading(true);
      try {
        const cols = await engine.expandPath(orgPackage, templateCode, truncated);
        setColumns(cols);
        const last = truncated[truncated.length - 1];
        if (last) {
          const ent = await getKc().getEntity(last.entityId);
          setSelected({ entity: ent, classLocal: last.classLocal });
        }
      } finally {
        setLoading(false);
      }
    })();
  }

  async function handleAdd(action: AddActionDef, name: string, description: string, extras: Record<string, string>) {
    const stageCode = addStage;
    if (!stageCode) return;
    const selectedId =
      focus.length > 0 ? focus[focus.length - 1]?.entityId : undefined;

    // For root organization add, no parent needed
    const needsParent = action.derivesRelationship && stageCode !== "organization";
    if (needsParent && !selectedId && stageCode !== template.stages[0].code) {
      // allow creating roots in first column without parent
    }

    const result = await model.createElement({
      packageCode: orgPackage,
      name,
      description,
      action,
      selectedId,
      extraProps: extras,
      flowLabel: extras.flowLabel,
    });

    pushChangeSet(result.changeSet);

    if (focus.length === 0) {
      await refreshRoot();
    } else {
      jumpFocus(focus.length - 1);
    }
  }

  const addActions = addStage
    ? template.addActions.filter((a) => a.stage === addStage)
    : [];

  return (
    <div className="browse-page">
      {(error || !ready) && (
        <div className={`status-banner ${error ? "error" : ""}`}>
          {error
            ? `Knowledge Core nedostupné: ${error}. Spusťte KC (viz README) a zkontrolujte Settings.`
            : "Načítám schema archimate-lite…"}
        </div>
      )}

      <div className="focus-path">
        <span className="focus-path-inner">
          <span>Focus:</span>
          <button type="button" onClick={() => void refreshRoot()} title={orgPackage}>
            {orgPackageLabel}
          </button>
          {focus.map((f, i) => (
            <span key={f.entityId}>
              <span className="sep">›</span>
              <button type="button" onClick={() => jumpFocus(i)}>
                {f.label}
              </button>
            </span>
          ))}
          {loading && <span className="loading-dot">…</span>}
        </span>
      </div>

      <div className="main-split">
        <div className="columns">
          {columns.map((col, colIndex) => (
            <div className="column" key={`${col.stage.code}-${colIndex}`}>
              <div className="column-header">
                <span>{col.stage.labelCs}</span>
                <span className="count">{col.items.length}</span>
              </div>
              <div className="column-body">
                {col.error && <div className="empty">{col.error}</div>}
                {!col.error && col.items.length === 0 && (
                  <div className="empty">Žádné objekty</div>
                )}
                {col.items.map((item) => {
                  const isSelected = focus[colIndex]?.entityId === item.entity.id;
                  return (
                    <button
                      type="button"
                      key={item.entity.id}
                      className={`column-item ${isSelected ? "selected" : ""}`}
                      onClick={() => void selectItem(colIndex, item)}
                    >
                      <span className="name">{entityLabel(item.entity)}</span>
                      <span className="meta">{item.domainLabel}</span>
                      {item.edgeLabelCs && <span className="edge">{item.edgeLabelCs}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="column-footer">
                <button
                  type="button"
                  className="toolbar-btn"
                  style={{ width: "100%" }}
                  disabled={!ready || template.addActions.filter((a) => a.stage === col.stage.code).length === 0}
                  onClick={() => setAddStage(col.stage.code)}
                >
                  + Přidat
                </button>
              </div>
            </div>
          ))}
        </div>
        <Inspector
          entity={selected?.entity || null}
          classLocal={selected?.classLocal}
          onUpdated={() => {
            if (focus.length) jumpFocus(focus.length - 1);
            else void refreshRoot();
          }}
        />
      </div>

      <div className="traversal-bar">
        <label>
          Traversal{" "}
          <select value={templateCode} onChange={(e) => setTemplateCode(e.target.value)}>
            {TEMPLATES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.labelCs}
              </option>
            ))}
          </select>
        </label>
      </div>

      {addStage && addActions.length > 0 && (
        <AddDialog
          stageLabel={template.stages.find((s) => s.code === addStage)?.labelCs || addStage}
          actions={addActions}
          onClose={() => setAddStage(null)}
          onSubmit={handleAdd}
        />
      )}
    </div>
  );
}
