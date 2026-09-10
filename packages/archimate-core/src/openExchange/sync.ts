import type { KcClient } from "../kcClient";
import type { SchemaResolver } from "../schema";
import type { Entity, StatementValue } from "../types";
import { formatAppError, logAppError } from "../errors";
import {
  applyBatchResults,
  createOpBuffer,
  entityRef,
  pushEnsureEntity,
  pushExchangeManaged,
  pushInstanceOf,
  pushRefStatement,
  pushStringStatement,
  shouldFlush,
} from "./batchOps";
import { isExchangeManagedAlias } from "./identity";
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
  mostSpecificClassLocal,
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
        const buf = createOpBuffer(existingByLocal);
        const managedProp = schema.tryPropertyIri("exchangeManaged") || undefined;

        const flush = async (label: string) => {
          if (!buf.ops.length) return;
          const n = buf.ops.length;
          opts.onProgress?.(`batch ${label} (${n} ops)`, done, Math.max(total, 1));
          const res = await kc.applyChangeSetOperations({
            operationType: "openExchangeImport",
            operations: buf.ops.splice(0, buf.ops.length),
          });
          applyBatchResults(buf, res.data?.results || []);
        };

        const enqueue = async (approxOps: number, build: () => void) => {
          if (shouldFlush(buf, approxOps)) await flush("chunk");
          build();
        };

        const subjectOf = (identifier: string) => entityRef(identifier, buf.idMap.get(identifier));

        // Elements
        for (const el of model.elements) {
          await enqueue(12, () => {
            const resolved = resolveElementType(schema, el.xsiType, warnings, el.identifier);
            const labels = langMap(el.name) || { en: el.identifier };
            const descriptions = langMap(el.documentation);
            const { created: wasCreated } = pushEnsureEntity(
              buf,
              packageCode,
              el.identifier,
              labels,
              descriptions,
            );
            if (wasCreated) created += 1;
            else updated += 1;
            const subj = subjectOf(el.identifier);
            pushInstanceOf(buf, packageCode, subj, snap.instanceOfProperty, resolved.classIri);
            if (resolved.foreign || resolved.exchangeXsiType) {
              const p = schema.tryPropertyIri("exchangeXsiType");
              if (p) pushStringStatement(buf, packageCode, subj, p, resolved.exchangeXsiType || el.xsiType);
            }
            const unknownProps: ExchangeElement["properties"] = [];
            for (const p of el.properties) {
              const local = mapKnownProperty(schema, p.key);
              if (local) {
                const iri = schema.tryPropertyIri(local);
                if (iri) pushStringStatement(buf, packageCode, subj, iri, p.value);
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
              const p = schema.tryPropertyIri("exchangeOpaqueProperties");
              if (p) pushStringStatement(buf, packageCode, subj, p, serializeOpaqueProperties(opaque));
            }
            const depth = schema.tryPropertyIri("modelingDepth");
            if (depth) pushStringStatement(buf, packageCode, subj, depth, "catalog");
            pushExchangeManaged(buf, packageCode, subj, el.identifier, managedProp);
          });
          tick(`element ${el.identifier}`);
        }
        await flush("elements");

        // Relationships
        for (const rel of model.relationships) {
          await enqueue(14, () => {
            const resolved = resolveRelationshipType(schema, rel.xsiType, warnings, rel.identifier);
            const labels = langMap(rel.name) || { en: rel.identifier };
            const descriptions = langMap(rel.documentation);
            const { created: wasCreated } = pushEnsureEntity(
              buf,
              packageCode,
              rel.identifier,
              labels,
              descriptions,
            );
            if (wasCreated) created += 1;
            else updated += 1;
            const subj = subjectOf(rel.identifier);
            pushInstanceOf(buf, packageCode, subj, snap.instanceOfProperty, resolved.classIri);
            const srcId = buf.idMap.get(rel.source);
            const tgtId = buf.idMap.get(rel.target);
            if (!srcId || !tgtId) {
              warnings.push({
                level: "warning",
                code: "missing_endpoint",
                message: `Relationship ${rel.identifier} missing source/target entity`,
                identifier: rel.identifier,
              });
            } else {
              const ps = schema.tryPropertyIri("relSource");
              const pt = schema.tryPropertyIri("relTarget");
              if (ps) pushRefStatement(buf, packageCode, subj, ps, srcId);
              if (pt) pushRefStatement(buf, packageCode, subj, pt, tgtId);
            }
            if (resolved.foreign) {
              const p = schema.tryPropertyIri("exchangeXsiType");
              if (p) pushStringStatement(buf, packageCode, subj, p, rel.xsiType);
            }
            const unknownProps: typeof rel.properties = [];
            for (const p of rel.properties) {
              const local = mapKnownProperty(schema, p.key);
              if (local) {
                const iri = schema.tryPropertyIri(local);
                if (iri) pushStringStatement(buf, packageCode, subj, iri, p.value);
              } else unknownProps.push(p);
            }
            const opaque = propertiesToOpaque(unknownProps, rel.extraAttrs);
            if (opaque.length) {
              const p = schema.tryPropertyIri("exchangeOpaqueProperties");
              if (p) pushStringStatement(buf, packageCode, subj, p, serializeOpaqueProperties(opaque));
            }
            pushExchangeManaged(buf, packageCode, subj, rel.identifier, managedProp);
          });
          tick(`relationship ${rel.identifier}`);
        }
        await flush("relationships");

        // Views + nodes + connections
        for (const view of model.views) {
          await enqueue(8, () => {
            const labels = langMap(view.name) || { en: view.identifier };
            const { created: wasCreated } = pushEnsureEntity(buf, packageCode, view.identifier, labels);
            if (wasCreated) created += 1;
            else updated += 1;
            const subj = subjectOf(view.identifier);
            pushInstanceOf(buf, packageCode, subj, snap.instanceOfProperty, schema.classIri("DiagramView"));
            pushExchangeManaged(buf, packageCode, subj, view.identifier, managedProp);
          });
          tick(`view ${view.identifier}`);

          const importNode = async (node: ExchangeViewNode, parentIdentifier?: string) => {
            await enqueue(16, () => {
              const { created: nodeCreated } = pushEnsureEntity(buf, packageCode, node.identifier, {
                en: node.identifier,
              });
              if (nodeCreated) created += 1;
              else updated += 1;
              const subj = subjectOf(node.identifier);
              const viewSubj = subjectOf(view.identifier);
              pushInstanceOf(buf, packageCode, subj, snap.instanceOfProperty, schema.classIri("ViewNode"));
              const inView = schema.tryPropertyIri("inView");
              if (inView) pushRefStatement(buf, packageCode, subj, inView, viewSubj);
              const nodeKind = schema.tryPropertyIri("nodeKind");
              if (nodeKind) pushStringStatement(buf, packageCode, subj, nodeKind, "element");
              if (node.elementRef && buf.idMap.get(node.elementRef)) {
                const er = schema.tryPropertyIri("elementRef");
                if (er) pushRefStatement(buf, packageCode, subj, er, buf.idMap.get(node.elementRef));
              }
              for (const [local, val] of [
                ["boundsX", node.x],
                ["boundsY", node.y],
                ["boundsW", node.w],
                ["boundsH", node.h],
              ] as const) {
                const p = schema.tryPropertyIri(local);
                if (p && val != null) {
                  buf.ops.push({
                    op: "createStatement",
                    packageCode,
                    subject: subj,
                    property: p,
                    value: { type: "Integer", int64: val },
                    upsert: true,
                  });
                }
              }
              const styleJson = serializeStyle(node.style);
              const styleP = schema.tryPropertyIri("style");
              if (styleJson && styleP) pushStringStatement(buf, packageCode, subj, styleP, styleJson);
              if (parentIdentifier) {
                const pp = schema.tryPropertyIri("parentNode");
                if (pp) pushRefStatement(buf, packageCode, subj, pp, subjectOf(parentIdentifier));
              }
              if (node.opaqueFragment) {
                const op = schema.tryPropertyIri("exchangeOpaqueFragment");
                if (op) pushStringStatement(buf, packageCode, subj, op, node.opaqueFragment);
              }
              pushExchangeManaged(buf, packageCode, subj, node.identifier, managedProp);
            });
            tick(`node ${node.identifier}`);
            for (const ch of node.children) await importNode(ch, node.identifier);
          };

          for (const n of view.nodes) await importNode(n);
          await flush(`view-nodes ${view.identifier}`);

          for (const conn of view.connections) {
            await enqueue(14, () => {
              const { created: connCreated } = pushEnsureEntity(buf, packageCode, conn.identifier, {
                en: conn.identifier,
              });
              if (connCreated) created += 1;
              else updated += 1;
              const subj = subjectOf(conn.identifier);
              pushInstanceOf(
                buf,
                packageCode,
                subj,
                snap.instanceOfProperty,
                schema.classIri("ViewConnection"),
              );
              const inView = schema.tryPropertyIri("inView");
              if (inView) pushRefStatement(buf, packageCode, subj, inView, subjectOf(view.identifier));
              if (conn.relationshipRef && buf.idMap.get(conn.relationshipRef)) {
                const rp = schema.tryPropertyIri("relationshipRef");
                if (rp) pushRefStatement(buf, packageCode, subj, rp, buf.idMap.get(conn.relationshipRef));
              }
              const sn = schema.tryPropertyIri("sourceNode");
              const tn = schema.tryPropertyIri("targetNode");
              if (sn) pushRefStatement(buf, packageCode, subj, sn, buf.idMap.get(conn.source));
              if (tn) pushRefStatement(buf, packageCode, subj, tn, buf.idMap.get(conn.target));
              if (conn.bendpoints.length) {
                const bp = schema.tryPropertyIri("bendpoints");
                if (bp) pushStringStatement(buf, packageCode, subj, bp, serializeBendpoints(conn.bendpoints));
              }
              const styleJson = serializeStyle(conn.style);
              const styleP = schema.tryPropertyIri("style");
              if (styleJson && styleP) pushStringStatement(buf, packageCode, subj, styleP, styleJson);
              pushExchangeManaged(buf, packageCode, subj, conn.identifier, managedProp);
            });
            tick(`connection ${conn.identifier}`);
          }
          await flush(`view-conns ${view.identifier}`);
        }

        await flush("final");
        for (const [k, v] of buf.idMap) idToEntityId.set(k, v);
      },
    );
  });

  const after = await kc.listAllEntities({ package: packageCode, kind: "entity" });
  for (const e of after) {
    if (e.iriLocal) idToEntityId.set(e.iriLocal, e.id);
  }
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
  const fromEffective: string[] = [];
  for (const iri of ent.effectiveClasses || []) {
    const local = schema.classLocal(iri);
    if (local) fromEffective.push(local);
  }
  let classLocal = mostSpecificClassLocal(fromEffective);
  // instanceOf fallback
  if (!classLocal) {
    const fromInstanceOf: string[] = [];
    for (const s of stmts) {
      if (s.property !== schema.snapshot.instanceOfProperty) continue;
      if (s.value.type !== "EntityReference") continue;
      const local = schema.classLocal(s.value.entityId);
      if (local) fromInstanceOf.push(local);
    }
    classLocal = mostSpecificClassLocal(fromInstanceOf);
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
