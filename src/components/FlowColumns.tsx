import { entityLabel } from "@/kc/schema";
import type { AddActionDef, TraversalTemplate } from "@/domain/templates";
import type { ColumnItem, ColumnState } from "@/domain/traversal";
import type { NavigationFlow } from "@/domain/navigationFlows";
import { EntityInfoButton } from "./EntityInfoButton";

interface Props {
  flow: NavigationFlow;
  template: TraversalTemplate;
  ready: boolean;
  onSelectItem: (colIndex: number, item: ColumnItem) => void;
  onSpawnFromColumn: (colIndex: number) => void;
  onAddStage: (colIndex: number, stageCode: string) => void;
  onInspect: (entityId: string, classLocal: string) => void;
}

export function FlowColumns({
  flow,
  template,
  ready,
  onSelectItem,
  onSpawnFromColumn,
  onAddStage,
  onInspect,
}: Props) {
  return (
    <div className="flow-columns columns">
      {flow.columns.map((col: ColumnState, colIndex: number) => (
        <div className="column" key={`${col.stage.code}-${colIndex}`}>
          <div className="column-header">
            <span>{col.stage.labelCs}</span>
            <span className="column-header-actions">
              <button
                type="button"
                className="spawn-col-btn"
                title="Nový tok od tohoto sloupce"
                onClick={() => onSpawnFromColumn(colIndex)}
              >
                ↗
              </button>
              <span className="count">{col.items.length}</span>
            </span>
          </div>
          <div className="column-body">
            {col.error && <div className="empty">{col.error}</div>}
            {!col.error && col.items.length === 0 && (
              <div className="empty">Žádné objekty</div>
            )}
            {col.items.map((item) => {
              const isSelected = flow.focus[colIndex]?.entityId === item.entity.id;
              return (
                <div
                  key={item.entity.id}
                  className={`column-item-row ${isSelected ? "selected" : ""}`}
                >
                  <button
                    type="button"
                    className={`column-item ${isSelected ? "selected" : ""}`}
                    onClick={() => onSelectItem(colIndex, item)}
                  >
                    <span className="name">{entityLabel(item.entity)}</span>
                    <span className="meta">{item.domainLabel}</span>
                    {item.edgeLabelCs && <span className="edge">{item.edgeLabelCs}</span>}
                  </button>
                  <EntityInfoButton
                    onClick={() => onInspect(item.entity.id, item.classLocal)}
                  />
                </div>
              );
            })}
          </div>
          <div className="column-footer">
            <button
              type="button"
              className="toolbar-btn"
              style={{ width: "100%" }}
              disabled={
                !ready ||
                template.addActions.filter((a: AddActionDef) => a.stage === col.stage.code)
                  .length === 0
              }
              onClick={() => onAddStage(colIndex, col.stage.code)}
            >
              + Přidat
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
