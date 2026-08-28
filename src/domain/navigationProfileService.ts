import { getKc, type KcClient } from "../kc/client";
import { getSchema, type SchemaResolver } from "../kc/schema";
import type { ChangeSet } from "../kc/types";
import { NavigationProfileLoader, getNavigationLoader } from "./navigationProfileLoader";
import { mapTemplateBundle } from "./navigationProfileMapper";
import type {
  TemplateBundle,
  UiNavigationProfileMeta,
  ValidationIssue,
} from "./navigationProfileTypes";
import { resetNavigationResolver } from "./navigationProfile";

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export class NavigationProfileService {
  constructor(
    private kc: KcClient = getKc(),
    private schema: SchemaResolver = getSchema(),
    private loader: NavigationProfileLoader = getNavigationLoader(),
  ) {}

  async getOrgProfileLink(orgPackageCode: string): Promise<string | null> {
    return this.loader.getOrgProfileLinkId(orgPackageCode);
  }

  async setOrgProfileLink(
    orgPackageCode: string,
    profileId: string | null,
  ): Promise<ChangeSet> {
    const pkg = await this.kc.getPackage(orgPackageCode);
    if (!pkg.rootEntityId) throw new Error("Org package nemá package-root");
    const propIri = this.schema.propertyIri("orgNavigationProfile");

    const { changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "setOrgNavigationProfile", comment: orgPackageCode },
      async () => {
        const existing = await this.kc.getStatements(pkg.rootEntityId!, propIri);
        for (const stmt of existing.items) {
          await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
        }
        if (profileId) {
          await this.kc.createStatement({
            packageCode: orgPackageCode,
            subject: pkg.rootEntityId!,
            property: propIri,
            value: { type: "EntityReference", entityId: profileId },
          });
        }
      },
    );
    resetNavigationResolver();
    this.loader.clearCache();
    return changeSet;
  }

  async listAllProfiles(): Promise<UiNavigationProfileMeta[]> {
    return this.loader.listProfiles();
  }

  async duplicateDefaultProfile(
    orgPackageCode: string,
    label?: string,
  ): Promise<{ profileId: string; changeSet: ChangeSet }> {
    const system = await this.loader.findSystemProfile();
    if (!system) throw new Error("Systémový profil v KC chybí");

    const bundle = await this.loader.loadProfileBundle(system.id);
    const profileCode = `${slugify(orgPackageCode)}-nav`;
    const profileIriLocal = `nav-profile-${slugify(orgPackageCode)}-${Date.now().toString(36)}`;

    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      {
        operationType: "duplicateNavigationProfile",
        comment: `Clone ${system.profileCode} for ${orgPackageCode}`,
      },
      async () => {
        const idMap = new Map<string, string>();
        const profileId = await this.createProfileEntity(orgPackageCode, {
          iriLocal: profileIriLocal,
          profileCode,
          labelCs: label || `${orgPackageCode} — navigace`,
          parentProfileId: system.id,
        });
        idMap.set(system.id, profileId);

        for (const tpl of bundle.templates) {
          await this.cloneTemplateBundle(orgPackageCode, tpl, profileId, idMap);
        }

        await this.linkProfileToOrg(orgPackageCode, profileId);
        return { profileId };
      },
    );

    resetNavigationResolver();
    this.loader.clearCache();
    return { profileId: result.profileId, changeSet };
  }

  async validateProfile(profileId: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const bundles = await this.loader.loadTemplatesForProfile(profileId);
    for (const bundle of bundles) {
      const { issues: mapped } = mapTemplateBundle(bundle, this.schema);
      issues.push(...mapped);
    }
    return issues;
  }

  async loadTemplateForEdit(templateId: string): Promise<TemplateBundle> {
    return this.loader.loadTemplateBundle(templateId);
  }

  async upsertStage(opts: {
    packageCode: string;
    templateId: string;
    stageId?: string;
    stageCode: string;
    columnLabelCs: string;
    stageOrder: number;
    targetClasses: string[];
    actorKinds?: string;
    instanceFilter?: string;
  }): Promise<{ stageId: string; changeSet: ChangeSet }> {
    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "upsertUiStage", comment: opts.stageCode },
      async () => {
        let stageId = opts.stageId;
        if (!stageId) {
          stageId = await this.createUiEntity(opts.packageCode, "UiStage", {
            iriLocal: `ui-stage-${slugify(opts.stageCode)}-${Date.now().toString(36)}`,
            labels: { cs: opts.columnLabelCs, en: opts.columnLabelCs },
          });
        } else {
          await this.kc.patchEntity(stageId, {
            labels: { cs: opts.columnLabelCs, en: opts.columnLabelCs },
          });
        }
        await this.setEntityRef(opts.packageCode, stageId, "parentTemplate", opts.templateId);
        await this.setString(opts.packageCode, stageId, "stageCode", opts.stageCode);
        await this.setString(opts.packageCode, stageId, "columnLabelCs", opts.columnLabelCs);
        await this.setInteger(opts.packageCode, stageId, "stageOrder", opts.stageOrder);
        await this.setClassRefs(opts.packageCode, stageId, "targetClasses", opts.targetClasses);
        if (opts.actorKinds) {
          await this.setString(opts.packageCode, stageId, "actorKinds", opts.actorKinds);
        }
        if (opts.instanceFilter) {
          await this.setString(opts.packageCode, stageId, "instanceFilter", opts.instanceFilter);
        }
        return { stageId };
      },
    );
    resetNavigationResolver();
    this.loader.clearCache();
    return { stageId: result.stageId, changeSet };
  }

  async deleteStage(packageCode: string, stageId: string): Promise<ChangeSet> {
    const cs = await this.deprecateEntityStatements(packageCode, stageId);
    resetNavigationResolver();
    this.loader.clearCache();
    return cs;
  }

  async upsertTransition(opts: {
    packageCode: string;
    templateId: string;
    transitionId?: string;
    fromStageId: string;
    toStageId: string;
    relationshipClass: string;
    traverseDirection: "model" | "inverse";
    uiEdgeLabelCs: string;
    requireProperty?: string;
  }): Promise<{ transitionId: string; changeSet: ChangeSet }> {
    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "upsertUiTransition", comment: opts.uiEdgeLabelCs },
      async () => {
        let transitionId = opts.transitionId;
        if (!transitionId) {
          transitionId = await this.createUiEntity(opts.packageCode, "UiTransition", {
            iriLocal: `ui-trans-${Date.now().toString(36)}`,
            labels: { cs: opts.uiEdgeLabelCs, en: opts.uiEdgeLabelCs },
          });
        }
        await this.setEntityRef(opts.packageCode, transitionId, "parentTemplate", opts.templateId);
        await this.setEntityRef(opts.packageCode, transitionId, "fromStage", opts.fromStageId);
        await this.setEntityRef(opts.packageCode, transitionId, "toStage", opts.toStageId);
        await this.setClassRef(
          opts.packageCode,
          transitionId,
          "relationshipClass",
          opts.relationshipClass,
        );
        await this.setString(opts.packageCode, transitionId, "traverseDirection", opts.traverseDirection);
        await this.setString(opts.packageCode, transitionId, "uiEdgeLabelCs", opts.uiEdgeLabelCs);
        if (opts.requireProperty) {
          await this.setString(opts.packageCode, transitionId, "requireProperty", opts.requireProperty);
        }
        return { transitionId };
      },
    );
    resetNavigationResolver();
    this.loader.clearCache();
    return { transitionId: result.transitionId, changeSet };
  }

  async deleteTransition(packageCode: string, transitionId: string): Promise<ChangeSet> {
    const cs = await this.deprecateEntityStatements(packageCode, transitionId);
    resetNavigationResolver();
    this.loader.clearCache();
    return cs;
  }

  async upsertAddAction(opts: {
    packageCode: string;
    templateId: string;
    actionId?: string;
    stageId: string;
    actionCode: string;
    domainLabelCs: string;
    createsClass: string;
    sortOrder?: number;
    defaultProperties?: string;
    derivesRelationship?: string;
    relationshipDirection?: string;
    relationshipDefaults?: string;
  }): Promise<{ actionId: string; changeSet: ChangeSet }> {
    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "upsertUiAddAction", comment: opts.actionCode },
      async () => {
        let actionId = opts.actionId;
        if (!actionId) {
          actionId = await this.createUiEntity(opts.packageCode, "UiAddAction", {
            iriLocal: `ui-add-${slugify(opts.actionCode)}-${Date.now().toString(36)}`,
            labels: { cs: opts.domainLabelCs, en: opts.domainLabelCs },
          });
        }
        await this.setEntityRef(opts.packageCode, actionId, "parentTemplate", opts.templateId);
        await this.setEntityRef(opts.packageCode, actionId, "stage", opts.stageId);
        await this.setString(opts.packageCode, actionId, "actionCode", opts.actionCode);
        await this.setString(opts.packageCode, actionId, "domainLabelCs", opts.domainLabelCs);
        await this.setClassRef(opts.packageCode, actionId, "createsClass", opts.createsClass);
        if (opts.sortOrder !== undefined) {
          await this.setInteger(opts.packageCode, actionId, "sortOrder", opts.sortOrder);
        }
        if (opts.defaultProperties) {
          await this.setString(opts.packageCode, actionId, "defaultProperties", opts.defaultProperties);
        }
        if (opts.derivesRelationship) {
          await this.setClassRef(
            opts.packageCode,
            actionId,
            "derivesRelationship",
            opts.derivesRelationship,
          );
        }
        if (opts.relationshipDirection) {
          await this.setString(
            opts.packageCode,
            actionId,
            "relationshipDirection",
            opts.relationshipDirection,
          );
        }
        if (opts.relationshipDefaults) {
          await this.setString(
            opts.packageCode,
            actionId,
            "relationshipDefaults",
            opts.relationshipDefaults,
          );
        }
        return { actionId };
      },
    );
    resetNavigationResolver();
    this.loader.clearCache();
    return { actionId: result.actionId, changeSet };
  }

  async deleteAddAction(packageCode: string, actionId: string): Promise<ChangeSet> {
    const cs = await this.deprecateEntityStatements(packageCode, actionId);
    resetNavigationResolver();
    this.loader.clearCache();
    return cs;
  }

  private async cloneTemplateBundle(
    packageCode: string,
    bundle: TemplateBundle,
    profileId: string,
    idMap: Map<string, string>,
  ): Promise<void> {
    const tplIri = `ui-tpl-${slugify(bundle.meta.templateCode)}-${Date.now().toString(36)}`;
    const templateId = await this.createUiEntity(packageCode, "UiTraversalTemplate", {
      iriLocal: tplIri,
      labels: { cs: bundle.meta.labelCs, en: bundle.meta.labelCs },
    });
    idMap.set(bundle.meta.id, templateId);

    await this.setEntityRef(packageCode, templateId, "parentProfile", profileId);
    await this.setString(packageCode, templateId, "templateCode", bundle.meta.templateCode);
    await this.setString(packageCode, templateId, "labelCs", bundle.meta.labelCs);
    if (bundle.meta.isDefault) {
      await this.setBoolean(packageCode, templateId, "isDefault", true);
    }
    if (bundle.meta.sortOrder !== undefined) {
      await this.setInteger(packageCode, templateId, "sortOrder", bundle.meta.sortOrder);
    }

    const stageIdMap = new Map<string, string>();
    for (const stage of bundle.stages) {
      const newStageId = await this.createUiEntity(packageCode, "UiStage", {
        iriLocal: `ui-stage-${slugify(stage.stageCode)}-${Date.now().toString(36)}`,
        labels: { cs: stage.columnLabelCs, en: stage.columnLabelCs },
      });
      stageIdMap.set(stage.id, newStageId);
      idMap.set(stage.id, newStageId);
      await this.setEntityRef(packageCode, newStageId, "parentTemplate", templateId);
      await this.setString(packageCode, newStageId, "stageCode", stage.stageCode);
      await this.setString(packageCode, newStageId, "columnLabelCs", stage.columnLabelCs);
      await this.setInteger(packageCode, newStageId, "stageOrder", stage.stageOrder);
      await this.setClassRefs(packageCode, newStageId, "targetClasses", stage.targetClassLocals);
      if (stage.actorKinds?.length) {
        await this.setString(packageCode, newStageId, "actorKinds", stage.actorKinds.join(","));
      }
      if (stage.instanceFilter) {
        await this.setString(
          packageCode,
          newStageId,
          "instanceFilter",
          JSON.stringify(stage.instanceFilter),
        );
      }
    }

    const startStageId = bundle.meta.startStageId
      ? stageIdMap.get(bundle.meta.startStageId)
      : stageIdMap.get(bundle.stages[0]?.id || "");
    if (startStageId) {
      await this.setEntityRef(packageCode, templateId, "startStage", startStageId);
    }

    for (const tr of bundle.transitions) {
      const newTrId = await this.createUiEntity(packageCode, "UiTransition", {
        iriLocal: `ui-trans-${Date.now().toString(36)}`,
        labels: { cs: tr.uiEdgeLabelCs, en: tr.uiEdgeLabelCs },
      });
      await this.setEntityRef(packageCode, newTrId, "parentTemplate", templateId);
      const fromId = stageIdMap.get(tr.fromStageId);
      const toId = stageIdMap.get(tr.toStageId);
      if (!fromId || !toId) continue;
      await this.setEntityRef(packageCode, newTrId, "fromStage", fromId);
      await this.setEntityRef(packageCode, newTrId, "toStage", toId);
      await this.setClassRef(packageCode, newTrId, "relationshipClass", tr.relationshipClassLocal);
      await this.setString(packageCode, newTrId, "traverseDirection", tr.traverseDirection);
      await this.setString(packageCode, newTrId, "uiEdgeLabelCs", tr.uiEdgeLabelCs);
      if (tr.requireProperty) {
        await this.setString(
          packageCode,
          newTrId,
          "requireProperty",
          JSON.stringify(tr.requireProperty),
        );
      }
    }

    for (const act of bundle.addActions) {
      const newActId = await this.createUiEntity(packageCode, "UiAddAction", {
        iriLocal: `ui-add-${slugify(act.actionCode)}-${Date.now().toString(36)}`,
        labels: { cs: act.domainLabelCs, en: act.domainLabelCs },
      });
      const stageId = stageIdMap.get(act.stageId);
      if (!stageId) continue;
      await this.setEntityRef(packageCode, newActId, "parentTemplate", templateId);
      await this.setEntityRef(packageCode, newActId, "stage", stageId);
      await this.setString(packageCode, newActId, "actionCode", act.actionCode);
      await this.setString(packageCode, newActId, "domainLabelCs", act.domainLabelCs);
      await this.setClassRef(packageCode, newActId, "createsClass", act.createsClassLocal);
      if (act.sortOrder !== undefined) {
        await this.setInteger(packageCode, newActId, "sortOrder", act.sortOrder);
      }
      if (act.defaultProperties) {
        await this.setString(
          packageCode,
          newActId,
          "defaultProperties",
          JSON.stringify(act.defaultProperties),
        );
      }
      if (act.derivesRelationship) {
        await this.setClassRef(
          packageCode,
          newActId,
          "derivesRelationship",
          act.derivesRelationship,
        );
      }
      if (act.relationshipDirection) {
        await this.setString(
          packageCode,
          newActId,
          "relationshipDirection",
          act.relationshipDirection,
        );
      }
      if (act.relationshipDefaults) {
        await this.setString(
          packageCode,
          newActId,
          "relationshipDefaults",
          JSON.stringify(act.relationshipDefaults),
        );
      }
    }
  }

  private async createProfileEntity(
    packageCode: string,
    opts: {
      iriLocal: string;
      profileCode: string;
      labelCs: string;
      parentProfileId?: string;
    },
  ): Promise<string> {
    const id = await this.createUiEntity(packageCode, "UiNavigationProfile", {
      iriLocal: opts.iriLocal,
      labels: { cs: opts.labelCs, en: opts.labelCs },
    });
    await this.setString(packageCode, id, "profileCode", opts.profileCode);
    await this.setString(packageCode, id, "profileVersion", "1.0.0");
    await this.setString(packageCode, id, "minCatalogVersion", "2.3.0");
    await this.setString(packageCode, id, "labelCs", opts.labelCs);
    if (opts.parentProfileId) {
      await this.setEntityRef(packageCode, id, "parentProfile", opts.parentProfileId);
    }
    return id;
  }

  private async linkProfileToOrg(orgPackageCode: string, profileId: string): Promise<void> {
    const pkg = await this.kc.getPackage(orgPackageCode);
    if (!pkg.rootEntityId) return;
    const propIri = this.schema.propertyIri("orgNavigationProfile");
    const existing = await this.kc.getStatements(pkg.rootEntityId, propIri);
    for (const stmt of existing.items) {
      await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
    }
    await this.kc.createStatement({
      packageCode: orgPackageCode,
      subject: pkg.rootEntityId,
      property: propIri,
      value: { type: "EntityReference", entityId: profileId },
    });
  }

  private async createUiEntity(
    packageCode: string,
    classLocal: string,
    opts: { iriLocal: string; labels: Record<string, string> },
  ): Promise<string> {
    const snap = this.schema.snapshot;
    const created = await this.kc.createEntity({
      packageCode,
      labels: opts.labels,
      iriLocal: opts.iriLocal,
    });
    await this.kc.createStatement({
      packageCode,
      subject: created.data.id,
      property: snap.instanceOfProperty,
      value: { type: "EntityReference", entityId: this.schema.classIri(classLocal) },
      upsert: true,
    });
    return created.data.id;
  }

  private async setString(
    packageCode: string,
    subject: string,
    propLocal: string,
    value: string,
  ): Promise<void> {
    const propIri = this.schema.propertyIri(propLocal);
    const existing = await this.kc.getStatements(subject, propIri);
    for (const stmt of existing.items) {
      await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
    }
    await this.kc.createStatement({
      packageCode,
      subject,
      property: propIri,
      value: { type: "String", string: value },
    });
  }

  private async setInteger(
    packageCode: string,
    subject: string,
    propLocal: string,
    value: number,
  ): Promise<void> {
    const propIri = this.schema.propertyIri(propLocal);
    const existing = await this.kc.getStatements(subject, propIri);
    for (const stmt of existing.items) {
      await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
    }
    await this.kc.createStatement({
      packageCode,
      subject,
      property: propIri,
      value: { type: "Integer", int64: value },
    });
  }

  private async setBoolean(
    packageCode: string,
    subject: string,
    propLocal: string,
    value: boolean,
  ): Promise<void> {
    const propIri = this.schema.propertyIri(propLocal);
    const existing = await this.kc.getStatements(subject, propIri);
    for (const stmt of existing.items) {
      await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
    }
    await this.kc.createStatement({
      packageCode,
      subject,
      property: propIri,
      value: { type: "Boolean", bool: value },
    });
  }

  private async setEntityRef(
    packageCode: string,
    subject: string,
    propLocal: string,
    entityId: string,
  ): Promise<void> {
    const propIri = this.schema.propertyIri(propLocal);
    const existing = await this.kc.getStatements(subject, propIri);
    for (const stmt of existing.items) {
      await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
    }
    await this.kc.createStatement({
      packageCode,
      subject,
      property: propIri,
      value: { type: "EntityReference", entityId },
    });
  }

  private async setClassRef(
    packageCode: string,
    subject: string,
    propLocal: string,
    classLocal: string,
  ): Promise<void> {
    await this.setEntityRef(
      packageCode,
      subject,
      propLocal,
      this.schema.classIri(classLocal),
    );
  }

  private async setClassRefs(
    packageCode: string,
    subject: string,
    propLocal: string,
    classLocals: string[],
  ): Promise<void> {
    const propIri = this.schema.propertyIri(propLocal);
    const existing = await this.kc.getStatements(subject, propIri);
    for (const stmt of existing.items) {
      await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
    }
    for (const local of classLocals) {
      await this.kc.createStatement({
        packageCode,
        subject,
        property: propIri,
        value: { type: "EntityReference", entityId: this.schema.classIri(local) },
      });
    }
  }

  private async deprecateEntityStatements(
    packageCode: string,
    entityId: string,
  ): Promise<ChangeSet> {
    void packageCode;
    const { changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "deprecateUiEntity", comment: entityId },
      async () => {
        const stmts = await this.kc.getStatements(entityId);
        for (const stmt of stmts.items) {
          await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
        }
      },
    );
    return changeSet;
  }
}

let serviceSingleton: NavigationProfileService | null = null;

export function getNavigationService(): NavigationProfileService {
  if (!serviceSingleton) serviceSingleton = new NavigationProfileService();
  return serviceSingleton;
}

export function sourceBadgeLabel(source: string): string {
  switch (source) {
    case "system":
      return "systém";
    case "org":
      return "org";
    case "override":
      return "override";
    default:
      return source;
  }
}

export function relClassOptions(): string[] {
  const snap = getSchema().snapshot;
  const rels: string[] = [];
  for (const [local, ent] of snap.classesByLocal) {
    if (!local.match(/^[A-Z]/) || local.startsWith("Ui") || local.startsWith("ArchiMate")) continue;
    if (ent.effectiveClasses?.some((c) => c.includes("ArchiMateRelationship"))) {
      rels.push(local);
    }
  }
  // Fallback: known relationship types from templates
  const known = [
    "Composition",
    "Assignment",
    "Realization",
    "Serving",
    "Access",
    "DeployedOn",
    "Association",
    "Flow",
  ];
  return [...new Set([...known, ...rels])].sort();
}

export function elementClassOptions(): string[] {
  const snap = getSchema().snapshot;
  const out: string[] = [];
  for (const local of snap.classesByLocal.keys()) {
    if (local.startsWith("Ui") || local.startsWith("ArchiMate")) continue;
    if (/^[A-Z]/.test(local)) out.push(local);
  }
  return out.sort();
}
