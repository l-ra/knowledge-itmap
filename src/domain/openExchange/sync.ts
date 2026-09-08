import type { KcClient } from "@/kc/client";
import type { SchemaResolver } from "@/kc/schema";
import type { Entity, StatementValue } from "@/kc/types";
import { formatAppError, logAppError } from "@/kc/errors";
import { exchangeAliasIri, iriLocalFromIdentifier, isExchangeManagedAlias } from "./identity";
import {
  opaqueToExchangeProperties,
  parseBendpoints,
  parseOpaqueProperties,
  parseStyle,
  propertiesToOpaque,
  serializeBendpoints,
  serializeOpaqueProperties,
  serializeStyle,
} from "./opaque";
import { collectXmlIdentifiers } from "./parseXml";
import { findOrphans } from "./reconcile";
import {
  archiLayerFolderName,
  exportXsiType,
  isRelationshipClassLocal,
  isViewClassLocal,
  resolveElementType,
  resolveRelationshipType,
} from "./typeMap";
import type {
  ExchangeElement,
  ExchangeModel,
  ExchangeOrgItem,
  ExchangeRelationship,
  ExchangeView,
  ExchangeViewConnection,
  ExchangeViewNode,
  ImportResult,
  ImportWarning,
  OrphanAction,
  OrphanCandidate,
} from "./types";

export type ProgressFn = (msg: string, current: number, total: number) => void;

function langMap(text?: { lang?: string; text: string }): Record<string, string> | undefined {
  if (!text?.text) return undefined;
  const lang = text.lang || "en";
  return { [lang]: text.text, en: text.text };
}

function primaryLabel(labels?: Record<string, string>): string | undefined {
  if (!labels) return undefined;
  return labels.cs || labels.en || Object.values(labels).find(Boolean);
}

async function upsertString(
  kc: KcClient,
  schema: SchemaResolver,
  packageCode: string,
  subject: string,
  propLocal: string,
  value: string | undefined,
) {
  if (value == null || value === "") return;
  const prop = schema.tryPropertyIri(propLocal);
  if (!prop) return;
  await kc.createStatement({
    packageCode,
    subject,
    property: prop,
    value: { type: "String", string: value },
    upsert: true,
  });
}

async function upsertBool(
  kc: KcClient,
  schema: SchemaResolver,
  packageCode: string,
  subject: string,
  propLocal: string,
  value: boolean,
) {
  const prop = schema.tryPropertyIri(propLocal);
  if (!prop) return;
  await kc.createStatement({
    packageCode,
    subject,
    property: prop,
    value: { type: "Boolean", bool: value },
    upsert: true,
  });
}

async function upsertInt(
  kc: KcClient,
  schema: SchemaResolver,
  packageCode: string,
  subject: string,
  propLocal: string,
  value: number | undefined,
) {
  if (value == null || !Number.isFinite(value)) return;
  const prop = schema.tryPropertyIri(propLocal);
  if (!prop) return;
  await kc.createStatement({
    packageCode,
    subject,
    property: prop,
    value: { type: "Integer", int64: Math.trunc(value) },
    upsert: true,
  });
}

async function upsertRef(
  kc: KcClient,
  schema: SchemaResolver,
  packageCode: string,
  subject: string,
  propLocal: string,
  entityId: string | undefined,
) {
  if (!entityId) return;
  const prop = schema.tryPropertyIri(propLocal);
  if (!prop) return;
  await kc.createStatement({
    packageCode,
    subject,
    property: prop,
    value: { type: "EntityReference", entityId },
    upsert: true,
  });
}

function stmtString(stmts: { property: string; value: StatementValue }[], propIri: string | undefined): string | undefined {
  if (!propIri) return undefined;
  const s = stmts.find((x) => x.property === propIri);
  if (!s || s.value.type !== "String") return undefined;
  return s.value.string;
}

function stmtInt(stmts: { property: string; value: StatementValue }[], propIri: string | undefined): number | undefined {
  if (!propIri) return undefined;
  const s = stmts.find((x) => x.property === propIri);
  if (!s || s.value.type !== "Integer") return undefined;
  return s.value.int64;
}

function stmtRef(stmts: { property: string; value: StatementValue }[], propIri: string | undefined): string | undefined {
  if (!propIri) return undefined;
  const s = stmts.find((x) => x.property === propIri);
  if (!s || s.value.type !== "EntityReference") return undefined;
  return s.value.entityId;
}

async function ensureEntity(
  kc: KcClient,
  packageCode: string,
  identifier: string,
  labels: Record<string, string>,
  descriptions: Record<string, string> | undefined,
  existingByLocal: Map<string, Entity>,
): Promise<{ entity: Entity; created: boolean }> {
  const iriLocal = iriLocalFromIdentifier(identifier);
  const existing = existingByLocal.get(iriLocal);
  if (existing) {
    try {
      await kc.patchEntity(existing.id, {
        labels,
        descriptions,
        expectedRevision: existing.revisionNo,
      });
    } catch {
      /* keep existing labels if revision conflict */
    }
    const refreshed = await kc.getEntity(existing.id);
    existingByLocal.set(iriLocal, refreshed);
    return { entity: refreshed, created: false };
  }
  const created = await kc.createEntity({
    packageCode,
    labels,
    descriptions,
    iriLocal,
  });
  const entity = created.data ?? (created as unknown as Entity);
  if (!entity?.id) {
    throw new Error(
      `createEntity nevrátilo entitu (iriLocal=${iriLocal}). Odpověď: ${JSON.stringify(created).slice(0, 300)}`,
    );
  }
  existingByLocal.set(iriLocal, entity);
  return { entity, created: true };
}

async function markExchangeManaged(
  kc: KcClient,
  schema: SchemaResolver,
  packageCode: string,
  entity: Entity,
  identifier: string,
) {
  const ent = await kc.getEntity(entity.id);
  await kc.setEntityIriAliases(entity.id, [
    ...(ent.iriAliases || []).filter((a) => a.kind !== "imported"),
    { iri: exchangeAliasIri(identifier), kind: "imported" },
  ]);
  await upsertBool(kc, schema, packageCode, entity.id, "exchangeManaged", true);
}

/** Known Lite string properties that may appear as Exchange property keys. */
function mapKnownProperty(
  schema: SchemaResolver,
  key: string,
): string | undefined {
  if (schema.tryPropertyIri(key)) return key;
  return undefined;
}

export async function importExchangeModel(opts: {
  kc: KcClient;
  schema: SchemaResolver;
  packageCode: string;
  model: ExchangeModel;
  onProgress?: ProgressFn;
}): Promise<ImportResult> {
  const { kc, schema, packageCode, model } = opts;
  const warnings: ImportWarning[] = [];
  const snap = schema.snapshot;

  const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      logAppError(e, label);
      throw new Error(formatAppError(e, label));
    }
  };

  // Fail fast if package missing
  await step(`Kontrola package „${packageCode}“`, () => kc.getPackage(packageCode));

  const existing = await step(`Načtení entit package „${packageCode}“`, () =>
    kc.listAllEntities({ package: packageCode, kind: "entity" }),
  );
  const existingByLocal = new Map<string, Entity>();
  for (const e of existing) {
    if (e.iriLocal) existingByLocal.set(e.iriLocal, e);
  }

  let created = 0;
  let updated = 0;
  const idToEntityId = new Map<string, string>();

  const total =
    model.elements.length +
    model.relationships.length +
    model.views.length +
    model.views.reduce((n, v) => n + v.nodes.length + v.connections.length, 0);
  let done = 0;
  const tick = (msg: string) => {
    done += 1;
    opts.onProgress?.(msg, done, Math.max(total, 1));
  };

  await step(`Open Exchange import do package „${packageCode}“`, async () => {
    await kc.runLogicalChangeSet(
      { operationType: "openExchangeImport", comment: `Open Exchange import → ${packageCode}` },
      async () => {
      // Elements
      for (const el of model.elements) {
        const resolved = resolveElementType(schema, el.xsiType, warnings, el.identifier);
        const labels = langMap(el.name) || { en: el.identifier };
        const descriptions = langMap(el.documentation);
        const { entity, created: wasCreated } = await ensureEntity(
          kc,
          packageCode,
          el.identifier,
          labels,
          descriptions,
          existingByLocal,
        );
        if (wasCreated) created += 1;
        else updated += 1;
        idToEntityId.set(el.identifier, entity.id);

        await kc.createStatement({
          packageCode,
          subject: entity.id,
          property: snap.instanceOfProperty,
          value: { type: "EntityReference", entityId: resolved.classIri },
          upsert: true,
        });

        if (resolved.foreign || resolved.exchangeXsiType) {
          await upsertString(
            kc,
            schema,
            packageCode,
            entity.id,
            "exchangeXsiType",
            resolved.exchangeXsiType || el.xsiType,
          );
        }

        const unknownProps: ExchangeElement["properties"] = [];
        for (const p of el.properties) {
          const local = mapKnownProperty(schema, p.key);
          if (local) {
            await upsertString(kc, schema, packageCode, entity.id, local, p.value);
          } else {
            unknownProps.push(p);
            warnings.push({
              level: "info",
              code: "opaque_property",
              message: `Opaque property "${p.key}" on ${el.identifier}`,
              identifier: el.identifier,
            });
          }
        }
        const opaque = propertiesToOpaque(unknownProps, el.extraAttrs);
        if (opaque.length) {
          await upsertString(
            kc,
            schema,
            packageCode,
            entity.id,
            "exchangeOpaqueProperties",
            serializeOpaqueProperties(opaque),
          );
        }
        // Safe default for elements
        if (schema.tryPropertyIri("modelingDepth")) {
          await upsertString(kc, schema, packageCode, entity.id, "modelingDepth", "catalog");
        }

        await markExchangeManaged(kc, schema, packageCode, entity, el.identifier);
        tick(`element ${el.identifier}`);
      }

      // Relationships
      for (const rel of model.relationships) {
        const resolved = resolveRelationshipType(schema, rel.xsiType, warnings, rel.identifier);
        const labels = langMap(rel.name) || { en: rel.identifier };
        const descriptions = langMap(rel.documentation);
        const { entity, created: wasCreated } = await ensureEntity(
          kc,
          packageCode,
          rel.identifier,
          labels,
          descriptions,
          existingByLocal,
        );
        if (wasCreated) created += 1;
        else updated += 1;
        idToEntityId.set(rel.identifier, entity.id);

        await kc.createStatement({
          packageCode,
          subject: entity.id,
          property: snap.instanceOfProperty,
          value: { type: "EntityReference", entityId: resolved.classIri },
          upsert: true,
        });

        const srcId = idToEntityId.get(rel.source);
        const tgtId = idToEntityId.get(rel.target);
        if (!srcId || !tgtId) {
          warnings.push({
            level: "warning",
            code: "missing_endpoint",
            message: `Relationship ${rel.identifier} missing source/target entity`,
            identifier: rel.identifier,
          });
        } else {
          await upsertRef(kc, schema, packageCode, entity.id, "relSource", srcId);
          await upsertRef(kc, schema, packageCode, entity.id, "relTarget", tgtId);
        }

        if (resolved.foreign) {
          await upsertString(kc, schema, packageCode, entity.id, "exchangeXsiType", rel.xsiType);
        }

        const unknownProps: typeof rel.properties = [];
        for (const p of rel.properties) {
          const local = mapKnownProperty(schema, p.key);
          if (local) await upsertString(kc, schema, packageCode, entity.id, local, p.value);
          else unknownProps.push(p);
        }
        const opaque = propertiesToOpaque(unknownProps, rel.extraAttrs);
        if (opaque.length) {
          await upsertString(
            kc,
            schema,
            packageCode,
            entity.id,
            "exchangeOpaqueProperties",
            serializeOpaqueProperties(opaque),
          );
        }

        await markExchangeManaged(kc, schema, packageCode, entity, rel.identifier);
        tick(`relationship ${rel.identifier}`);
      }

      // Views
      for (const view of model.views) {
        const labels = langMap(view.name) || { en: view.identifier };
        const { entity: viewEnt, created: wasCreated } = await ensureEntity(
          kc,
          packageCode,
          view.identifier,
          labels,
          undefined,
          existingByLocal,
        );
        if (wasCreated) created += 1;
        else updated += 1;
        idToEntityId.set(view.identifier, viewEnt.id);

        await kc.createStatement({
          packageCode,
          subject: viewEnt.id,
          property: snap.instanceOfProperty,
          value: { type: "EntityReference", entityId: schema.classIri("DiagramView") },
          upsert: true,
        });
        await markExchangeManaged(kc, schema, packageCode, viewEnt, view.identifier);
        tick(`view ${view.identifier}`);

        const importNode = async (node: ExchangeViewNode, parentId?: string) => {
          const { entity: nodeEnt, created: nodeCreated } = await ensureEntity(
            kc,
            packageCode,
            node.identifier,
            { en: node.identifier },
            undefined,
            existingByLocal,
          );
          if (nodeCreated) created += 1;
          else updated += 1;
          idToEntityId.set(node.identifier, nodeEnt.id);

          await kc.createStatement({
            packageCode,
            subject: nodeEnt.id,
            property: snap.instanceOfProperty,
            value: { type: "EntityReference", entityId: schema.classIri("ViewNode") },
            upsert: true,
          });
          await upsertRef(kc, schema, packageCode, nodeEnt.id, "inView", viewEnt.id);
          await upsertString(kc, schema, packageCode, nodeEnt.id, "nodeKind", "element");
          if (node.elementRef && idToEntityId.get(node.elementRef)) {
            await upsertRef(kc, schema, packageCode, nodeEnt.id, "elementRef", idToEntityId.get(node.elementRef));
          }
          await upsertInt(kc, schema, packageCode, nodeEnt.id, "boundsX", node.x);
          await upsertInt(kc, schema, packageCode, nodeEnt.id, "boundsY", node.y);
          await upsertInt(kc, schema, packageCode, nodeEnt.id, "boundsW", node.w);
          await upsertInt(kc, schema, packageCode, nodeEnt.id, "boundsH", node.h);
          const styleJson = serializeStyle(node.style);
          if (styleJson) await upsertString(kc, schema, packageCode, nodeEnt.id, "style", styleJson);
          if (parentId) await upsertRef(kc, schema, packageCode, nodeEnt.id, "parentNode", parentId);
          if (node.opaqueFragment) {
            await upsertString(kc, schema, packageCode, nodeEnt.id, "exchangeOpaqueFragment", node.opaqueFragment);
          }
          await markExchangeManaged(kc, schema, packageCode, nodeEnt, node.identifier);
          tick(`node ${node.identifier}`);
          for (const ch of node.children) await importNode(ch, nodeEnt.id);
        };

        for (const n of view.nodes) await importNode(n);

        for (const conn of view.connections) {
          const { entity: connEnt, created: connCreated } = await ensureEntity(
            kc,
            packageCode,
            conn.identifier,
            { en: conn.identifier },
            undefined,
            existingByLocal,
          );
          if (connCreated) created += 1;
          else updated += 1;
          idToEntityId.set(conn.identifier, connEnt.id);

          await kc.createStatement({
            packageCode,
            subject: connEnt.id,
            property: snap.instanceOfProperty,
            value: { type: "EntityReference", entityId: schema.classIri("ViewConnection") },
            upsert: true,
          });
          await upsertRef(kc, schema, packageCode, connEnt.id, "inView", viewEnt.id);
          if (conn.relationshipRef && idToEntityId.get(conn.relationshipRef)) {
            await upsertRef(
              kc,
              schema,
              packageCode,
              connEnt.id,
              "relationshipRef",
              idToEntityId.get(conn.relationshipRef),
            );
          }
          await upsertRef(kc, schema, packageCode, connEnt.id, "sourceNode", idToEntityId.get(conn.source));
          await upsertRef(kc, schema, packageCode, connEnt.id, "targetNode", idToEntityId.get(conn.target));
          if (conn.bendpoints.length) {
            await upsertString(
              kc,
              schema,
              packageCode,
              connEnt.id,
              "bendpoints",
              serializeBendpoints(conn.bendpoints),
            );
          }
          const styleJson = serializeStyle(conn.style);
          if (styleJson) await upsertString(kc, schema, packageCode, connEnt.id, "style", styleJson);
          await markExchangeManaged(kc, schema, packageCode, connEnt, conn.identifier);
          tick(`connection ${conn.identifier}`);
        }
      }

      // Organizations hint is optional; export regenerates folders from package contents.
      },
    );
  });

  const after = await kc.listAllEntities({ package: packageCode, kind: "entity" });
  const xmlIdentifiers = collectXmlIdentifiers(model);
  xmlIdentifiers.delete(model.identifier);

  // Exchange-managed = imported aliases OR just-touched identifiers from this import
  const managedIds = new Set<string>();
  for (const e of after) {
    if (isExchangeManagedAlias(e.iriAliases)) managedIds.add(e.id);
    else if (e.iriLocal && xmlIdentifiers.has(e.iriLocal)) managedIds.add(e.id);
  }

  const classLocalOf = (_entityId: string, effective?: string[]) => {
    if (!effective?.length) return undefined;
    for (const iri of effective) {
      const local = schema.classLocal(iri);
      if (local) return local;
    }
    return undefined;
  };

  const orphans = findOrphans({
    packageEntities: after,
    xmlIdentifiers,
    classLocalOf,
    exchangeManagedIds: managedIds,
  });

  return { created, updated, warnings, orphans, xmlIdentifiers };
}

export async function applyOrphanActions(opts: {
  kc: KcClient;
  actions: Array<{ orphan: OrphanCandidate; action: OrphanAction }>;
}): Promise<{ ok: number; errors: Array<{ entityId: string; message: string }> }> {
  let ok = 0;
  const errors: Array<{ entityId: string; message: string }> = [];
  await opts.kc.runLogicalChangeSet(
    { operationType: "openExchangeOrphans", comment: "Open Exchange orphan review" },
    async () => {
      for (const { orphan, action } of opts.actions) {
        if (action === "keep") continue;
        try {
          if (action === "deprecate") await opts.kc.deprecateEntity(orphan.entityId);
          else await opts.kc.deleteEntity(orphan.entityId);
          ok += 1;
        } catch (e) {
          errors.push({
            entityId: orphan.entityId,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    },
  );
  return { ok, errors };
}

async function loadEntityBundle(
  kc: KcClient,
  schema: SchemaResolver,
  entity: Entity,
): Promise<{
  entity: Entity;
  classLocal?: string;
  stmts: Awaited<ReturnType<KcClient["getStatements"]>>["items"];
}> {
  let ent = entity;
  if (!ent.effectiveClasses?.length || !ent.iriAliases) {
    try {
      ent = await kc.getEntity(entity.id);
    } catch {
      /* keep */
    }
  }
  const stmts = (await kc.getStatements(entity.id)).items;
  let classLocal: string | undefined;
  for (const iri of ent.effectiveClasses || []) {
    const local = schema.classLocal(iri);
    if (local && local !== "ArchiMateConcept" && local !== "ArchiMateElement" && local !== "ArchiMateRelationship") {
      classLocal = local;
      break;
    }
    if (local && !classLocal) classLocal = local;
  }
  // instanceOf fallback
  if (!classLocal) {
    const io = stmts.find((s) => s.property === schema.snapshot.instanceOfProperty);
    if (io?.value.type === "EntityReference") {
      classLocal = schema.classLocal(io.value.entityId);
    }
  }
  return { entity: ent, classLocal, stmts };
}

function entityIdToIdentifier(map: Map<string, string>, entityId: string | undefined): string | undefined {
  if (!entityId) return undefined;
  return map.get(entityId);
}

export async function exportExchangeModel(opts: {
  kc: KcClient;
  schema: SchemaResolver;
  packageCode: string;
  onProgress?: ProgressFn;
}): Promise<ExchangeModel> {
  const { kc, schema, packageCode } = opts;
  const entities = await kc.listAllEntities({ package: packageCode, kind: "entity" });
  const pkg = await kc.getPackage(packageCode);

  const elements: ExchangeElement[] = [];
  const relationships: ExchangeRelationship[] = [];
  const views: ExchangeView[] = [];
  const idToIdentifier = new Map<string, string>();
  const elementFolderById = new Map<string, string>();
  const viewNodesByView = new Map<string, ExchangeViewNode[]>();
  const viewConnsByView = new Map<string, ExchangeViewConnection[]>();
  const viewMeta = new Map<string, { identifier: string; name?: { lang?: string; text: string } }>();

  const layerByClassLocal = new Map<string, string>();
  // Heuristic layers from class name prefixes when statements unavailable
  for (const local of schema.snapshot.classesByLocal.keys()) {
    if (local.startsWith("Business")) layerByClassLocal.set(local, "business");
    else if (local.startsWith("Application") || local === "DataObject") layerByClassLocal.set(local, "application");
    else if (
      ["Node", "Device", "SystemSoftware", "Artifact", "CommunicationNetwork", "Path", "Facility", "Location", "TechnologyService", "TechnologyInterface"].includes(
        local,
      )
    ) {
      layerByClassLocal.set(local, "technology");
    }
  }

  let i = 0;
  for (const raw of entities) {
    if (raw.iriLocal === ".package") continue;
    if (raw.status && raw.status !== "active") continue;
    i += 1;
    opts.onProgress?.(`export ${raw.iriLocal || raw.id}`, i, entities.length);

    const { entity, classLocal, stmts } = await loadEntityBundle(kc, schema, raw);
    if (!classLocal || !entity.iriLocal) continue;
    if (
      classLocal === "AllowedRelationship" ||
      classLocal === "ExchangeSpec" ||
      classLocal === "ArchiMateLiteMeta" ||
      classLocal === "Package"
    ) {
      continue;
    }

    const identifier = entity.iriLocal;
    idToIdentifier.set(entity.id, identifier);

    const xsiTypeProp = schema.tryPropertyIri("exchangeXsiType");
    const opaqueProp = schema.tryPropertyIri("exchangeOpaqueProperties");
    const fragmentProp = schema.tryPropertyIri("exchangeOpaqueFragment");
    const xsiFromStmt = stmtString(stmts, xsiTypeProp);
    const opaqueRaw = stmtString(stmts, opaqueProp);
    const opaque = opaqueToExchangeProperties(parseOpaqueProperties(opaqueRaw));

    if (isRelationshipClassLocal(classLocal)) {
      const src = stmtRef(stmts, schema.tryPropertyIri("relSource"));
      const tgt = stmtRef(stmts, schema.tryPropertyIri("relTarget"));
      relationships.push({
        identifier,
        xsiType: exportXsiType({ classLocal, exchangeXsiTypeStmt: xsiFromStmt }),
        source: entityIdToIdentifier(idToIdentifier, src) || src || "",
        target: entityIdToIdentifier(idToIdentifier, tgt) || tgt || "",
        name: primaryLabel(entity.labels) ? { text: primaryLabel(entity.labels)! } : undefined,
        documentation: primaryLabel(entity.descriptions)
          ? { text: primaryLabel(entity.descriptions)! }
          : undefined,
        properties: opaque.properties,
        extraAttrs: opaque.extraAttrs,
      });
      continue;
    }

    if (classLocal === "DiagramView") {
      viewMeta.set(entity.id, {
        identifier,
        name: primaryLabel(entity.labels) ? { text: primaryLabel(entity.labels)! } : undefined,
      });
      if (!viewNodesByView.has(entity.id)) viewNodesByView.set(entity.id, []);
      if (!viewConnsByView.has(entity.id)) viewConnsByView.set(entity.id, []);
      continue;
    }

    if (classLocal === "ViewNode") {
      const inView = stmtRef(stmts, schema.tryPropertyIri("inView"));
      const elementRef = stmtRef(stmts, schema.tryPropertyIri("elementRef"));
      const node: ExchangeViewNode = {
        identifier,
        xsiType: "Element",
        elementRef: entityIdToIdentifier(idToIdentifier, elementRef) || elementRef,
        x: stmtInt(stmts, schema.tryPropertyIri("boundsX")),
        y: stmtInt(stmts, schema.tryPropertyIri("boundsY")),
        w: stmtInt(stmts, schema.tryPropertyIri("boundsW")),
        h: stmtInt(stmts, schema.tryPropertyIri("boundsH")),
        style: parseStyle(stmtString(stmts, schema.tryPropertyIri("style"))),
        children: [],
        opaqueFragment: stmtString(stmts, fragmentProp),
      };
      if (inView) {
        const list = viewNodesByView.get(inView) || [];
        list.push(node);
        viewNodesByView.set(inView, list);
      }
      continue;
    }

    if (classLocal === "ViewConnection") {
      const inView = stmtRef(stmts, schema.tryPropertyIri("inView"));
      const relRef = stmtRef(stmts, schema.tryPropertyIri("relationshipRef"));
      const src = stmtRef(stmts, schema.tryPropertyIri("sourceNode"));
      const tgt = stmtRef(stmts, schema.tryPropertyIri("targetNode"));
      const conn: ExchangeViewConnection = {
        identifier,
        xsiType: "Relationship",
        relationshipRef: entityIdToIdentifier(idToIdentifier, relRef) || relRef,
        source: entityIdToIdentifier(idToIdentifier, src) || src || "",
        target: entityIdToIdentifier(idToIdentifier, tgt) || tgt || "",
        bendpoints: parseBendpoints(stmtString(stmts, schema.tryPropertyIri("bendpoints"))),
        style: parseStyle(stmtString(stmts, schema.tryPropertyIri("style"))),
      };
      if (inView) {
        const list = viewConnsByView.get(inView) || [];
        list.push(conn);
        viewConnsByView.set(inView, list);
      }
      continue;
    }

    if (isViewClassLocal(classLocal)) continue;

    // Element (including foreign)
    elements.push({
      identifier,
      xsiType: exportXsiType({ classLocal, exchangeXsiTypeStmt: xsiFromStmt }),
      name: primaryLabel(entity.labels) ? { text: primaryLabel(entity.labels)! } : undefined,
      documentation: primaryLabel(entity.descriptions)
        ? { text: primaryLabel(entity.descriptions)! }
        : undefined,
      properties: opaque.properties,
      extraAttrs: opaque.extraAttrs,
    });
    elementFolderById.set(
      identifier,
      archiLayerFolderName(layerByClassLocal.get(classLocal)),
    );
  }

  // Fix relationship source/target identifiers (second pass — map now complete)
  for (const rel of relationships) {
    // If still looks like IRI, try map
    if (rel.source.includes("://") && idToIdentifier.has(rel.source)) {
      rel.source = idToIdentifier.get(rel.source)!;
    }
    if (rel.target.includes("://") && idToIdentifier.has(rel.target)) {
      rel.target = idToIdentifier.get(rel.target)!;
    }
  }
  for (const [, nodes] of viewNodesByView) {
    for (const n of nodes) {
      if (n.elementRef?.includes("://") && idToIdentifier.has(n.elementRef)) {
        n.elementRef = idToIdentifier.get(n.elementRef);
      }
    }
  }
  for (const [, conns] of viewConnsByView) {
    for (const c of conns) {
      if (c.relationshipRef?.includes("://") && idToIdentifier.has(c.relationshipRef)) {
        c.relationshipRef = idToIdentifier.get(c.relationshipRef)!;
      }
      if (c.source.includes("://") && idToIdentifier.has(c.source)) c.source = idToIdentifier.get(c.source)!;
      if (c.target.includes("://") && idToIdentifier.has(c.target)) c.target = idToIdentifier.get(c.target)!;
    }
  }

  for (const [viewId, meta] of viewMeta) {
    views.push({
      identifier: meta.identifier,
      xsiType: "Diagram",
      name: meta.name,
      nodes: viewNodesByView.get(viewId) || [],
      connections: viewConnsByView.get(viewId) || [],
    });
  }

  // Organizations from layers
  const folders = new Map<string, string[]>();
  for (const el of elements) {
    const folder = elementFolderById.get(el.identifier) || "Other";
    const list = folders.get(folder) || [];
    list.push(el.identifier);
    folders.set(folder, list);
  }
  const organizations: ExchangeOrgItem[] = [];
  for (const [label, ids] of folders) {
    organizations.push({
      label: { lang: "en", text: label },
      children: ids.map((id) => ({ identifierRef: id, children: [] })),
    });
  }
  if (relationships.length) {
    organizations.push({
      label: { lang: "en", text: "Relations" },
      children: relationships.map((r) => ({ identifierRef: r.identifier, children: [] })),
    });
  }
  if (views.length) {
    organizations.push({
      label: { lang: "en", text: "Views" },
      children: views.map((v) => ({ identifierRef: v.identifier, children: [] })),
    });
  }

  const modelName =
    primaryLabel(pkg.labels) ||
    packageCode;

  return {
    identifier: `model-${packageCode}`,
    name: { lang: "en", text: modelName },
    elements,
    relationships,
    organizations,
    views,
  };
}
