import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  applyOpenExchangeOrphanActions,
  entityLabel,
  exportOpenExchange,
  formatAppError,
  getModelingPrimer,
  importOpenExchange,
  isAbstractArchimateClassLocal,
  isRelationshipClassLocal,
  isViewClassLocal,
  valueToDisplay,
  type OrphanAction,
  type OrphanCandidate,
  type PrimerLang,
} from "@itmap/archimate-core";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { resolveSafePath } from "./paths.js";

const ABSTRACT_EXTRA = new Set([
  "ArchiMateConcept",
  "ArchiMateElement",
  "ArchiMateRelationship",
  "ArchiMateViewConcept",
  "AllowedRelationship",
  "StringEnum",
  "ArchiMateLiteMeta",
  "ExchangeSpec",
  "ExchangeForeignElement",
  "ExchangeForeignRelationship",
]);

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err: unknown, context?: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: formatAppError(err, context) }],
  };
}

async function withTool<T>(
  ctx: AppContext,
  name: string,
  fn: () => Promise<T>,
): Promise<ReturnType<typeof jsonResult> | ReturnType<typeof errorResult>> {
  try {
    ctx.syncAuth();
    const data = await fn();
    return jsonResult(data);
  } catch (e) {
    return errorResult(e, name);
  }
}

function listElementTypes(ctx: AppContext) {
  const out: Array<{ local: string; label: string; iri?: string }> = [];
  for (const [local, ent] of ctx.schema.snapshot.classesByLocal) {
    if (ent.packageCode && ent.packageCode !== "archimate-lite") continue;
    if (ABSTRACT_EXTRA.has(local) || isAbstractArchimateClassLocal(local)) continue;
    if (isRelationshipClassLocal(local) || isViewClassLocal(local)) continue;
    if (
      local.startsWith("Ui") ||
      local.startsWith("Presentation") ||
      local.startsWith("RelationSlot")
    ) {
      continue;
    }
    out.push({
      local,
      label: entityLabel(ent),
      iri: ent.iri || ent.id,
    });
  }
  out.sort((a, b) => a.local.localeCompare(b.local));
  return out;
}

function listRelationshipTypes(ctx: AppContext) {
  const out: Array<{ local: string; label: string; iri?: string }> = [];
  for (const [local, ent] of ctx.schema.snapshot.classesByLocal) {
    if (!isRelationshipClassLocal(local)) continue;
    if (local.startsWith("ExchangeForeign")) continue;
    out.push({ local, label: entityLabel(ent), iri: ent.iri || ent.id });
  }
  out.sort((a, b) => a.local.localeCompare(b.local));
  return out;
}

export function createMcpServer(ctx: AppContext): McpServer {
  const server = new McpServer({
    name: "itmap-archimate",
    version: "0.1.0",
  });

  const readPrimer = async (lang: PrimerLang) => ({
    contents: [
      {
        uri: `modeling://primer/${lang}`,
        mimeType: "text/plain; charset=utf-8",
        text: getModelingPrimer(lang),
      },
    ],
  });

  server.registerResource(
    "modeling-primer",
    "modeling://primer",
    {
      title: "ArchiMate Lite modeling primer",
      description: "Short CS/EN primer (session language)",
      mimeType: "text/plain; charset=utf-8",
    },
    async () => ({
      contents: [
        {
          uri: "modeling://primer",
          mimeType: "text/plain; charset=utf-8",
          text: getModelingPrimer(ctx.session.lang),
        },
      ],
    }),
  );

  server.registerResource(
    "modeling-primer-cs",
    "modeling://primer/cs",
    {
      title: "Modeling primer (CS)",
      mimeType: "text/plain; charset=utf-8",
    },
    async () => readPrimer("cs"),
  );

  server.registerResource(
    "modeling-primer-en",
    "modeling://primer/en",
    {
      title: "Modeling primer (EN)",
      mimeType: "text/plain; charset=utf-8",
    },
    async () => readPrimer("en"),
  );

  // ── Session ──────────────────────────────────────────────────────────────

  server.registerTool(
    "get_session",
    {
      description: "Return current MCP session (orgPackage, lang, writeMode, active ChangeSet)",
      inputSchema: z.object({}),
    },
    async () =>
      withTool(ctx, "get_session", async () => ({
        ...ctx.session.getPublicView(),
        fileRoots: ctx.config.fileRoots,
        oeMaxBytes: ctx.config.oeMaxBytes,
        writeValidation: "strict",
      })),
  );

  server.registerTool(
    "configure_session",
    {
      description:
        "Update session lang and/or writeMode. orgPackage is immutable — attempts to change it are rejected. Optional forwardedToken for authMode=forward.",
      inputSchema: z.object({
        lang: z.enum(["cs", "en"]).optional(),
        writeMode: z.enum(["propose", "commit"]).optional(),
        orgPackage: z.string().optional().describe("Must match session orgPackage if provided"),
        forwardedToken: z
          .string()
          .optional()
          .describe("Bearer token for forward auth (HTTP Authorization also works)"),
      }),
    },
    async (args) =>
      withTool(ctx, "configure_session", async () => {
        if (args.forwardedToken !== undefined) {
          ctx.session.setForwardedToken(args.forwardedToken || null);
          ctx.syncAuth();
        }
        return ctx.session.configure({
          lang: args.lang,
          writeMode: args.writeMode,
          orgPackage: args.orgPackage,
        });
      }),
  );

  server.registerTool(
    "open_changeset",
    {
      description: "Open a Knowledge Core ChangeSet and bind it to this session",
      inputSchema: z.object({
        comment: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "open_changeset", async () => {
        if (ctx.session.activeChangeSetId) {
          return {
            changeSetId: ctx.session.activeChangeSetId,
            alreadyOpen: true,
          };
        }
        const actor = ctx.config.actor ? ` actor=${ctx.config.actor}` : "";
        const cs = await ctx.kc.openChangeSet({
          operationType: "mcp",
          comment: args.comment?.trim() || `mcp:open_changeset${actor}`,
        });
        ctx.kc.setManualChangeSet(cs.id);
        ctx.session.activeChangeSetId = cs.id;
        return { changeSet: cs, changeSetId: cs.id };
      }),
  );

  server.registerTool(
    "commit_changeset",
    {
      description:
        "Commit the active ChangeSet. In writeMode=propose, requires confirm_commit: true (explicit elevate). In writeMode=commit, no elevate flag needed.",
      inputSchema: z.object({
        confirm_commit: z
          .boolean()
          .optional()
          .describe("Required true when writeMode=propose"),
      }),
    },
    async (args) =>
      withTool(ctx, "commit_changeset", async () => {
        if (ctx.session.writeMode === "propose" && args.confirm_commit !== true) {
          throw new Error(
            "commit_changeset in writeMode=propose requires confirm_commit: true (user explicitly confirmed)",
          );
        }
        const id = ctx.session.activeChangeSetId || ctx.kc.getManualChangeSetId();
        if (!id) throw new Error("No active ChangeSet to commit");
        const changeSet = await ctx.kc.commitChangeSet(id);
        ctx.clearActiveChangeSet();
        return { changeSet };
      }),
  );

  server.registerTool(
    "cancel_changeset",
    {
      description: "Cancel the active ChangeSet",
      inputSchema: z.object({}),
    },
    async () =>
      withTool(ctx, "cancel_changeset", async () => {
        const id = ctx.session.activeChangeSetId || ctx.kc.getManualChangeSetId();
        if (!id) throw new Error("No active ChangeSet to cancel");
        const changeSet = await ctx.kc.cancelChangeSet(id);
        ctx.clearActiveChangeSet();
        return { changeSet };
      }),
  );

  // ── Schema ───────────────────────────────────────────────────────────────

  server.registerTool(
    "list_element_types",
    {
      description: "List concrete ArchiMate Lite element types (excludes abstracts / relationships / views)",
      inputSchema: z.object({}),
    },
    async () =>
      withTool(ctx, "list_element_types", async () => {
        await ctx.ensureSchemaLoaded();
        return { items: listElementTypes(ctx) };
      }),
  );

  server.registerTool(
    "list_relationship_types",
    {
      description: "List ArchiMate Lite relationship types",
      inputSchema: z.object({}),
    },
    async () =>
      withTool(ctx, "list_relationship_types", async () => {
        await ctx.ensureSchemaLoaded();
        return { items: listRelationshipTypes(ctx) };
      }),
  );

  server.registerTool(
    "get_allowed_relationships",
    {
      description: "Filter AllowedRelationship matrix by optional source/target type locals",
      inputSchema: z.object({
        sourceType: z.string().optional(),
        targetType: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "get_allowed_relationships", async () => {
        await ctx.ensureSchemaLoaded();
        let rows = ctx.schema.snapshot.allowed;
        if (args.sourceType) {
          rows = rows.filter((r) => r.sourceLocal === args.sourceType);
        }
        if (args.targetType) {
          rows = rows.filter((r) => r.targetLocal === args.targetType);
        }
        return {
          items: rows.map((r) => ({
            typeLocal: r.typeLocal,
            sourceLocal: r.sourceLocal,
            targetLocal: r.targetLocal,
          })),
          count: rows.length,
        };
      }),
  );

  server.registerTool(
    "get_property_schema",
    {
      description: "Property definitions (+ enums / constraints). Optional filter by class local.",
      inputSchema: z.object({
        typeLocal: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "get_property_schema", async () => {
        await ctx.ensureSchemaLoaded();
        const props = [...ctx.schema.snapshot.propertiesByLocal.values()];
        const filtered = args.typeLocal
          ? props.filter((p) => {
              const domains = p.constraints?.domainClasses || [];
              if (!domains.length) return true;
              const typeIri = ctx.schema.snapshot.classesByLocal.get(args.typeLocal!)?.id;
              if (!typeIri) return true;
              return domains.includes(typeIri) || domains.includes(args.typeLocal!);
            })
          : props;
        return {
          items: filtered.map((p) => ({
            local: p.iriLocal,
            label: entityLabel(p),
            datatype: p.datatype,
            enums: p.iriLocal ? ctx.schema.enumValues(p.iriLocal) : [],
            constraints: p.constraints,
          })),
        };
      }),
  );

  server.registerTool(
    "get_usage_guidance",
    {
      description: "usageGuidance / usageExamples statements for a class (by iriLocal or classLocal)",
      inputSchema: z.object({
        iriLocal: z.string().optional(),
        classLocal: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "get_usage_guidance", async () => {
        await ctx.ensureSchemaLoaded();
        const local = (args.classLocal || args.iriLocal || "").trim();
        if (!local) throw new Error("Provide iriLocal or classLocal");
        const cls = ctx.schema.snapshot.classesByLocal.get(local);
        if (!cls) throw new Error(`Unknown class local: ${local}`);
        const stmts = await ctx.kc.getStatements(cls.id);
        const guidanceProp = ctx.schema.tryPropertyIri("usageGuidance");
        const examplesProp = ctx.schema.tryPropertyIri("usageExamples");
        const pick = (propIri: string | undefined) =>
          stmts.items
            .filter((s) => propIri && s.property === propIri)
            .map((s) => valueToDisplay(s.value));
        return {
          classLocal: local,
          classId: cls.id,
          label: entityLabel(cls),
          usageGuidance: pick(guidanceProp),
          usageExamples: pick(examplesProp),
          descriptions: cls.descriptions,
        };
      }),
  );

  server.registerTool(
    "list_card_profiles",
    {
      description: "List PresentationProfile definitions from archimate-ui-cards",
      inputSchema: z.object({}),
    },
    async () =>
      withTool(ctx, "list_card_profiles", async () => {
        await ctx.ensureSchemaLoaded();
        const profiles = await ctx.cardsLoader.loadAllProfiles();
        return {
          items: profiles.map((p) => ({
            profileCode: p.profileCode,
            archimateElementType: p.archimateElementType,
            labelCs: p.labelCs,
            labelEn: p.labelEn,
            fieldCount: p.fieldProperties.length,
            slotCount: p.slots.length,
          })),
        };
      }),
  );

  server.registerTool(
    "get_card_profile",
    {
      description: "Get one card profile by profileCode",
      inputSchema: z.object({
        profileCode: z.string(),
      }),
    },
    async (args) =>
      withTool(ctx, "get_card_profile", async () => {
        await ctx.ensureSchemaLoaded();
        const profiles = await ctx.cardsLoader.loadAllProfiles();
        const profile = profiles.find((p) => p.profileCode === args.profileCode);
        if (!profile) throw new Error(`Unknown card profile: ${args.profileCode}`);
        return { profile };
      }),
  );

  // ── Read ─────────────────────────────────────────────────────────────────

  server.registerTool(
    "search_entities",
    {
      description: "Search entities in the session org package",
      inputSchema: z.object({
        q: z.string(),
        limit: z.number().int().positive().max(100).optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "search_entities", async () => {
        const page = await ctx.kc.listEntities({
          package: ctx.session.orgPackage,
          kind: "entity",
          q: args.q,
          limit: args.limit ?? 30,
        });
        return {
          items: (page.items || []).map(summarizeEntity),
          nextCursor: page.nextCursor,
        };
      }),
  );

  server.registerTool(
    "list_entities",
    {
      description: "List entities in the session org package (optional instanceOf filter)",
      inputSchema: z.object({
        instanceOfLocal: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
        cursor: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "list_entities", async () => {
        await ctx.ensureSchemaLoaded();
        const instanceOf = args.instanceOfLocal
          ? ctx.schema.classIri(args.instanceOfLocal)
          : undefined;
        const page = await ctx.kc.listEntities({
          package: ctx.session.orgPackage,
          kind: "entity",
          instanceOf,
          includeSubclasses: true,
          limit: args.limit ?? 50,
          cursor: args.cursor,
        });
        return {
          items: (page.items || []).map(summarizeEntity),
          nextCursor: page.nextCursor,
        };
      }),
  );

  server.registerTool(
    "get_entity",
    {
      description: "Get entity + key statements",
      inputSchema: z.object({ id: z.string() }),
    },
    async (args) =>
      withTool(ctx, "get_entity", async () => {
        await ctx.ensureSchemaLoaded();
        const entity = await ctx.kc.getEntity(args.id);
        const stmts = await ctx.kc.getStatements(args.id);
        return {
          entity: summarizeEntity(entity),
          statements: stmts.items.map((s) => ({
            id: s.id,
            property: ctx.schema.propertyLocal(s.property) || s.property,
            propertyIri: s.property,
            value: s.value,
            display: valueToDisplay(s.value),
            revisionNo: s.revisionNo,
          })),
        };
      }),
  );

  server.registerTool(
    "get_neighborhood",
    {
      description: "Graph neighborhood (depth 1–2)",
      inputSchema: z.object({
        id: z.string(),
        depth: z.number().int().min(1).max(2).optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "get_neighborhood", async () => {
        const depth = args.depth ?? 1;
        const graph = await ctx.kc.getGraph(args.id, depth);
        return {
          entity: summarizeEntity(graph.entity),
          outgoing: graph.outgoing,
          incoming: graph.incoming,
          neighbors: (graph.neighbors || []).map(summarizeEntity),
        };
      }),
  );

  server.registerTool(
    "get_card",
    {
      description: "Card projection for an entity (profile, fields, slots, empty recommended)",
      inputSchema: z.object({
        id: z.string(),
        expert: z.boolean().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "get_card", async () => {
        await ctx.ensureSchemaLoaded();
        const card = await ctx.cards.loadCard(args.id, { expert: args.expert });
        return { card };
      }),
  );

  server.registerTool(
    "validate_entity",
    {
      description:
        "Validate entity: KC validation endpoint when available + methodology findings from empty recommended card slots",
      inputSchema: z.object({ id: z.string() }),
    },
    async (args) =>
      withTool(ctx, "validate_entity", async () => {
        await ctx.ensureSchemaLoaded();
        const kcValidation = await ctx.kc.getEntityValidation(args.id);
        const card = await ctx.cards.loadCard(args.id);
        const methodology = card.slots
          .filter((s) => s.empty && s.slot.importance === "recommended")
          .map((s) => ({
            severity: "warning",
            code: "empty_recommended_slot",
            message: `Recommended slot „${s.slot.slotCode}“ (${s.slot.relationshipType}) is empty`,
            slotCode: s.slot.slotCode,
          }));
        return {
          entityId: args.id,
          kcValidation,
          methodology,
          note: kcValidation
            ? undefined
            : "KC /validation endpoint not available; methodology findings from card only",
        };
      }),
  );

  // ── Write ────────────────────────────────────────────────────────────────

  server.registerTool(
    "create_element",
    {
      description:
        "Create an ArchiMate element in the session package (open ChangeSet). Optional relationship to selectedId.",
      inputSchema: z.object({
        name: z.string(),
        classLocal: z.string(),
        description: z.string().optional(),
        props: z.record(z.string()).optional(),
        selectedId: z.string().optional(),
        relationshipType: z.string().optional(),
        relationshipDirection: z
          .enum(["from-new-to-selected", "from-selected-to-new"])
          .optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "create_element", async () => {
        await ctx.ensureSchemaLoaded();
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("create_element");
        const link =
          args.selectedId && args.relationshipType
            ? {
                typeLocal: args.relationshipType,
                otherId: args.selectedId,
                direction: args.relationshipDirection || ("from-selected-to-new" as const),
              }
            : undefined;
        const result = await ctx.model.createTypedElement({
          packageCode: ctx.session.orgPackage,
          classLocal: args.classLocal,
          name: args.name,
          descriptions: args.description
            ? { en: args.description, cs: args.description }
            : undefined,
          extraProps: args.props,
          link,
        });
        return {
          entity: summarizeEntity(result.entity),
          relationship: result.relationship ? summarizeEntity(result.relationship) : undefined,
          changeSetId: result.changeSet.id,
        };
      }),
  );

  server.registerTool(
    "create_relationship",
    {
      description: "Create a relationship (rejects if !isAllowed)",
      inputSchema: z.object({
        typeLocal: z.string(),
        sourceId: z.string(),
        targetId: z.string(),
        props: z.record(z.string()).optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "create_relationship", async () => {
        await ctx.ensureSchemaLoaded();
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("create_relationship");
        const entity = await ctx.model.createRelationship({
          packageCode: ctx.session.orgPackage,
          typeLocal: args.typeLocal,
          sourceId: args.sourceId,
          targetId: args.targetId,
          props: args.props,
        });
        return { entity: summarizeEntity(entity) };
      }),
  );

  server.registerTool(
    "set_property",
    {
      description: "Set/replace a string property on an entity",
      inputSchema: z.object({
        id: z.string(),
        propertyLocal: z.string(),
        value: z.string(),
      }),
    },
    async (args) =>
      withTool(ctx, "set_property", async () => {
        await ctx.ensureSchemaLoaded();
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("set_property");
        const existingPage = await ctx.kc.getStatements(
          args.id,
          ctx.schema.propertyIri(args.propertyLocal),
        );
        const existing = existingPage.items[0];
        const changeSet = await ctx.model.replaceStringProperty({
          packageCode: ctx.session.orgPackage,
          subject: args.id,
          propertyLocal: args.propertyLocal,
          newValue: args.value,
          existingStatement: existing,
        });
        return { changeSetId: changeSet?.id ?? null, noop: changeSet === null };
      }),
  );

  server.registerTool(
    "clear_property",
    {
      description: "Clear a property by deprecating its statement(s)",
      inputSchema: z.object({
        id: z.string(),
        propertyLocal: z.string(),
      }),
    },
    async (args) =>
      withTool(ctx, "clear_property", async () => {
        await ctx.ensureSchemaLoaded();
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("clear_property");
        const propIri = ctx.schema.propertyIri(args.propertyLocal);
        const page = await ctx.kc.getStatements(args.id, propIri);
        const changeSets = [];
        for (const st of page.items) {
          changeSets.push(await ctx.model.deprecatePropertyStatement(st));
        }
        return { deprecated: page.items.length, changeSetIds: changeSets.map((c) => c.id) };
      }),
  );

  server.registerTool(
    "deprecate_entity",
    {
      description: "Deprecate an entity in the session package",
      inputSchema: z.object({
        id: z.string(),
        expectedRevision: z.number().int().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "deprecate_entity", async () => {
        const entity = await ctx.kc.getEntity(args.id);
        if (entity.packageCode) ctx.assertOrgPackageWritable(entity.packageCode);
        else ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("deprecate_entity");
        const res = await ctx.kc.deprecateEntity(args.id, {
          expectedRevision: args.expectedRevision,
        });
        return { entity: summarizeEntity(res.data), changeSetId: res.changeSet.id };
      }),
  );

  // ── Views ────────────────────────────────────────────────────────────────

  server.registerTool(
    "list_views",
    {
      description: "List DiagramView entities in the session package",
      inputSchema: z.object({}),
    },
    async () =>
      withTool(ctx, "list_views", async () => {
        await ctx.ensureSchemaLoaded();
        const items = await ctx.views.listViews(ctx.session.orgPackage);
        return { items: items.map(summarizeEntity) };
      }),
  );

  server.registerTool(
    "get_view",
    {
      description: "Get DiagramView with nodes and connections",
      inputSchema: z.object({ id: z.string() }),
    },
    async (args) =>
      withTool(ctx, "get_view", async () => {
        await ctx.ensureSchemaLoaded();
        const detail = await ctx.views.getView(args.id);
        return {
          view: summarizeEntity(detail.view),
          nodes: detail.nodes.map(summarizeEntity),
          connections: detail.connections.map(summarizeEntity),
        };
      }),
  );

  server.registerTool(
    "create_view",
    {
      description: "Create a DiagramView",
      inputSchema: z.object({
        name: z.string(),
        viewpoint: z.string().optional(),
        description: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "create_view", async () => {
        await ctx.ensureSchemaLoaded();
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("create_view");
        const res = await ctx.views.createView({
          packageCode: ctx.session.orgPackage,
          name: args.name,
          viewpoint: args.viewpoint,
          descriptions: args.description
            ? { en: args.description, cs: args.description }
            : undefined,
        });
        return { entity: summarizeEntity(res.entity), changeSetId: res.changeSet.id };
      }),
  );

  server.registerTool(
    "add_view_node",
    {
      description: "Add a ViewNode to a DiagramView",
      inputSchema: z.object({
        viewId: z.string(),
        elementRef: z.string().optional(),
        bounds: z
          .object({
            x: z.number().optional(),
            y: z.number().optional(),
            w: z.number().optional(),
            h: z.number().optional(),
          })
          .optional(),
        parentNodeId: z.string().optional(),
        styleJson: z.string().optional(),
        nodeKind: z.enum(["element", "container", "label"]).optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "add_view_node", async () => {
        await ctx.ensureSchemaLoaded();
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("add_view_node");
        const res = await ctx.views.addViewNode({
          packageCode: ctx.session.orgPackage,
          viewId: args.viewId,
          elementRef: args.elementRef,
          bounds: args.bounds,
          parentNodeId: args.parentNodeId,
          styleJson: args.styleJson,
          nodeKind: args.nodeKind,
        });
        return { entity: summarizeEntity(res.entity), changeSetId: res.changeSet.id };
      }),
  );

  server.registerTool(
    "update_view_node",
    {
      description: "Update a ViewNode",
      inputSchema: z.object({
        nodeId: z.string(),
        elementRef: z.string().nullable().optional(),
        bounds: z
          .object({
            x: z.number().optional(),
            y: z.number().optional(),
            w: z.number().optional(),
            h: z.number().optional(),
          })
          .optional(),
        parentNodeId: z.string().nullable().optional(),
        styleJson: z.string().nullable().optional(),
        nodeKind: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "update_view_node", async () => {
        await ctx.ensureSchemaLoaded();
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("update_view_node");
        const res = await ctx.views.updateViewNode({
          packageCode: ctx.session.orgPackage,
          nodeId: args.nodeId,
          elementRef: args.elementRef,
          bounds: args.bounds,
          parentNodeId: args.parentNodeId,
          styleJson: args.styleJson,
          nodeKind: args.nodeKind,
        });
        return {
          entity: res.entity ? summarizeEntity(res.entity) : undefined,
          changeSetId: res.changeSet.id,
        };
      }),
  );

  server.registerTool(
    "add_view_connection",
    {
      description: "Add a ViewConnection between nodes",
      inputSchema: z.object({
        viewId: z.string(),
        sourceNodeId: z.string(),
        targetNodeId: z.string(),
        relationshipRef: z.string().optional(),
        bendpointsJson: z.string().optional(),
        styleJson: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "add_view_connection", async () => {
        await ctx.ensureSchemaLoaded();
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("add_view_connection");
        const res = await ctx.views.addViewConnection({
          packageCode: ctx.session.orgPackage,
          viewId: args.viewId,
          sourceNodeId: args.sourceNodeId,
          targetNodeId: args.targetNodeId,
          relationshipRef: args.relationshipRef,
          bendpointsJson: args.bendpointsJson,
          styleJson: args.styleJson,
        });
        return { entity: summarizeEntity(res.entity), changeSetId: res.changeSet.id };
      }),
  );

  server.registerTool(
    "update_view_connection",
    {
      description: "Update a ViewConnection",
      inputSchema: z.object({
        connectionId: z.string(),
        sourceNodeId: z.string().optional(),
        targetNodeId: z.string().optional(),
        relationshipRef: z.string().nullable().optional(),
        bendpointsJson: z.string().nullable().optional(),
        styleJson: z.string().nullable().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "update_view_connection", async () => {
        await ctx.ensureSchemaLoaded();
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("update_view_connection");
        const res = await ctx.views.updateViewConnection({
          packageCode: ctx.session.orgPackage,
          connectionId: args.connectionId,
          sourceNodeId: args.sourceNodeId,
          targetNodeId: args.targetNodeId,
          relationshipRef: args.relationshipRef,
          bendpointsJson: args.bendpointsJson,
          styleJson: args.styleJson,
        });
        return {
          entity: res.entity ? summarizeEntity(res.entity) : undefined,
          changeSetId: res.changeSet.id,
        };
      }),
  );

  server.registerTool(
    "remove_view_node",
    {
      description: "Deprecate a ViewNode",
      inputSchema: z.object({
        id: z.string(),
        expectedRevision: z.number().int().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "remove_view_node", async () => {
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("remove_view_node");
        const changeSet = await ctx.views.removeViewEntity(args.id, args.expectedRevision);
        return { changeSetId: changeSet.id };
      }),
  );

  server.registerTool(
    "remove_view_connection",
    {
      description: "Deprecate a ViewConnection",
      inputSchema: z.object({
        id: z.string(),
        expectedRevision: z.number().int().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "remove_view_connection", async () => {
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("remove_view_connection");
        const changeSet = await ctx.views.removeViewEntity(args.id, args.expectedRevision);
        return { changeSetId: changeSet.id };
      }),
  );

  server.registerTool(
    "remove_view",
    {
      description: "Deprecate a DiagramView",
      inputSchema: z.object({
        id: z.string(),
        expectedRevision: z.number().int().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "remove_view", async () => {
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("remove_view");
        const changeSet = await ctx.views.removeViewEntity(args.id, args.expectedRevision);
        return { changeSetId: changeSet.id };
      }),
  );

  // ── Open Exchange ────────────────────────────────────────────────────────

  server.registerTool(
    "import_open_exchange",
    {
      description: `Import ArchiMate Open Exchange XML into session package (max ${ctx.config.oeMaxBytes} bytes). Provide either xml string or path (under ITMAP_MCP_FILE_ROOTS). Always opens a ChangeSet; commits only when writeMode=commit.`,
      inputSchema: z.object({
        xml: z.string().optional().describe("Open Exchange XML string"),
        path: z.string().optional().describe("Absolute path under ITMAP_MCP_FILE_ROOTS"),
      }),
    },
    async (args) =>
      withTool(ctx, "import_open_exchange", async () => {
        const hasXml = Boolean(args.xml?.length);
        const hasPath = Boolean(args.path?.length);
        if (hasXml === hasPath) {
          throw new Error("Provide exactly one of xml or path");
        }
        let xml = args.xml;
        let sourcePath: string | undefined;
        if (args.path) {
          sourcePath = resolveSafePath(args.path, ctx.config.fileRoots);
          xml = fs.readFileSync(sourcePath, "utf8");
        }
        if (!xml) throw new Error("Provide xml or path");

        const bytes = Buffer.byteLength(xml, "utf8");
        if (bytes > ctx.config.oeMaxBytes) {
          throw new Error(
            `Open Exchange XML too large (${bytes} bytes > ITMAP_MCP_OE_MAX_BYTES=${ctx.config.oeMaxBytes})`,
          );
        }
        await ctx.ensureSchemaLoaded();
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        const changeSetId = await ctx.ensureOpenChangeSet("import_open_exchange");
        const result = await importOpenExchange({
          xml,
          packageCode: ctx.session.orgPackage,
          kc: ctx.kc,
          schema: ctx.schema,
        });
        let committed = false;
        if (ctx.session.writeMode === "commit") {
          await ctx.kc.commitChangeSet(changeSetId);
          ctx.clearActiveChangeSet();
          committed = true;
        }
        return {
          created: result.created,
          updated: result.updated,
          warnings: result.warnings,
          orphans: result.orphans,
          xmlIdentifierCount: result.xmlIdentifiers?.size ?? 0,
          sourcePath: sourcePath ?? null,
          changeSetId: committed ? null : changeSetId,
          committed,
          writeMode: ctx.session.writeMode,
        };
      }),
  );

  server.registerTool(
    "export_open_exchange",
    {
      description:
        "Export session package as Open Exchange XML. Without path returns xml string; with path writes under ITMAP_MCP_FILE_ROOTS and returns path + counts.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe("Optional absolute output path under ITMAP_MCP_FILE_ROOTS"),
      }),
    },
    async (args) =>
      withTool(ctx, "export_open_exchange", async () => {
        await ctx.ensureSchemaLoaded();
        const result = await exportOpenExchange({
          packageCode: ctx.session.orgPackage,
          kc: ctx.kc,
          schema: ctx.schema,
        });
        const bytes = Buffer.byteLength(result.xml, "utf8");
        if (args.path) {
          const outPath = resolveSafePath(args.path, ctx.config.fileRoots);
          fs.writeFileSync(outPath, result.xml, "utf8");
          return {
            path: outPath,
            elementCount: result.elementCount,
            relationshipCount: result.relationshipCount,
            viewCount: result.viewCount,
            bytes,
          };
        }
        if (bytes > ctx.config.oeMaxBytes) {
          throw new Error(
            `Export XML too large for string response (${bytes} bytes > ITMAP_MCP_OE_MAX_BYTES=${ctx.config.oeMaxBytes}). Pass path= to write a file under ITMAP_MCP_FILE_ROOTS.`,
          );
        }
        return {
          xml: result.xml,
          elementCount: result.elementCount,
          relationshipCount: result.relationshipCount,
          viewCount: result.viewCount,
          bytes,
        };
      }),
  );

  server.registerTool(
    "apply_open_exchange_orphans",
    {
      description: "Apply orphan actions after Open Exchange import (deprecate / keep / etc.)",
      inputSchema: z.object({
        actions: z.array(
          z.object({
            orphan: z.object({
              entityId: z.string(),
              iriLocal: z.string(),
              label: z.string(),
              kind: z.enum([
                "element",
                "relationship",
                "view",
                "viewNode",
                "viewConnection",
                "other",
              ]),
              incomingRefCount: z.number().optional(),
            }),
            action: z.enum(["deprecate", "keep", "delete"]),
          }),
        ),
      }),
    },
    async (args) =>
      withTool(ctx, "apply_open_exchange_orphans", async () => {
        ctx.assertOrgPackageWritable(ctx.session.orgPackage);
        await ctx.ensureOpenChangeSet("apply_open_exchange_orphans");
        const mapped = args.actions.map((a) => ({
          orphan: a.orphan as OrphanCandidate,
          action: a.action as OrphanAction,
        }));
        const result = await applyOpenExchangeOrphanActions(mapped, ctx.kc);
        return result;
      }),
  );

  return server;
}

function summarizeEntity(e: {
  id: string;
  labels?: Record<string, string>;
  iriLocal?: string;
  packageCode?: string;
  status?: string;
  revisionNo?: number;
  effectiveClasses?: string[];
}) {
  return {
    id: e.id,
    label: e.labels ? entityLabel(e as never) : e.iriLocal || e.id,
    iriLocal: e.iriLocal,
    packageCode: e.packageCode,
    status: e.status,
    revisionNo: e.revisionNo,
    effectiveClasses: e.effectiveClasses,
  };
}
