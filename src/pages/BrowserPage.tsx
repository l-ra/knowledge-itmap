import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getKc } from "@/kc/client";
import { entityLabel } from "@/kc/schema";
import type { Entity } from "@/kc/types";
import {
  browserSessionToSearchParams,
  hydrateBrowserSession,
  parseBrowserStateFromSearchParams,
} from "@/domain/browserUrlState";
import { ModelService } from "@/domain/modelService";
import {
  createEmptyFlow,
  insertFlowBelowActive,
  promoteFlow,
  removeFlow,
  updateFlow,
  type BrowserSession,
  type InspectTarget,
  type NavigationFlow,
} from "@/domain/navigationFlows";
import { getTemplate, type AddActionDef, type TraversalTemplate } from "@/domain/templates";
import {
  type ColumnItem,
  type FocusStep,
  TraversalEngine,
} from "@/domain/traversal";
import { useApp } from "@/state/AppContext";
import { AddDialog } from "@/components/AddDialog";
import { EntityInfoButton } from "@/components/EntityInfoButton";
import { FlowBar } from "@/components/FlowBar";
import { Inspector } from "@/components/Inspector";
import { SpawnFlowDialog } from "@/components/SpawnFlowDialog";

interface SpawnRequest {
  sourceFlowId: string;
  prefixFocus: FocusStep[];
  colIndex: number;
  entityId?: string;
  defaultTemplateCode: string;
}

export function BrowserPage() {
  const {
    ready,
    error,
    orgPackage,
    orgPackageLabel,
    pushChangeSet,
    graphEpoch,
    navigationProfile,
    navigationLoading,
    templateCode: defaultTemplateCode,
    setOrgPackage,
  } = useApp();

  const [searchParams, setSearchParams] = useSearchParams();
  const [flows, setFlows] = useState<NavigationFlow[]>([]);
  const [activeFlowId, setActiveFlowId] = useState("");
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  const [peekEntity, setPeekEntity] = useState<{ entity: Entity; classLocal: string } | null>(
    null,
  );
  const [addStage, setAddStage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [spawnRequest, setSpawnRequest] = useState<SpawnRequest | null>(null);
  const [urlHydrated, setUrlHydrated] = useState(false);
  const skipUrlSync = useRef(false);
  const flowsRef = useRef(flows);
  flowsRef.current = flows;

  const engine = useMemo(() => new TraversalEngine(), []);
  const model = useMemo(() => new ModelService(), []);

  const templateOptions = useMemo((): TraversalTemplate[] => {
    if (navigationProfile?.templates.length) {
      return navigationProfile.templates.map((t) => t.template);
    }
    return [getTemplate(defaultTemplateCode)];
  }, [navigationProfile, defaultTemplateCode]);

  const resolveTemplate = useCallback(
    (code: string): TraversalTemplate => {
      const fromProfile = navigationProfile?.templates.find((t) => t.template.code === code);
      if (fromProfile) return fromProfile.template;
      return getTemplate(code);
    },
    [navigationProfile],
  );

  const activeFlow = useMemo(
    () => flows.find((f) => f.id === activeFlowId) ?? flows[0] ?? null,
    [flows, activeFlowId],
  );

  const activeTemplate = useMemo(
    () => (activeFlow ? resolveTemplate(activeFlow.templateCode) : getTemplate(defaultTemplateCode)),
    [activeFlow, resolveTemplate, defaultTemplateCode],
  );

  const patchFlow = useCallback((flowId: string, patch: Partial<NavigationFlow>) => {
    setFlows((prev) => updateFlow(prev, flowId, patch));
  }, []);

  const syncUrl = useCallback(
    (session: BrowserSession) => {
      if (skipUrlSync.current) return;
      const params = browserSessionToSearchParams(session);
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );

  const initEmptyFlow = useCallback(async () => {
    const flow = createEmptyFlow(defaultTemplateCode, "f1");
    if (!ready || navigationLoading) {
      setFlows([flow]);
      setActiveFlowId(flow.id);
      return;
    }
    setLoading(true);
    try {
      const template = resolveTemplate(flow.templateCode);
      const root = await engine.loadRootColumn(orgPackage, template);
      const initialized = { ...flow, columns: [root] };
      setFlows([initialized]);
      setActiveFlowId(initialized.id);
    } catch (e) {
      const template = resolveTemplate(flow.templateCode);
      setFlows([
        {
          ...flow,
          columns: [
            {
              stage: template.stages[0],
              items: [],
              loading: false,
              error: e instanceof Error ? e.message : String(e),
            },
          ],
        },
      ]);
      setActiveFlowId(flow.id);
    } finally {
      setLoading(false);
    }
  }, [ready, navigationLoading, orgPackage, defaultTemplateCode, engine, resolveTemplate]);

  const refreshFlow = useCallback(
    async (flow: NavigationFlow): Promise<NavigationFlow> => {
      const template = resolveTemplate(flow.templateCode);
      if (flow.focus.length === 0) {
        try {
          const root = await engine.loadRootColumn(orgPackage, template);
          return { ...flow, columns: [root], selected: null };
        } catch (e) {
          return {
            ...flow,
            columns: [
              {
                stage: template.stages[0],
                items: [],
                loading: false,
                error: e instanceof Error ? e.message : String(e),
              },
            ],
            selected: null,
          };
        }
      }
      const cols = await engine.expandPath(orgPackage, template, flow.focus);
      const last = flow.focus[flow.focus.length - 1];
      let selected = flow.selected;
      if (last) {
        try {
          const ent = await getKc().getEntity(last.entityId);
          selected = { entity: ent, classLocal: last.classLocal };
        } catch {
          selected = null;
        }
      }
      return { ...flow, columns: cols, selected };
    },
    [engine, orgPackage, resolveTemplate],
  );

  const refreshAllFlows = useCallback(async () => {
    if (!ready || navigationLoading || flowsRef.current.length === 0) return;
    setLoading(true);
    try {
      const refreshed = await Promise.all(flowsRef.current.map((f) => refreshFlow(f)));
      setFlows(refreshed);
    } finally {
      setLoading(false);
    }
  }, [ready, navigationLoading, refreshFlow]);

  // Initial hydrate from URL or create default flow
  useEffect(() => {
    if (!ready || navigationLoading || urlHydrated) return;

    const serialized = parseBrowserStateFromSearchParams(searchParams);
    if (serialized) {
      if (serialized.orgPackage && serialized.orgPackage !== orgPackage) {
        setOrgPackage(serialized.orgPackage);
      }
      skipUrlSync.current = true;
      void (async () => {
        setLoading(true);
        try {
          const pkg = serialized.orgPackage || orgPackage;
          const session = await hydrateBrowserSession(
            serialized,
            pkg,
            engine,
            resolveTemplate,
          );
          setFlows(session.flows);
          setActiveFlowId(session.activeFlowId);
          setInspectTarget(session.inspectTarget);
          setUrlHydrated(true);
        } catch {
          setUrlHydrated(true);
          await initEmptyFlow();
        } finally {
          setLoading(false);
          skipUrlSync.current = false;
        }
      })();
    } else {
      setUrlHydrated(true);
      void initEmptyFlow();
    }
  }, [
    ready,
    navigationLoading,
    urlHydrated,
    searchParams,
    orgPackage,
    setOrgPackage,
    engine,
    resolveTemplate,
    initEmptyFlow,
  ]);

  // Refresh all flows on graph changes
  useEffect(() => {
    if (!urlHydrated || flows.length === 0) return;
    void refreshAllFlows();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- graphEpoch only
  }, [graphEpoch]);

  // Sync URL when session changes
  useEffect(() => {
    if (!urlHydrated || flows.length === 0 || !activeFlowId) return;
    syncUrl({ orgPackage, flows, activeFlowId, inspectTarget });
  }, [urlHydrated, orgPackage, flows, activeFlowId, inspectTarget, syncUrl]);

  // Load peek entity for inspector
  useEffect(() => {
    if (!inspectTarget) {
      setPeekEntity(null);
      return;
    }
    void (async () => {
      try {
        const entity = await getKc().getEntity(inspectTarget.entityId);
        setPeekEntity({ entity, classLocal: inspectTarget.classLocal });
      } catch {
        setPeekEntity(null);
        setInspectTarget(null);
      }
    })();
  }, [inspectTarget]);

  async function refreshFlowRoot(flowId: string) {
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;
    setLoading(true);
    try {
      const template = resolveTemplate(flow.templateCode);
      const root = await engine.loadRootColumn(orgPackage, template);
      patchFlow(flowId, { focus: [], columns: [root], selected: null });
    } finally {
      setLoading(false);
    }
  }

  async function selectItem(flowId: string, colIndex: number, item: ColumnItem) {
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;
    const template = resolveTemplate(flow.templateCode);

    const step: FocusStep = {
      entityId: item.entity.id,
      label: entityLabel(item.entity),
      stageCode: flow.columns[colIndex].stage.code,
      classLocal: item.classLocal,
    };
    const newFocus = [...flow.focus.slice(0, colIndex), step];

    patchFlow(flowId, {
      focus: newFocus,
      selected: { entity: item.entity, classLocal: item.classLocal },
    });

    setLoading(true);
    try {
      const next = await engine.loadNextColumn(
        orgPackage,
        template,
        item.entity,
        item.classLocal,
        flow.columns[colIndex].stage.code,
      );
      const kept = flow.columns.slice(0, colIndex + 1);
      patchFlow(flowId, {
        focus: newFocus,
        selected: { entity: item.entity, classLocal: item.classLocal },
        columns: next ? [...kept, next] : kept,
      });
    } finally {
      setLoading(false);
    }
  }

  function jumpFocus(flowId: string, index: number) {
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;
    const truncated = flow.focus.slice(0, index + 1);
    patchFlow(flowId, { focus: truncated });

    void (async () => {
      setLoading(true);
      try {
        const template = resolveTemplate(flow.templateCode);
        const cols = await engine.expandPath(orgPackage, template, truncated);
        const last = truncated[truncated.length - 1];
        let selected: NavigationFlow["selected"] = null;
        if (last) {
          const ent = await getKc().getEntity(last.entityId);
          selected = { entity: ent, classLocal: last.classLocal };
        }
        patchFlow(flowId, { focus: truncated, columns: cols, selected });
      } finally {
        setLoading(false);
      }
    })();
  }

  async function changeFlowTemplate(flowId: string, code: string) {
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;
    setLoading(true);
    try {
      const template = resolveTemplate(code);
      let columns;
      if (flow.focus.length === 0) {
        columns = [await engine.loadRootColumn(orgPackage, template)];
      } else {
        columns = await engine.expandPath(orgPackage, template, flow.focus);
      }
      patchFlow(flowId, { templateCode: code, columns });
    } finally {
      setLoading(false);
    }
  }

  async function confirmSpawn(templateCode: string) {
    if (!spawnRequest) return;
    const { sourceFlowId, prefixFocus, colIndex, entityId } = spawnRequest;
    const sourceFlow = flows.find((f) => f.id === sourceFlowId);
    if (!sourceFlow) {
      setSpawnRequest(null);
      return;
    }

    setLoading(true);
    try {
      const template = resolveTemplate(templateCode);
      const columns = await engine.expandPath(orgPackage, template, prefixFocus);
      let selected: NavigationFlow["selected"] = null;
      const last = prefixFocus[prefixFocus.length - 1];
      if (last) {
        const ent = await getKc().getEntity(last.entityId);
        selected = { entity: ent, classLocal: last.classLocal };
      }

      const newFlow = createEmptyFlow(templateCode);
      newFlow.focus = prefixFocus;
      newFlow.columns = columns;
      newFlow.selected = selected;
      if (entityId) {
        newFlow.spawnedFrom = { flowId: sourceFlowId, colIndex, entityId };
      }

      setFlows((prev) => insertFlowBelowActive(prev, activeFlowId, newFlow));
      setActiveFlowId(newFlow.id);
    } finally {
      setLoading(false);
      setSpawnRequest(null);
    }
  }

  function requestSpawnFromStep(flowId: string, stepIndex: number) {
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;
    const prefixFocus = flow.focus.slice(0, stepIndex + 1);
    setSpawnRequest({
      sourceFlowId: flowId,
      prefixFocus,
      colIndex: stepIndex,
      entityId: flow.focus[stepIndex]?.entityId,
      defaultTemplateCode: flow.templateCode,
    });
  }

  function requestSpawnFromColumn(flowId: string, colIndex: number) {
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;
    const prefixFocus = flow.focus.slice(0, colIndex);
    setSpawnRequest({
      sourceFlowId: flowId,
      prefixFocus,
      colIndex,
      entityId: flow.focus[colIndex - 1]?.entityId,
      defaultTemplateCode: flow.templateCode,
    });
  }

  function requestNewEmptyFlow() {
    setSpawnRequest({
      sourceFlowId: activeFlowId,
      prefixFocus: [],
      colIndex: -1,
      defaultTemplateCode: defaultTemplateCode,
    });
  }

  function handleCloseFlow(flowId: string) {
    const result = removeFlow(flows, flowId, defaultTemplateCode);
    setFlows(result.flows);
    setActiveFlowId(result.activeFlowId);
    if (result.flows.length === 1 && result.flows[0].columns.length === 0) {
      void refreshFlow(result.flows[0]).then((f) => patchFlow(f.id, f));
    }
  }

  function handlePromoteFlow(flowId: string) {
    setFlows((prev) => promoteFlow(prev, flowId));
    setActiveFlowId(flowId);
  }

  function handleInspect(entityId: string, classLocal: string) {
    setInspectTarget({ entityId, classLocal });
  }

  async function handleAdd(
    action: AddActionDef,
    name: string,
    description: string,
    extras: Record<string, string>,
  ) {
    if (!activeFlow || !addStage) return;
    const selectedId =
      activeFlow.focus.length > 0
        ? activeFlow.focus[activeFlow.focus.length - 1]?.entityId
        : undefined;

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

    if (activeFlow.focus.length === 0) {
      await refreshFlowRoot(activeFlow.id);
    } else {
      jumpFocus(activeFlow.id, activeFlow.focus.length - 1);
    }
  }

  const addActions = addStage
    ? activeTemplate.addActions.filter((a) => a.stage === addStage)
    : [];

  const inspectorEntity = peekEntity ?? activeFlow?.selected ?? null;
  const inspectorClassLocal = peekEntity?.classLocal ?? activeFlow?.selected?.classLocal;
  const inspectorIsPeek = peekEntity !== null;

  return (
    <div className="browse-page">
      {(error || !ready) && (
        <div className={`status-banner ${error ? "error" : ""}`}>
          {error
            ? `Knowledge Core nedostupné: ${error}. Spusťte KC (viz README) a zkontrolujte Settings.`
            : "Načítám schema archimate-lite…"}
        </div>
      )}

      {navigationProfile?.usedFallback && (
        <div className="status-banner">
          Navigační profil z KC není k dispozici — použity vestavěné šablony.
        </div>
      )}

      <div className="flow-stack">
        <div className="flow-stack-toolbar">
          <button
            type="button"
            className="toolbar-btn"
            disabled={!ready}
            onClick={() => requestNewEmptyFlow()}
          >
            + Nový tok
          </button>
        </div>
        {flows.map((flow) => (
          <FlowBar
            key={flow.id}
            flow={flow}
            isActive={flow.id === activeFlowId}
            orgPackageLabel={orgPackageLabel}
            templateOptions={templateOptions}
            loading={loading}
            onActivate={() => setActiveFlowId(flow.id)}
            onClose={() => handleCloseFlow(flow.id)}
            onPromote={() => handlePromoteFlow(flow.id)}
            onToggleCollapse={() => patchFlow(flow.id, { collapsed: !flow.collapsed })}
            onTemplateChange={(code) => void changeFlowTemplate(flow.id, code)}
            onJumpFocus={(index) => jumpFocus(flow.id, index)}
            onSpawnFromStep={(index) => requestSpawnFromStep(flow.id, index)}
            onRefreshRoot={() => void refreshFlowRoot(flow.id)}
            onInspectEntity={handleInspect}
          />
        ))}
      </div>

      {activeFlow && (
        <div className="main-split">
          <div className="columns">
            {activeFlow.columns.map((col, colIndex) => (
              <div className="column" key={`${col.stage.code}-${colIndex}`}>
                <div className="column-header">
                  <span>{col.stage.labelCs}</span>
                  <span className="column-header-actions">
                    <button
                      type="button"
                      className="spawn-col-btn"
                      title="Nový tok od tohoto sloupce"
                      onClick={() => requestSpawnFromColumn(activeFlow.id, colIndex)}
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
                    const isSelected =
                      activeFlow.focus[colIndex]?.entityId === item.entity.id;
                    return (
                      <div
                        key={item.entity.id}
                        className={`column-item-row ${isSelected ? "selected" : ""}`}
                      >
                        <button
                          type="button"
                          className={`column-item ${isSelected ? "selected" : ""}`}
                          onClick={() => void selectItem(activeFlow.id, colIndex, item)}
                        >
                          <span className="name">{entityLabel(item.entity)}</span>
                          <span className="meta">{item.domainLabel}</span>
                          {item.edgeLabelCs && <span className="edge">{item.edgeLabelCs}</span>}
                        </button>
                        <EntityInfoButton
                          onClick={() => handleInspect(item.entity.id, item.classLocal)}
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
                      activeTemplate.addActions.filter((a) => a.stage === col.stage.code)
                        .length === 0
                    }
                    onClick={() => setAddStage(col.stage.code)}
                  >
                    + Přidat
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Inspector
            entity={inspectorEntity?.entity ?? null}
            classLocal={inspectorClassLocal}
            isPeek={inspectorIsPeek}
            onClosePeek={() => {
              setInspectTarget(null);
              setPeekEntity(null);
            }}
            onUpdated={() => {
              if (activeFlow.focus.length) jumpFocus(activeFlow.id, activeFlow.focus.length - 1);
              else void refreshFlowRoot(activeFlow.id);
            }}
          />
        </div>
      )}

      {addStage && addActions.length > 0 && (
        <AddDialog
          stageLabel={
            activeTemplate.stages.find((s) => s.code === addStage)?.labelCs || addStage
          }
          actions={addActions}
          onClose={() => setAddStage(null)}
          onSubmit={handleAdd}
        />
      )}

      {spawnRequest && (
        <SpawnFlowDialog
          title={
            spawnRequest.prefixFocus.length === 0
              ? "Nový prázdný tok"
              : "Paralelní průchod od vybraného bodu"
          }
          templates={templateOptions}
          defaultTemplateCode={spawnRequest.defaultTemplateCode}
          onClose={() => setSpawnRequest(null)}
          onConfirm={(code) => void confirmSpawn(code)}
        />
      )}
    </div>
  );
}
