import type { TraversalTemplate } from "@/domain/templates";
import type { ColumnItem, SkipTarget } from "@/domain/traversal";
import type { FocusStep } from "@/domain/traversal";
import { flowDisplayLabel, type NavigationFlow } from "@/domain/navigationFlows";
import { EntityInfoButton } from "./EntityInfoButton";
import { FlowColumns } from "./FlowColumns";

interface Props {
  flow: NavigationFlow;
  template: TraversalTemplate;
  isActive: boolean;
  orgPackageLabel: string;
  templateOptions: TraversalTemplate[];
  ready: boolean;
  loading: boolean;
  skipOptions: Map<number, SkipTarget>;
  onActivate: () => void;
  onClose: () => void;
  onPromote: () => void;
  onToggleCollapse: () => void;
  onTemplateChange: (code: string) => void;
  onJumpFocus: (index: number) => void;
  onSpawnFromStep: (index: number) => void;
  onSpawnFromColumn: (colIndex: number) => void;
  onRefreshRoot: () => void;
  onInspectEntity: (entityId: string, classLocal: string) => void;
  onSelectItem: (colIndex: number, item: ColumnItem) => void;
  onAddStage: (colIndex: number, stageCode: string) => void;
  onSkipColumn: (colIndex: number) => void;
  onRestoreHiddenStage: (stageCode: string) => void;
}

export function FlowBar({
  flow,
  template,
  isActive,
  orgPackageLabel,
  templateOptions,
  ready,
  loading,
  skipOptions,
  onActivate,
  onClose,
  onPromote,
  onToggleCollapse,
  onTemplateChange,
  onJumpFocus,
  onSpawnFromStep,
  onSpawnFromColumn,
  onRefreshRoot,
  onInspectEntity,
  onSelectItem,
  onAddStage,
  onSkipColumn,
  onRestoreHiddenStage,
}: Props) {
  const label = flowDisplayLabel(flow, orgPackageLabel);

  const hiddenStageLabels = flow.hiddenStages.map((code) => {
    const stage = template.stages.find((s) => s.code === code);
    return { code, labelCs: stage?.labelCs ?? code };
  });

  return (
    <div className={`flow-bar ${isActive ? "active" : ""} ${flow.collapsed ? "collapsed" : ""}`}>
      <div className="flow-bar-head" onClick={onActivate}>
        <button
          type="button"
          className="flow-collapse-btn"
          title={flow.collapsed ? "Rozbalit" : "Sbalit"}
          aria-expanded={!flow.collapsed}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
        >
          {flow.collapsed ? "▸" : "▾"}
        </button>
        <span className="flow-bar-label" title={label}>
          {label}
        </span>
        <select
          className="flow-template-select"
          value={flow.templateCode}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            onTemplateChange(e.target.value);
          }}
        >
          {templateOptions.map((t) => (
            <option key={t.code} value={t.code}>
              {t.labelCs}
            </option>
          ))}
        </select>
        {!isActive && (
          <button
            type="button"
            className="flow-action-btn"
            title="Aktivovat"
            onClick={(e) => {
              e.stopPropagation();
              onActivate();
            }}
          >
            ↑
          </button>
        )}
        {!isActive && (
          <button
            type="button"
            className="flow-action-btn"
            title="Promote — přesunout nahoru"
            onClick={(e) => {
              e.stopPropagation();
              onPromote();
            }}
          >
            ⤒
          </button>
        )}
        <button
          type="button"
          className="flow-action-btn flow-close-btn"
          title="Zavřít tok"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>

      {!flow.collapsed && (
        <div className="flow-bar-body">
          <div className="focus-path flow-focus-path">
            <span className="focus-path-inner">
              <span>Focus:</span>
              <button type="button" onClick={onRefreshRoot} title={orgPackageLabel}>
                {orgPackageLabel}
              </button>
              {flow.focus.map((f: FocusStep, i: number) => (
                <span key={`${f.entityId}-${i}`} className="focus-step">
                  <span className="sep">›</span>
                  <button type="button" onClick={() => onJumpFocus(i)}>
                    {f.label}
                  </button>
                  <EntityInfoButton
                    onClick={() => onInspectEntity(f.entityId, f.classLocal)}
                  />
                  <button
                    type="button"
                    className="spawn-step-btn"
                    title="Rozjet paralelní průchod odtud"
                    onClick={() => onSpawnFromStep(i)}
                  >
                    ↗
                  </button>
                </span>
              ))}
              {loading && isActive && <span className="loading-dot">…</span>}
            </span>
          </div>

          {hiddenStageLabels.length > 0 && (
            <div className="flow-hidden-stages">
              <span className="flow-hidden-label">Skryté sloupce:</span>
              {hiddenStageLabels.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  className="flow-hidden-chip"
                  title={`Obnovit sloupec ${s.labelCs}`}
                  onClick={() => onRestoreHiddenStage(s.code)}
                >
                  {s.labelCs}
                  <span className="flow-hidden-chip-x">×</span>
                </button>
              ))}
            </div>
          )}

          <FlowColumns
            flow={flow}
            template={template}
            ready={ready}
            skipOptions={skipOptions}
            onSelectItem={onSelectItem}
            onSpawnFromColumn={onSpawnFromColumn}
            onAddStage={onAddStage}
            onInspect={onInspectEntity}
            onSkipColumn={onSkipColumn}
            onRestoreHiddenStage={onRestoreHiddenStage}
          />
        </div>
      )}
    </div>
  );
}
