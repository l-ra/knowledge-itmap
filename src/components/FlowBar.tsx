import type { TraversalTemplate } from "@/domain/templates";
import type { FocusStep } from "@/domain/traversal";
import { flowDisplayLabel, type NavigationFlow } from "@/domain/navigationFlows";
import { EntityInfoButton } from "./EntityInfoButton";

interface Props {
  flow: NavigationFlow;
  isActive: boolean;
  orgPackageLabel: string;
  templateOptions: TraversalTemplate[];
  loading: boolean;
  onActivate: () => void;
  onClose: () => void;
  onPromote: () => void;
  onToggleCollapse: () => void;
  onTemplateChange: (code: string) => void;
  onJumpFocus: (index: number) => void;
  onSpawnFromStep: (index: number) => void;
  onRefreshRoot: () => void;
  onInspectEntity: (entityId: string, classLocal: string) => void;
}

export function FlowBar({
  flow,
  isActive,
  orgPackageLabel,
  templateOptions,
  loading,
  onActivate,
  onClose,
  onPromote,
  onToggleCollapse,
  onTemplateChange,
  onJumpFocus,
  onSpawnFromStep,
  onRefreshRoot,
  onInspectEntity,
}: Props) {
  const label = flowDisplayLabel(flow, orgPackageLabel);

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
      )}
    </div>
  );
}
