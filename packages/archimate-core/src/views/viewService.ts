import type { KcClient } from "../kcClient";
import type { SchemaResolver } from "../schema";
import type { ChangeSet, Entity, LangMap } from "../types";

export type ViewBounds = {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

export type CreateViewInput = {
  packageCode: string;
  name: string;
  labels?: LangMap;
  descriptions?: LangMap;
  iriLocal?: string;
  /** Optional viewpoint label stored as string property when present in schema. */
  viewpoint?: string;
};

export type AddViewNodeInput = {
  packageCode: string;
  viewId: string;
  elementRef?: string;
  bounds?: ViewBounds;
  parentNodeId?: string;
  styleJson?: string;
  nodeKind?: "element" | "container" | "label";
  labels?: LangMap;
  iriLocal?: string;
};

export type UpdateViewNodeInput = {
  packageCode: string;
  nodeId: string;
  elementRef?: string | null;
  bounds?: ViewBounds;
  parentNodeId?: string | null;
  styleJson?: string | null;
  nodeKind?: string;
  labels?: LangMap;
  expectedRevision?: number;
};

export type AddViewConnectionInput = {
  packageCode: string;
  viewId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipRef?: string;
  bendpointsJson?: string;
  styleJson?: string;
  labels?: LangMap;
  iriLocal?: string;
};

export type UpdateViewConnectionInput = {
  packageCode: string;
  connectionId: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  relationshipRef?: string | null;
  bendpointsJson?: string | null;
  styleJson?: string | null;
  labels?: LangMap;
  expectedRevision?: number;
};

export type ViewDetail = {
  view: Entity;
  nodes: Entity[];
  connections: Entity[];
};

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * CRUD helpers for DiagramView / ViewNode / ViewConnection.
 * Does not modify architectural elements or relationships — presentation only.
 */
export class ViewService {
  constructor(
    private kc: KcClient,
    private schema: SchemaResolver,
  ) {}

  async listViews(packageCode: string): Promise<Entity[]> {
    const viewClass = this.schema.classIri("DiagramView");
    return this.kc.listAllEntities({
      package: packageCode,
      kind: "entity",
      instanceOf: viewClass,
      includeSubclasses: true,
    });
  }

  async getView(viewId: string): Promise<ViewDetail> {
    const view = await this.kc.getEntity(viewId);
    const inView = this.schema.tryPropertyIri("inView");
    if (!inView) {
      return { view, nodes: [], connections: [] };
    }
    const incoming = await this.kc.getIncoming(viewId, inView);
    const members = await Promise.all(
      incoming.items.map(async (s) => {
        try {
          return await this.kc.getEntity(s.subject);
        } catch {
          return null;
        }
      }),
    );
    const nodes: Entity[] = [];
    const connections: Entity[] = [];
    const nodeIri = this.schema.classIri("ViewNode");
    const connIri = this.schema.classIri("ViewConnection");
    for (const e of members) {
      if (!e) continue;
      const classes = e.effectiveClasses || [];
      if (classes.includes(nodeIri) || (await this.isInstanceOf(e.id, nodeIri))) {
        nodes.push(e);
      } else if (classes.includes(connIri) || (await this.isInstanceOf(e.id, connIri))) {
        connections.push(e);
      }
    }
    return { view, nodes, connections };
  }

  async createView(input: CreateViewInput): Promise<{ entity: Entity; changeSet: ChangeSet }> {
    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "createView", comment: input.name },
      async () => {
        const snap = this.schema.snapshot;
        const iriLocal = input.iriLocal || `view-${slugify(input.name)}-${Date.now().toString(36)}`;
        const labels = input.labels || { en: input.name, cs: input.name };
        const created = await this.kc.createEntity({
          packageCode: input.packageCode,
          labels,
          descriptions: input.descriptions,
          iriLocal,
        });
        await this.kc.createStatement({
          packageCode: input.packageCode,
          subject: created.data.id,
          property: snap.instanceOfProperty,
          value: { type: "EntityReference", entityId: this.schema.classIri("DiagramView") },
          upsert: true,
        });
        if (input.viewpoint) {
          const vp = this.schema.tryPropertyIri("viewpoint");
          if (vp) {
            await this.kc.createStatement({
              packageCode: input.packageCode,
              subject: created.data.id,
              property: vp,
              value: { type: "String", string: input.viewpoint },
              upsert: true,
            });
          }
        }
        return { entity: created.data };
      },
    );
    return { ...result, changeSet };
  }

  async addViewNode(
    input: AddViewNodeInput,
  ): Promise<{ entity: Entity; changeSet: ChangeSet }> {
    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "addViewNode", comment: input.elementRef || "node" },
      async () => {
        const snap = this.schema.snapshot;
        const iriLocal =
          input.iriLocal || `vnode-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const created = await this.kc.createEntity({
          packageCode: input.packageCode,
          labels: input.labels || { en: iriLocal },
          iriLocal,
        });
        const subj = created.data.id;
        await this.kc.createStatement({
          packageCode: input.packageCode,
          subject: subj,
          property: snap.instanceOfProperty,
          value: { type: "EntityReference", entityId: this.schema.classIri("ViewNode") },
          upsert: true,
        });
        await this.setRef(input.packageCode, subj, "inView", input.viewId);
        await this.setString(input.packageCode, subj, "nodeKind", input.nodeKind || "element");
        if (input.elementRef) {
          await this.setRef(input.packageCode, subj, "elementRef", input.elementRef);
        }
        await this.applyBounds(input.packageCode, subj, input.bounds);
        if (input.parentNodeId) {
          await this.setRef(input.packageCode, subj, "parentNode", input.parentNodeId);
        }
        if (input.styleJson) {
          await this.setString(input.packageCode, subj, "style", input.styleJson);
        }
        return { entity: created.data };
      },
    );
    return { ...result, changeSet };
  }

  async updateViewNode(
    input: UpdateViewNodeInput,
  ): Promise<{ entity?: Entity; changeSet: ChangeSet }> {
    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "updateViewNode", comment: input.nodeId },
      async () => {
        if (input.labels) {
          await this.kc.patchEntity(input.nodeId, {
            labels: input.labels,
            expectedRevision: input.expectedRevision,
          });
        }
        if (input.elementRef === null) {
          await this.deprecateProp(input.nodeId, "elementRef");
        } else if (input.elementRef) {
          await this.setRef(input.packageCode, input.nodeId, "elementRef", input.elementRef);
        }
        if (input.bounds) {
          await this.applyBounds(input.packageCode, input.nodeId, input.bounds);
        }
        if (input.parentNodeId === null) {
          await this.deprecateProp(input.nodeId, "parentNode");
        } else if (input.parentNodeId) {
          await this.setRef(input.packageCode, input.nodeId, "parentNode", input.parentNodeId);
        }
        if (input.styleJson === null) {
          await this.deprecateProp(input.nodeId, "style");
        } else if (input.styleJson !== undefined) {
          await this.setString(input.packageCode, input.nodeId, "style", input.styleJson);
        }
        if (input.nodeKind) {
          await this.setString(input.packageCode, input.nodeId, "nodeKind", input.nodeKind);
        }
        return { entity: await this.kc.getEntity(input.nodeId) };
      },
    );
    return { ...result, changeSet };
  }

  async addViewConnection(
    input: AddViewConnectionInput,
  ): Promise<{ entity: Entity; changeSet: ChangeSet }> {
    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "addViewConnection", comment: input.relationshipRef || "conn" },
      async () => {
        const snap = this.schema.snapshot;
        const iriLocal =
          input.iriLocal || `vconn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const created = await this.kc.createEntity({
          packageCode: input.packageCode,
          labels: input.labels || { en: iriLocal },
          iriLocal,
        });
        const subj = created.data.id;
        await this.kc.createStatement({
          packageCode: input.packageCode,
          subject: subj,
          property: snap.instanceOfProperty,
          value: { type: "EntityReference", entityId: this.schema.classIri("ViewConnection") },
          upsert: true,
        });
        await this.setRef(input.packageCode, subj, "inView", input.viewId);
        await this.setRef(input.packageCode, subj, "sourceNode", input.sourceNodeId);
        await this.setRef(input.packageCode, subj, "targetNode", input.targetNodeId);
        if (input.relationshipRef) {
          await this.setRef(input.packageCode, subj, "relationshipRef", input.relationshipRef);
        }
        if (input.bendpointsJson) {
          await this.setString(input.packageCode, subj, "bendpoints", input.bendpointsJson);
        }
        if (input.styleJson) {
          await this.setString(input.packageCode, subj, "style", input.styleJson);
        }
        return { entity: created.data };
      },
    );
    return { ...result, changeSet };
  }

  async updateViewConnection(
    input: UpdateViewConnectionInput,
  ): Promise<{ entity?: Entity; changeSet: ChangeSet }> {
    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "updateViewConnection", comment: input.connectionId },
      async () => {
        if (input.labels) {
          await this.kc.patchEntity(input.connectionId, {
            labels: input.labels,
            expectedRevision: input.expectedRevision,
          });
        }
        if (input.sourceNodeId) {
          await this.setRef(input.packageCode, input.connectionId, "sourceNode", input.sourceNodeId);
        }
        if (input.targetNodeId) {
          await this.setRef(input.packageCode, input.connectionId, "targetNode", input.targetNodeId);
        }
        if (input.relationshipRef === null) {
          await this.deprecateProp(input.connectionId, "relationshipRef");
        } else if (input.relationshipRef) {
          await this.setRef(
            input.packageCode,
            input.connectionId,
            "relationshipRef",
            input.relationshipRef,
          );
        }
        if (input.bendpointsJson === null) {
          await this.deprecateProp(input.connectionId, "bendpoints");
        } else if (input.bendpointsJson !== undefined) {
          await this.setString(
            input.packageCode,
            input.connectionId,
            "bendpoints",
            input.bendpointsJson,
          );
        }
        if (input.styleJson === null) {
          await this.deprecateProp(input.connectionId, "style");
        } else if (input.styleJson !== undefined) {
          await this.setString(input.packageCode, input.connectionId, "style", input.styleJson);
        }
        return { entity: await this.kc.getEntity(input.connectionId) };
      },
    );
    return { ...result, changeSet };
  }

  async removeViewEntity(
    entityId: string,
    expectedRevision?: number,
  ): Promise<ChangeSet> {
    const res = await this.kc.deprecateEntity(entityId, { expectedRevision });
    return res.changeSet;
  }

  private async isInstanceOf(entityId: string, classIri: string): Promise<boolean> {
    const snap = this.schema.snapshot;
    const stmts = await this.kc.getStatements(entityId, snap.instanceOfProperty);
    return stmts.items.some(
      (s) => s.value.type === "EntityReference" && s.value.entityId === classIri,
    );
  }

  private async setRef(
    packageCode: string,
    subject: string,
    propertyLocal: string,
    entityId: string,
  ): Promise<void> {
    const prop = this.schema.tryPropertyIri(propertyLocal);
    if (!prop) return;
    await this.kc.createStatement({
      packageCode,
      subject,
      property: prop,
      value: { type: "EntityReference", entityId },
      upsert: true,
    });
  }

  private async setString(
    packageCode: string,
    subject: string,
    propertyLocal: string,
    value: string,
  ): Promise<void> {
    const prop = this.schema.tryPropertyIri(propertyLocal);
    if (!prop) return;
    await this.kc.createStatement({
      packageCode,
      subject,
      property: prop,
      value: { type: "String", string: value },
      upsert: true,
    });
  }

  private async setInt(
    packageCode: string,
    subject: string,
    propertyLocal: string,
    value: number,
  ): Promise<void> {
    const prop = this.schema.tryPropertyIri(propertyLocal);
    if (!prop) return;
    await this.kc.createStatement({
      packageCode,
      subject,
      property: prop,
      value: { type: "Integer", int64: value },
      upsert: true,
    });
  }

  private async applyBounds(
    packageCode: string,
    subject: string,
    bounds?: ViewBounds,
  ): Promise<void> {
    if (!bounds) return;
    if (bounds.x != null) await this.setInt(packageCode, subject, "boundsX", bounds.x);
    if (bounds.y != null) await this.setInt(packageCode, subject, "boundsY", bounds.y);
    if (bounds.w != null) await this.setInt(packageCode, subject, "boundsW", bounds.w);
    if (bounds.h != null) await this.setInt(packageCode, subject, "boundsH", bounds.h);
  }

  private async deprecateProp(subject: string, propertyLocal: string): Promise<void> {
    const prop = this.schema.tryPropertyIri(propertyLocal);
    if (!prop) return;
    const page = await this.kc.getStatements(subject, prop);
    for (const st of page.items) {
      await this.kc.deprecateStatement(st.id, { expectedRevision: st.revisionNo });
    }
  }
}
