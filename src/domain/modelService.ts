import { getKc, type KcClient } from "../kc/client";
import { getSchema, type SchemaResolver } from "../kc/schema";
import type { ChangeSet, Entity, StatementValue } from "../kc/types";
import type { AddActionDef } from "./templates";

export interface CreateElementInput {
  packageCode: string;
  name: string;
  description?: string;
  iriLocal?: string;
  action: AddActionDef;
  /** Selected entity in previous column (context for relationship) */
  selectedId?: string;
  extraProps?: Record<string, string>;
  /** Flow requires flowLabel */
  flowLabel?: string;
}

export interface CreateResult {
  entity: Entity;
  relationship?: Entity;
  changeSets: ChangeSet[];
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export class ModelService {
  constructor(
    private kc: KcClient = getKc(),
    private schema: SchemaResolver = getSchema(),
  ) {}

  async createElement(input: CreateElementInput): Promise<CreateResult> {
    const snap = this.schema.snapshot;
    const classIri = this.schema.classIri(input.action.createsClass);
    const iriLocal = input.iriLocal || `${slugify(input.name)}-${Date.now().toString(36)}`;
    const changeSets: ChangeSet[] = [];

    const created = await this.kc.createEntity({
      packageCode: input.packageCode,
      labels: { en: input.name, cs: input.name },
      descriptions: input.description
        ? { en: input.description, cs: input.description }
        : undefined,
      iriLocal,
    });
    changeSets.push(created.changeSet);
    const entity = created.data;

    // instanceOf
    const io = await this.kc.createStatement({
      packageCode: input.packageCode,
      subject: entity.id,
      property: snap.instanceOfProperty,
      value: { type: "EntityReference", entityId: classIri },
      upsert: true,
    });
    changeSets.push(io.changeSet);

    // defaults + extras (skip relationship-only keys)
    const relOnly = new Set(["flowLabel", "associationKind"]);
    const props = { ...input.action.defaults, ...input.extraProps };
    for (const [local, value] of Object.entries(props)) {
      if (relOnly.has(local)) continue;
      const propIri = this.schema.tryPropertyIri(local);
      if (!propIri) continue;
      const st = await this.kc.createStatement({
        packageCode: input.packageCode,
        subject: entity.id,
        property: propIri,
        value: { type: "String", string: value },
        upsert: true,
      });
      changeSets.push(st.changeSet);
    }

    let relationship: Entity | undefined;
    if (input.action.derivesRelationship && input.selectedId) {
      const relProps: Record<string, string> = {
        ...input.action.relationshipDefaults,
        ...(input.extraProps?.associationKind
          ? { associationKind: input.extraProps.associationKind }
          : {}),
        ...(input.flowLabel ? { flowLabel: input.flowLabel } : {}),
      };
      relationship = await this.createRelationship({
        packageCode: input.packageCode,
        typeLocal: input.action.derivesRelationship,
        sourceId:
          input.action.relationshipDirection === "from-new-to-selected"
            ? entity.id
            : input.selectedId,
        targetId:
          input.action.relationshipDirection === "from-new-to-selected"
            ? input.selectedId
            : entity.id,
        props: relProps,
        changeSets,
      });
    }

    return { entity, relationship, changeSets };
  }

  async createRelationship(opts: {
    packageCode: string;
    typeLocal: string;
    sourceId: string;
    targetId: string;
    props?: Record<string, string>;
    changeSets?: ChangeSet[];
  }): Promise<Entity> {
    if (opts.typeLocal === "Flow" && !opts.props?.flowLabel) {
      throw new Error("Flow vyžaduje flowLabel (co teče)");
    }

    const snap = this.schema.snapshot;
    const changeSets = opts.changeSets || [];
    const typeIri = this.schema.classIri(opts.typeLocal);

    const rel = await this.kc.createEntity({
      packageCode: opts.packageCode,
      labels: { en: `${opts.typeLocal}` },
      iriLocal: `rel-${opts.typeLocal.toLowerCase()}-${Date.now().toString(36)}`,
    });
    changeSets.push(rel.changeSet);

    await this.kc.createStatement({
      packageCode: opts.packageCode,
      subject: rel.data.id,
      property: snap.instanceOfProperty,
      value: { type: "EntityReference", entityId: typeIri },
      upsert: true,
    });

    await this.kc.createStatement({
      packageCode: opts.packageCode,
      subject: rel.data.id,
      property: snap.relSource,
      value: { type: "EntityReference", entityId: opts.sourceId },
      upsert: true,
    });

    await this.kc.createStatement({
      packageCode: opts.packageCode,
      subject: rel.data.id,
      property: snap.relTarget,
      value: { type: "EntityReference", entityId: opts.targetId },
      upsert: true,
    });

    for (const [local, value] of Object.entries(opts.props || {})) {
      const propIri = this.schema.tryPropertyIri(local);
      if (!propIri) continue;
      await this.kc.createStatement({
        packageCode: opts.packageCode,
        subject: rel.data.id,
        property: propIri,
        value: { type: "String", string: value },
        upsert: true,
      });
    }

    return rel.data;
  }

  async updateLabels(
    id: string,
    labels: Record<string, string>,
    descriptions?: Record<string, string>,
    revision?: number,
  ): Promise<ChangeSet> {
    const res = await this.kc.patchEntity(id, {
      labels,
      descriptions,
      expectedRevision: revision,
    });
    return res.changeSet;
  }

  async setStringProperty(
    packageCode: string,
    subject: string,
    propertyLocal: string,
    value: string,
  ): Promise<ChangeSet> {
    const propIri = this.schema.propertyIri(propertyLocal);
    const res = await this.kc.createStatement({
      packageCode,
      subject,
      property: propIri,
      value: { type: "String", string: value },
      upsert: true,
    });
    return res.changeSet;
  }

  async addOpenWorldProperty(opts: {
    packageCode: string;
    iriLocal: string;
    label: string;
    datatype?: string;
    subjectId: string;
    value: string;
  }): Promise<{ propertyId: string; changeSets: ChangeSet[] }> {
    const changeSets: ChangeSet[] = [];
    const created = await this.kc.createProperty({
      packageCode: opts.packageCode,
      datatype: opts.datatype || "String",
      labels: { en: opts.label, cs: opts.label },
      iriLocal: opts.iriLocal,
    });
    changeSets.push(created.changeSet);
    const st = await this.kc.createStatement({
      packageCode: opts.packageCode,
      subject: opts.subjectId,
      property: created.data.id,
      value: { type: "String", string: opts.value },
      upsert: true,
    });
    changeSets.push(st.changeSet);
    // refresh schema cache for new property
    await this.schema.load(true);
    return { propertyId: created.data.id, changeSets };
  }

  async ensureOrgPackage(code: string): Promise<Entity | PackageLike> {
    try {
      return await this.kc.getPackage(code);
    } catch {
      const res = await this.kc.createPackage({
        code,
        lifecycle: "continuous",
        iriBase: `https://example.org/${code}/`,
        labels: { en: code, cs: code },
        dependencies: [{ dependsOnCode: "archimate-lite", versionRange: "^2.1.0" }],
      });
      return res.data;
    }
  }
}

type PackageLike = { code: string };

export function valueToDisplay(v: StatementValue): string {
  switch (v.type) {
    case "String":
      return v.string;
    case "EntityReference":
      return v.entityId;
    case "Boolean":
      return String(v.bool);
    case "Integer":
      return String(v.int64);
    case "LocalizedString":
      return v.langMap.cs || v.langMap.en || JSON.stringify(v.langMap);
    case "URI":
      return v.uri;
    default:
      return JSON.stringify(v);
  }
}
