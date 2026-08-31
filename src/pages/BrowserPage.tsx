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
  type SkipTarget,
  TraversalEngine,
} from "@/domain/traversal";
import { useApp } from "@/state/AppContext";
import { AddDialog, type AddDialogSubmit } from "@/components/AddDialog";
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
  const [addStage, setAddStage] = useState<{
    flowId: string;
    colIndex: number;
    stageCode: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [spawnRequest, setSpawnRequest] = useState<SpawnRequest | null>(null);
  const [urlHydrated, setUrlHydrated] = useState(false);
  const [skipOptionsByFlow, setSkipOptionsByFlow] = useState<
    Record<string, Map<number, SkipTarget>>
  >({});
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

  const traversalOpts = useCallback(
    (flow: NavigationFlow) => ({ hiddenStages: flow.hiddenStages }),
    [],
  );

  const rebuildFlowColumns = useCallback(
    async (
      flow: NavigationFlow,
      focus: FocusStep[],
      hiddenStages: string[],
    ): Promise<Pick<NavigationFlow, "columns" | "selected">> => {
      const template = resolveTemplate(flow.templateCode);
      const columns = await engine.expandPath(orgPackage, template, focus, { hiddenStages });
      const last = focus[focus.length - 1];
      let selected: NavigationFlow["selected"] = null;
      if (last) {
        try {
          const ent = await getKc().getEntity(last.entityId);
          selected = { entity: ent, classLocal: last.classLocal };
        } catch {
          selected = null;
        }
      }
      return { columns, selected };
    },
    [engine, orgPackage, resolveTemplate],
  );

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
      const cols = await engine.expandPath(orgPackage, template, flow.focus, traversalOpts(flow));
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

  // Compute per-column skip affordances
  useEffect(() => {
    if (!ready || !urlHydrated || flows.length === 0) return;

    void (async () => {
      const next: Record<string, Map<number, SkipTarget>> = {};
      for (const flow of flowsRef.current) {
        if (flow.columns.length <= 1) continue;
        const template = resolveTemplate(flow.templateCode);
        next[flow.id] = await engine.computeSkipOptions(
          orgPackage,
          template,
          flow.columns,
          flow.focus,
          flow.hiddenStages,
        );
      }
      setSkipOptionsByFlow(next);
    })();
  }, [flows, ready, urlHydrated, orgPackage, engine, resolveTemplate]);

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
    setActiveFlowId(flowId);
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;
    setLoading(true);
    try {
      const template = resolveTemplate(flow.templateCode);
      const root = await engine.loadRootColumn(orgPackage, template);
      patchFlow(flowId, { focus: [], columns: [root], selected: null, hiddenStages: [] });
    } finally {
      setLoading(false);
    }
  }

  async function selectItem(flowId: string, colIndex: number, item: ColumnItem) {
    setActiveFlowId(flowId);
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
        traversalOpts(flow),
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
    setActiveFlowId(flowId);
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;
    const truncated = flow.focus.slice(0, index + 1);
    patchFlow(flowId, { focus: truncated });

    void (async () => {
      setLoading(true);
      try {
        const template = resolveTemplate(flow.templateCode);
        const cols = await engine.expandPath(orgPackage, template, truncated, traversalOpts(flow));
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
        columns = await engine.expandPath(orgPackage, template, flow.focus, traversalOpts(flow));
      }
      patchFlow(flowId, { templateCode: code, columns, hiddenStages: [] });
    } finally {
      setLoading(false);
    }
  }

  async function skipColumn(flowId: string, colIndex: number) {
    if (colIndex < 1) return;
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;

    const hideStageCode = flow.columns[colIndex]?.stage.code;
    if (!hideStageCode || flow.hiddenStages.includes(hideStageCode)) return;

    const newHidden = [...flow.hiddenStages, hideStageCode];
    const newFocus = flow.focus.slice(0, colIndex);

    setActiveFlowId(flowId);
    setLoading(true);
    try {
      const rebuilt = await rebuildFlowColumns(flow, newFocus, newHidden);
      patchFlow(flowId, {
        focus: newFocus,
        hiddenStages: newHidden,
        ...rebuilt,
      });
    } finally {
      setLoading(false);
    }
  }

  async function restoreHiddenStage(flowId: string, stageCode: string) {
    const flow = flows.find((f) => f.id === flowId);
    if (!flow || !flow.hiddenStages.includes(stageCode)) return;

    const newHidden = flow.hiddenStages.filter((s) => s !== stageCode);

    setActiveFlowId(flowId);
    setLoading(true);
    try {
      const rebuilt = await rebuildFlowColumns(flow, flow.focus, newHidden);
      patchFlow(flowId, {
        hiddenStages: newHidden,
        ...rebuilt,
      });
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

  async function handleAddSubmit(payload: AddDialogSubmit) {
    if (!addStage) return;
    const targetFlow = flows.find((f) => f.id === addStage.flowId);
    if (!targetFlow) return;
    const parentColIndex = addStage.colIndex - 1;
    const selectedId =
      parentColIndex >= 0 ? targetFlow.focus[parentColIndex]?.entityId : undefined;

    const extras = payload.extras;
    let changeSet;

    if (payload.mode === "link") {
      const result = await model.linkElement({
        packageCode: orgPackage,
        action: payload.action,
        existingEntityId: payload.entityId,
        selectedId,
        extraProps: extras,
        flowLabel: extras.flowLabel,
      });
      changeSet = result.changeSet;
    } else {
      const result = await model.createElement({
        packageCode: orgPackage,
        name: payload.name,
        description: payload.description,
        action: payload.action,
        selectedId,
        extraProps: extras,
        flowLabel: extras.flowLabel,
      });
      changeSet = result.changeSet;
    }

    pushChangeSet(changeSet);

    if (addStage.colIndex === 0) {
      await refreshFlowRoot(targetFlow.id);
    } else if (parentColIndex >= 0 && targetFlow.focus[parentColIndex]) {
      jumpFocus(targetFlow.id, parentColIndex);
    }
  }

  const addFlow = addStage ? flows.find((f) => f.id === addStage.flowId) : null;
  const addTemplate = addFlow ? resolveTemplate(addFlow.templateCode) : activeTemplate;
  const addActions = addStage
    ? addTemplate.addActions.filter((a) => a.stage === addStage.stageCode)
    : [];
  const addStageDef = addStage
    ? addTemplate.stages.find((s) => s.code === addStage.stageCode)
    : undefined;
  const addParentColIndex = addStage ? addStage.colIndex - 1 : -1;
  const addContextLabel =
    addFlow && addParentColIndex >= 0
      ? addFlow.focus[addParentColIndex]?.label
      : undefined;
  const addLinkedEntityIds =
    addFlow && addStage ? addFlow.columns[addStage.colIndex]?.items.map((i) => i.entity.id) : [];

  const searchAddCandidates = useCallback(
    (action: AddActionDef, query: string) => {
      if (!addStageDef) return Promise.resolve([]);
      return engine.searchStageCandidates(orgPackage, addStageDef, action, query);
    },
    [engine, orgPackage, addStageDef],
  );

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

      <div className="browser-body">
        <div className="flow-panels">
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
              template={resolveTemplate(flow.templateCode)}
              isActive={flow.id === activeFlowId}
              orgPackageLabel={orgPackageLabel}
              templateOptions={templateOptions}
              ready={ready}
              loading={loading}
              skipOptions={skipOptionsByFlow[flow.id] ?? new Map()}
              onActivate={() => setActiveFlowId(flow.id)}
              onClose={() => handleCloseFlow(flow.id)}
              onPromote={() => handlePromoteFlow(flow.id)}
              onToggleCollapse={() => patchFlow(flow.id, { collapsed: !flow.collapsed })}
              onTemplateChange={(code) => void changeFlowTemplate(flow.id, code)}
              onJumpFocus={(index) => jumpFocus(flow.id, index)}
              onSpawnFromStep={(index) => requestSpawnFromStep(flow.id, index)}
              onSpawnFromColumn={(colIndex) => requestSpawnFromColumn(flow.id, colIndex)}
              onRefreshRoot={() => void refreshFlowRoot(flow.id)}
              onInspectEntity={handleInspect}
              onSelectItem={(colIndex, item) => void selectItem(flow.id, colIndex, item)}
              onAddStage={(colIndex, stageCode) => {
                setActiveFlowId(flow.id);
                setAddStage({ flowId: flow.id, colIndex, stageCode });
              }}
              onSkipColumn={(colIndex) => void skipColumn(flow.id, colIndex)}
              onRestoreHiddenStage={(stageCode) => void restoreHiddenStage(flow.id, stageCode)}
            />
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
            if (!activeFlow) return;
            if (activeFlow.focus.length) jumpFocus(activeFlow.id, activeFlow.focus.length - 1);
            else void refreshFlowRoot(activeFlow.id);
          }}
        />
      </div>

      {addStage && addActions.length > 0 && addStageDef && (
        <AddDialog
          stageLabel={addStageDef.labelCs}
          actions={addActions}
          contextLabel={addContextLabel}
          linkedEntityIds={addLinkedEntityIds}
          onSearch={searchAddCandidates}
          onClose={() => setAddStage(null)}
          onSubmit={handleAddSubmit}
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
