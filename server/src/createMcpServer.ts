import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  APPLY_OPERATIONS_SOFT_LIMIT,
  applyOpenExchangeOrphanActions,
  entityLabel,
  exportOpenExchange,
  getModelingPrimer,
  importOpenExchange,
  isAbstractArchimateClassLocal,
  isRelationshipClassLocal,
  isViewClassLocal,
  structuredAppError,
  valueToDisplay,
  type GraphApplyOperation,
  type OrphanAction,
  type OrphanCandidate,
  type PrimerLang,
} from "@itmap/archimate-core";
import { z } from "zod";
import type { AppContext } from "./context.js";
import {
  enrichListedEntity,
  resolveNeighborhoodLinks,
  summarizeEntity,
} from "./entityHelpers.js";
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
  const structured = structuredAppError(err, context);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(structured, null, 2) }],
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
      description:
        "Return MCP session: workingPackage, write allowlist, approved write packages, lang, writeMode, active ChangeSet",
      inputSchema: z.object({}),
    },
    async () =>
      withTool(ctx, "get_session", async () => ({
        ...ctx.session.getPublicView(),
        fileRoots: ctx.config.fileRoots,
        oeMaxBytes: ctx.config.oeMaxBytes,
        writeValidation: "strict",
        pid: ctx.pid,
        startedAt: ctx.startedAt,
        readPolicy: "unrestricted",
        writePolicy: "allowlist_and_session_approval",
      })),
  );

  server.registerTool(
    "configure_session",
    {
      description:
        "Update lang, writeMode, and/or workingPackage (must already be session-approved). Optional forwardedToken for authMode=forward. Deprecated: orgPackage aliases workingPackage.",
      inputSchema: z.object({
        lang: z.enum(["cs", "en"]).optional(),
        writeMode: z.enum(["propose", "commit"]).optional(),
        workingPackage: z
          .string()
          .nullable()
          .optional()
          .describe("Must be in approvedWritePackages"),
        orgPackage: z
          .string()
          .nullable()
          .optional()
          .describe("Deprecated alias for workingPackage"),
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
          workingPackage: args.workingPackage,
          orgPackage: args.orgPackage,
        });
      }),
  );

  server.registerTool(
    "get_access_token",
    {
      description:
        "Return the Bearer access token this MCP session uses against Knowledge Core (for copy into another app). service→ITMAP_KC_TOKEN; forward→session/Authorization token. Requires confirm: true (sensitive).",
      inputSchema: z.object({
        confirm: z
          .boolean()
          .describe("Must be true — explicit disclosure of credentials"),
      }),
    },
    async (args) =>
      withTool(ctx, "get_access_token", async () => {
        if (args.confirm !== true) {
          throw new Error("get_access_token requires confirm: true");
        }
        return ctx.getAccessToken();
      }),
  );

  server.registerTool(
    "approve_write_package",
    {
      description:
        "Approve a package for write in this session. Package must be in config write allowlist. Requires confirm: true.",
      inputSchema: z.object({
        packageCode: z.string(),
        confirm: z
          .boolean()
          .describe("Must be true — explicit per-session write approval"),
      }),
    },
    async (args) =>
      withTool(ctx, "approve_write_package", async () => {
        if (args.confirm !== true) {
          throw new Error("approve_write_package requires confirm: true");
        }
        ctx.approveWritePackage(args.packageCode);
        return ctx.session.getPublicView();
      }),
  );

  server.registerTool(
    "revoke_write_package",
    {
      description: "Revoke session write approval for a package",
      inputSchema: z.object({
        packageCode: z.string(),
      }),
    },
    async (args) =>
      withTool(ctx, "revoke_write_package", async () => {
        ctx.session.revokeWritePackage(args.packageCode);
        return ctx.session.getPublicView();
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
        const existing = ctx.session.activeChangeSetId || ctx.kc.getManualChangeSetId();
        if (existing) {
          try {
            const cs = await ctx.kc.getChangeSet(existing);
            if (cs.status === "open") {
              ctx.kc.setManualChangeSet(existing);
              ctx.session.activeChangeSetId = existing;
              return { changeSetId: existing, alreadyOpen: true, changeSet: cs };
            }
            ctx.clearActiveChangeSet();
          } catch {
            ctx.clearActiveChangeSet();
          }
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
      description:
        "Cancel the active ChangeSet and clear session binding (also clears if CS is already cancelled/missing)",
      inputSchema: z.object({}),
    },
    async () =>
      withTool(ctx, "cancel_changeset", async () => {
        const id = ctx.session.activeChangeSetId || ctx.kc.getManualChangeSetId();
        if (!id) throw new Error("No active ChangeSet to cancel");
        try {
          const changeSet = await ctx.kc.cancelChangeSet(id);
          ctx.clearActiveChangeSet();
          return { changeSet, cleared: true };
        } catch (e) {
          ctx.clearActiveChangeSet();
          return {
            cleared: true,
            changeSetId: id,
            note: `ChangeSet cancel failed (session cleared anyway): ${
              e instanceof Error ? e.message : String(e)
            }`,
          };
        }
      }),
  );

  server.registerTool(
    "get_changeset",
    {
      description:
        "Get ChangeSet by id, or the session active ChangeSet when id omitted (status, itemCount, comment)",
      inputSchema: z.object({
        id: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "get_changeset", async () => {
        const id =
          args.id?.trim() ||
          ctx.session.activeChangeSetId ||
          ctx.kc.getManualChangeSetId() ||
          null;
        if (!id) throw new Error("No ChangeSet id and no active ChangeSet in session");
        try {
          const changeSet = await ctx.kc.getChangeSet(id);
          if (changeSet.status && changeSet.status !== "open") {
            if (
              !args.id &&
              (ctx.session.activeChangeSetId === id || ctx.kc.getManualChangeSetId() === id)
            ) {
              ctx.clearActiveChangeSet();
            }
          }
          return {
            changeSet: {
              id: changeSet.id,
              status: changeSet.status,
              itemCount: changeSet.itemCount,
              comment: changeSet.comment,
              operationType: changeSet.operationType,
              actor: changeSet.actor,
              openedAt: changeSet.openedAt,
              committedAt: changeSet.committedAt,
            },
            active: ctx.session.activeChangeSetId === id,
          };
        } catch (e) {
          if (
            !args.id &&
            (ctx.session.activeChangeSetId === id || ctx.kc.getManualChangeSetId() === id)
          ) {
            ctx.clearActiveChangeSet();
          }
          throw new Error(
            `ChangeSet ${id} not found or unreachable — ${
              !args.id ? "session cleared. " : ""
            }${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }),
  );

  server.registerTool(
    "list_changesets",
    {
      description: "List ChangeSets (default status=open). Optional package filters MCP comments.",
      inputSchema: z.object({
        status: z.string().optional().describe("Default: open"),
        package: z.string().optional().describe("Best-effort filter on comment package=…"),
        limit: z.number().int().positive().max(100).optional(),
        actor: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "list_changesets", async () => {
        const status = args.status?.trim() || "open";
        const page = await ctx.kc.listChangeSets({
          status,
          limit: args.limit ?? 50,
          actor: args.actor,
        });
        let items = page.items || [];
        if (args.package?.trim()) {
          const needle = `package=${args.package.trim()}`;
          items = items.filter((cs) => (cs.comment || "").includes(needle));
        }
        return {
          status,
          package: args.package ?? null,
          items: items.map((cs) => ({
            id: cs.id,
            status: cs.status,
            itemCount: cs.itemCount,
            comment: cs.comment,
            operationType: cs.operationType,
            actor: cs.actor,
            openedAt: cs.openedAt,
            committedAt: cs.committedAt,
          })),
          nextCursor: page.nextCursor,
        };
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
      description:
        "usageGuidance / usageExamples for a class, plus requiredProperties from get_class_constraints",
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
        const constraints = await ctx.model.getClassConstraints(local);
        return {
          classLocal: local,
          classId: cls.id,
          label: entityLabel(cls),
          usageGuidance: pick(guidanceProp),
          usageExamples: pick(examplesProp),
          descriptions: cls.descriptions,
          constraintsRef: "get_class_constraints",
          requiredProperties: constraints.requiredProperties,
          constraintsSource: constraints.source,
        };
      }),
  );

  server.registerTool(
    "get_class_constraints",
    {
      description:
        "Required (and recommended) properties for a class from KC shapes / fallback table. Call before reclassify to a shaped class (e.g. BusinessActor).",
      inputSchema: z.object({
        classLocal: z.string(),
      }),
    },
    async (args) =>
      withTool(ctx, "get_class_constraints", async () => {
        await ctx.ensureSchemaLoaded();
        return ctx.model.getClassConstraints(args.classLocal.trim());
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
      description:
        "Search entities. Optional package filter (default: workingPackage if set, else unfiltered). Optional instanceOfLocal class filter.",
      inputSchema: z.object({
        q: z.string(),
        package: z.string().optional(),
        instanceOfLocal: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "search_entities", async () => {
        await ctx.ensureSchemaLoaded();
        const pkg = ctx.resolveReadPackage(args.package);
        const instanceOf = args.instanceOfLocal
          ? ctx.schema.classIri(args.instanceOfLocal)
          : undefined;
        const page = await ctx.kc.listEntities({
          package: pkg,
          kind: "entity",
          q: args.q,
          instanceOf,
          includeSubclasses: instanceOf ? true : undefined,
          limit: args.limit ?? 30,
          include: "effectiveClasses",
        });
        return {
          package: pkg ?? null,
          items: (page.items || []).map((e) => summarizeEntity(e, ctx)),
          nextCursor: page.nextCursor,
        };
      }),
  );

  server.registerTool(
    "list_entities",
    {
      description:
        "List entities. Optional package (default workingPackage if set). Optional instanceOfLocal, includeProperties, includeEffectiveClasses.",
      inputSchema: z.object({
        package: z.string().optional(),
        instanceOfLocal: z.string().optional(),
        includeEffectiveClasses: z.boolean().optional(),
        includeProperties: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(200).optional(),
        cursor: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "list_entities", async () => {
        await ctx.ensureSchemaLoaded();
        const pkg = ctx.resolveReadPackage(args.package);
        const instanceOf = args.instanceOfLocal
          ? ctx.schema.classIri(args.instanceOfLocal)
          : undefined;
        const includeEffectiveClasses = args.includeEffectiveClasses !== false;
        const includeParts = ["effectiveClasses"];
        const props = args.includeProperties?.filter(Boolean) || [];
        const page = await ctx.kc.listEntities({
          package: pkg,
          kind: "entity",
          instanceOf,
          includeSubclasses: instanceOf ? true : undefined,
          limit: args.limit ?? 50,
          cursor: args.cursor,
          include: includeParts.join(","),
        });
        const items = [];
        for (const e of page.items || []) {
          items.push(
            await enrichListedEntity(ctx, e, {
              includeEffectiveClasses,
              includeProperties: props.length ? props : undefined,
            }),
          );
        }
        return {
          package: pkg ?? null,
          resolvedInstanceOf: instanceOf ?? null,
          items,
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
          entity: summarizeEntity(entity, ctx),
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
      description:
        "Graph neighborhood (depth 1–2). By default returns resolved links {relType, direction, other}. Pass raw:true for KC statements.",
      inputSchema: z.object({
        id: z.string(),
        depth: z.number().int().min(1).max(2).optional(),
        raw: z.boolean().optional(),
        relTypes: z.array(z.string()).optional(),
        classLocals: z.array(z.string()).optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "get_neighborhood", async () => {
        await ctx.ensureSchemaLoaded();
        const depth = args.depth ?? 1;
        const graph = await ctx.kc.getGraph(args.id, depth);
        const links = await resolveNeighborhoodLinks(ctx, args.id, graph, {
          relTypes: args.relTypes,
          classLocals: args.classLocals,
        });
        const result: Record<string, unknown> = {
          entity: summarizeEntity(graph.entity, ctx),
          links,
          neighbors: (graph.neighbors || []).map((n) => summarizeEntity(n, ctx)),
        };
        if (args.raw) {
          result.outgoing = graph.outgoing;
          result.incoming = graph.incoming;
        }
        return result;
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
    "create_entity",
    {
      description:
        "Create an ArchiMate element (labels + instanceOf + optional string props) in the open ChangeSet",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        name: z.string(),
        classLocal: z.string(),
        description: z.string().optional(),
        iriLocal: z.string().optional(),
        props: z.record(z.string()).optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "create_entity", async () => {
        await ctx.ensureSchemaLoaded();
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("create_entity");
        const result = await ctx.model.createTypedElement({
          packageCode,
          classLocal: args.classLocal,
          name: args.name,
          descriptions: args.description
            ? { en: args.description, cs: args.description }
            : undefined,
          iriLocal: args.iriLocal,
          extraProps: args.props,
        });
        return {
          entity: summarizeEntity(result.entity, ctx),
          changeSetId: result.changeSet.id,
        };
      }),
  );

  server.registerTool(
    "update_entity",
    {
      description: "Update entity labels and/or descriptions (saveEntityBasics / patchEntity)",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        id: z.string(),
        labels: z.record(z.string()).optional(),
        descriptions: z.record(z.string()).nullable().optional(),
        expectedRevision: z.number().int().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "update_entity", async () => {
        const entity = await ctx.kc.getEntity(args.id);
        ctx.resolveWritePackage(args.packageCode || entity.packageCode);
        await ctx.ensureOpenChangeSet("update_entity");
        if (!args.labels && args.descriptions === undefined) {
          throw new Error("update_entity requires labels and/or descriptions");
        }
        const changeSet = await ctx.model.saveEntityBasics({
          id: args.id,
          labels: args.labels,
          descriptions: args.descriptions,
          revision: args.expectedRevision ?? entity.revisionNo,
        });
        const updated = await ctx.kc.getEntity(args.id);
        return {
          entity: summarizeEntity(updated, ctx),
          changeSetId: changeSet?.id ?? null,
          noop: changeSet === null,
        };
      }),
  );

  server.registerTool(
    "create_relationship",
    {
      description: "Create a relationship (rejects if !isAllowed)",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        typeLocal: z.string(),
        sourceId: z.string(),
        targetId: z.string(),
        props: z.record(z.string()).optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "create_relationship", async () => {
        await ctx.ensureSchemaLoaded();
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("create_relationship");
        const entity = await ctx.model.createRelationship({
          packageCode,
          typeLocal: args.typeLocal,
          sourceId: args.sourceId,
          targetId: args.targetId,
          props: args.props,
        });
        return { entity: summarizeEntity(entity, ctx) };
      }),
  );

  server.registerTool(
    "update_relationship",
    {
      description:
        "Change relationship sourceId / targetId / typeLocal while preserving relationship id and iriLocal",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        id: z.string(),
        sourceId: z.string().optional(),
        targetId: z.string().optional(),
        typeLocal: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "update_relationship", async () => {
        await ctx.ensureSchemaLoaded();
        if (!args.sourceId && !args.targetId && !args.typeLocal) {
          throw new Error("update_relationship requires sourceId, targetId, and/or typeLocal");
        }
        const entity = await ctx.kc.getEntity(args.id);
        const packageCode = ctx.resolveWritePackage(args.packageCode || entity.packageCode);
        await ctx.ensureOpenChangeSet("update_relationship");
        const result = await ctx.model.updateRelationship({
          id: args.id,
          packageCode,
          sourceId: args.sourceId,
          targetId: args.targetId,
          typeLocal: args.typeLocal,
        });
        return {
          entity: summarizeEntity(result.entity, ctx),
          iriLocal: result.iriLocal,
          changeSetId: result.changeSet.id,
        };
      }),
  );

  server.registerTool(
    "create_statement",
    {
      description:
        "Create a statement (String | EntityReference | Boolean). Use for instanceOf EntityRef or string props.",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        subjectId: z.string(),
        propertyLocal: z.string(),
        valueType: z.enum(["string", "entityRef", "boolean"]),
        value: z.union([z.string(), z.boolean()]),
        upsert: z.boolean().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "create_statement", async () => {
        await ctx.ensureSchemaLoaded();
        const subject = await ctx.kc.getEntity(args.subjectId);
        const packageCode = ctx.resolveWritePackage(args.packageCode || subject.packageCode);
        await ctx.ensureOpenChangeSet("create_statement");
        const res = await ctx.model.createTypedStatement({
          packageCode,
          subjectId: args.subjectId,
          propertyLocal: args.propertyLocal,
          valueType: args.valueType,
          value: args.value,
          upsert: args.upsert,
        });
        return {
          statement: {
            id: res.statement.id,
            subject: res.statement.subject,
            property: res.statement.property,
            value: res.statement.value,
            revisionNo: res.statement.revisionNo,
          },
          changeSetId: res.changeSet.id,
        };
      }),
  );

  server.registerTool(
    "deprecate_statement",
    {
      description: "Deprecate a statement by id (no hard delete)",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        statementId: z.string(),
        expectedRevision: z.number().int().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "deprecate_statement", async () => {
        if (args.packageCode) ctx.resolveWritePackage(args.packageCode);
        else if (ctx.session.workingPackage) ctx.resolveWritePackage(ctx.session.workingPackage);
        else throw new Error("deprecate_statement requires packageCode or approved workingPackage");
        await ctx.ensureOpenChangeSet("deprecate_statement");
        const changeSet = await ctx.model.deprecateStatementById(
          args.statementId,
          args.expectedRevision,
        );
        return { statementId: args.statementId, changeSetId: changeSet.id };
      }),
  );

  server.registerTool(
    "list_statements",
    {
      description:
        "List active statements for a subject. Optional propertyLocal filter; propertyLocal=instanceOf uses schema-config instanceOfProperty (kc-base). Unfiltered list merges instanceOf when KC omits model properties.",
      inputSchema: z.object({
        subjectId: z.string(),
        propertyLocal: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "list_statements", async () => {
        await ctx.ensureSchemaLoaded();
        const items = await ctx.model.listStatementsForSubject(args.subjectId, args.propertyLocal);
        return {
          subjectId: args.subjectId,
          propertyLocal: args.propertyLocal ?? null,
          items: items.map((s) => ({
            id: s.id,
            subject: s.subject,
            property: s.property,
            propertyLocal: ctx.schema.propertyLocal(s.property) || s.property.split("/").pop(),
            value: s.value,
            display: valueToDisplay(s.value),
            revisionNo: s.revisionNo,
            status: s.status,
          })),
        };
      }),
  );

  server.registerTool(
    "set_property",
    {
      description: "Set/replace a string property on an entity (convenience over create_statement)",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        id: z.string(),
        propertyLocal: z.string(),
        value: z.string(),
      }),
    },
    async (args) =>
      withTool(ctx, "set_property", async () => {
        await ctx.ensureSchemaLoaded();
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("set_property");
        const existingPage = await ctx.kc.getStatements(
          args.id,
          ctx.schema.propertyIri(args.propertyLocal),
        );
        const existing = existingPage.items[0];
        const changeSet = await ctx.model.replaceStringProperty({
          packageCode,
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
      description: "Clear a property by deprecating all active statements for that property",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        id: z.string(),
        propertyLocal: z.string(),
      }),
    },
    async (args) =>
      withTool(ctx, "clear_property", async () => {
        await ctx.ensureSchemaLoaded();
        ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("clear_property");
        const result = await ctx.model.clearPropertyStatements({
          subjectId: args.id,
          propertyLocal: args.propertyLocal,
        });
        return result;
      }),
  );

  server.registerTool(
    "deprecate_entity",
    {
      description:
        "Deprecate an entity (use when replacing with a new id — not for in-place reclassify)",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        id: z.string(),
        expectedRevision: z.number().int().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "deprecate_entity", async () => {
        const entity = await ctx.kc.getEntity(args.id);
        const packageCode = ctx.resolveWritePackage(args.packageCode || entity.packageCode);
        await ctx.ensureOpenChangeSet("deprecate_entity");
        const res = await ctx.kc.deprecateEntity(args.id, {
          expectedRevision: args.expectedRevision,
        });
        return {
          entity: summarizeEntity(res.data, ctx),
          changeSetId: res.changeSet.id,
          packageCode,
        };
      }),
  );

  server.registerTool(
    "reclassify_entity",
    {
      description:
        "Change entity class (instanceOf) while preserving id and iriLocal. Prefer revise path; pass props for shaped targets (e.g. BusinessActor). dryRun first — check missingRequiredProps + invalidRelationships.",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        id: z.string(),
        newClassLocal: z.string(),
        props: z.record(z.string()).optional(),
        strictRelations: z.enum(["fail", "warn"]).optional(),
        dryRun: z.boolean().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "reclassify_entity", async () => {
        await ctx.ensureSchemaLoaded();
        const entity = await ctx.kc.getEntity(args.id);
        const packageCode = ctx.resolveWritePackage(args.packageCode || entity.packageCode);
        if (!args.dryRun) await ctx.ensureOpenChangeSet("reclassify_entity");
        return ctx.model.reclassifyEntity({
          id: args.id,
          packageCode,
          newClassLocal: args.newClassLocal,
          props: args.props,
          strictRelations: args.strictRelations,
          dryRun: args.dryRun,
        });
      }),
  );

  server.registerTool(
    "reclassify_entities",
    {
      description:
        "Batch reclassify (preserve ids). Peer classes in the same batch are projected in dryRun. Missing required props or strictRelations=fail blocks the entire batch.",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        ids: z.array(z.string()).optional(),
        fromClassLocal: z.string().optional(),
        newClassLocal: z.string(),
        props: z.record(z.string()).optional(),
        strictRelations: z.enum(["fail", "warn"]).optional(),
        dryRun: z.boolean().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "reclassify_entities", async () => {
        await ctx.ensureSchemaLoaded();
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        if (!args.ids?.length && !args.fromClassLocal) {
          throw new Error("reclassify_entities requires ids[] and/or fromClassLocal");
        }
        if (!args.dryRun) await ctx.ensureOpenChangeSet("reclassify_entities");
        return ctx.model.reclassifyEntities({
          ids: args.ids,
          packageCode,
          fromClassLocal: args.fromClassLocal,
          newClassLocal: args.newClassLocal,
          props: args.props,
          strictRelations: args.strictRelations,
          dryRun: args.dryRun,
        });
      }),
  );

  server.registerTool(
    "retarget_view_nodes",
    {
      description:
        "Retarget ViewNode.elementRef fromElementId → toElementId (needed when replacing entity id; not after pure reclassify)",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        fromElementId: z.string(),
        toElementId: z.string(),
        viewId: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "retarget_view_nodes", async () => {
        await ctx.ensureSchemaLoaded();
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("retarget_view_nodes");
        const result = await ctx.model.retargetViewNodes({
          packageCode,
          fromElementId: args.fromElementId,
          toElementId: args.toElementId,
          viewId: args.viewId,
        });
        return {
          updated: result.updated,
          nodeIds: result.nodeIds,
          changeSetId: result.changeSet.id,
        };
      }),
  );

  server.registerTool(
    "apply_operations",
    {
      description: `Append a batch of graph ops to the active ChangeSet (soft limit ${APPLY_OPERATIONS_SOFT_LIMIT}). Ops: createEntity, updateEntity, deprecateEntity, createStatement, deprecateStatement, createRelationship, setProperty, clearProperty, reclassifyEntity.`,
      inputSchema: z.object({
        packageCode: z.string().optional(),
        operations: z.array(z.record(z.unknown())).min(1),
      }),
    },
    async (args) =>
      withTool(ctx, "apply_operations", async () => {
        await ctx.ensureSchemaLoaded();
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        if (args.operations.length > APPLY_OPERATIONS_SOFT_LIMIT) {
          throw new Error(
            `apply_operations soft limit is ${APPLY_OPERATIONS_SOFT_LIMIT} ops/call (got ${args.operations.length})`,
          );
        }
        await ctx.ensureOpenChangeSet("apply_operations");
        const ops = args.operations as GraphApplyOperation[];
        for (const op of ops) {
          if (!op || typeof op !== "object" || typeof (op as { op?: unknown }).op !== "string") {
            throw new Error("Each operation must include string field op");
          }
        }
        return ctx.model.applyGraphOperations(packageCode, ops);
      }),
  );

  // ── Views ────────────────────────────────────────────────────────────────

  server.registerTool(
    "list_views",
    {
      description: "List DiagramView entities (package defaults to workingPackage if set)",
      inputSchema: z.object({
        package: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "list_views", async () => {
        await ctx.ensureSchemaLoaded();
        const pkg = ctx.resolveReadPackage(args.package);
        if (!pkg) {
          throw new Error("list_views requires package= or an approved workingPackage");
        }
        const items = await ctx.views.listViews(pkg);
        return { package: pkg, items: items.map((e) => summarizeEntity(e, ctx)) };
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
          view: summarizeEntity(detail.view, ctx),
          nodes: detail.nodes.map((e) => summarizeEntity(e, ctx)),
          connections: detail.connections.map((e) => summarizeEntity(e, ctx)),
        };
      }),
  );

  server.registerTool(
    "create_view",
    {
      description: "Create a DiagramView",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        name: z.string(),
        viewpoint: z.string().optional(),
        description: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "create_view", async () => {
        await ctx.ensureSchemaLoaded();
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("create_view");
        const res = await ctx.views.createView({
          packageCode,
          name: args.name,
          viewpoint: args.viewpoint,
          descriptions: args.description
            ? { en: args.description, cs: args.description }
            : undefined,
        });
        return { entity: summarizeEntity(res.entity, ctx), changeSetId: res.changeSet.id };
      }),
  );

  server.registerTool(
    "add_view_node",
    {
      description: "Add a ViewNode to a DiagramView",
      inputSchema: z.object({
        packageCode: z.string().optional(),
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
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("add_view_node");
        const res = await ctx.views.addViewNode({
          packageCode,
          viewId: args.viewId,
          elementRef: args.elementRef,
          bounds: args.bounds,
          parentNodeId: args.parentNodeId,
          styleJson: args.styleJson,
          nodeKind: args.nodeKind,
        });
        return { entity: summarizeEntity(res.entity, ctx), changeSetId: res.changeSet.id };
      }),
  );

  server.registerTool(
    "update_view_node",
    {
      description: "Update a ViewNode",
      inputSchema: z.object({
        packageCode: z.string().optional(),
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
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("update_view_node");
        const res = await ctx.views.updateViewNode({
          packageCode,
          nodeId: args.nodeId,
          elementRef: args.elementRef,
          bounds: args.bounds,
          parentNodeId: args.parentNodeId,
          styleJson: args.styleJson,
          nodeKind: args.nodeKind,
        });
        return {
          entity: res.entity ? summarizeEntity(res.entity, ctx) : undefined,
          changeSetId: res.changeSet.id,
        };
      }),
  );

  server.registerTool(
    "add_view_connection",
    {
      description: "Add a ViewConnection between nodes",
      inputSchema: z.object({
        packageCode: z.string().optional(),
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
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("add_view_connection");
        const res = await ctx.views.addViewConnection({
          packageCode,
          viewId: args.viewId,
          sourceNodeId: args.sourceNodeId,
          targetNodeId: args.targetNodeId,
          relationshipRef: args.relationshipRef,
          bendpointsJson: args.bendpointsJson,
          styleJson: args.styleJson,
        });
        return { entity: summarizeEntity(res.entity, ctx), changeSetId: res.changeSet.id };
      }),
  );

  server.registerTool(
    "update_view_connection",
    {
      description: "Update a ViewConnection",
      inputSchema: z.object({
        packageCode: z.string().optional(),
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
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("update_view_connection");
        const res = await ctx.views.updateViewConnection({
          packageCode,
          connectionId: args.connectionId,
          sourceNodeId: args.sourceNodeId,
          targetNodeId: args.targetNodeId,
          relationshipRef: args.relationshipRef,
          bendpointsJson: args.bendpointsJson,
          styleJson: args.styleJson,
        });
        return {
          entity: res.entity ? summarizeEntity(res.entity, ctx) : undefined,
          changeSetId: res.changeSet.id,
        };
      }),
  );

  server.registerTool(
    "remove_view_node",
    {
      description: "Deprecate a ViewNode",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        id: z.string(),
        expectedRevision: z.number().int().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "remove_view_node", async () => {
        ctx.resolveWritePackage(args.packageCode);
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
        packageCode: z.string().optional(),
        id: z.string(),
        expectedRevision: z.number().int().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "remove_view_connection", async () => {
        ctx.resolveWritePackage(args.packageCode);
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
        packageCode: z.string().optional(),
        id: z.string(),
        expectedRevision: z.number().int().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "remove_view", async () => {
        ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("remove_view");
        const changeSet = await ctx.views.removeViewEntity(args.id, args.expectedRevision);
        return { changeSetId: changeSet.id };
      }),
  );

  // ── Open Exchange ────────────────────────────────────────────────────────

  server.registerTool(
    "import_open_exchange",
    {
      description: `Import ArchiMate Open Exchange XML into a writable package (max ${ctx.config.oeMaxBytes} bytes). Provide either xml string or path (under ITMAP_MCP_FILE_ROOTS). Always opens a ChangeSet; commits only when writeMode=commit.`,
      inputSchema: z.object({
        packageCode: z.string().optional(),
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
        const packageCode = ctx.resolveWritePackage(args.packageCode);
        const changeSetId = await ctx.ensureOpenChangeSet("import_open_exchange");
        const result = await importOpenExchange({
          xml,
          packageCode,
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
        "Export a package as Open Exchange XML. Without path returns xml string; with path writes under ITMAP_MCP_FILE_ROOTS and returns path + counts.",
      inputSchema: z.object({
        packageCode: z.string().optional(),
        path: z
          .string()
          .optional()
          .describe("Optional absolute output path under ITMAP_MCP_FILE_ROOTS"),
      }),
    },
    async (args) =>
      withTool(ctx, "export_open_exchange", async () => {
        await ctx.ensureSchemaLoaded();
        const packageCode =
          args.packageCode?.trim() ||
          ctx.session.workingPackage ||
          (() => {
            throw new Error("export_open_exchange requires packageCode= or workingPackage");
          })();
        const result = await exportOpenExchange({
          packageCode,
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
        packageCode: z.string().optional(),
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
        ctx.resolveWritePackage(args.packageCode);
        await ctx.ensureOpenChangeSet("apply_open_exchange_orphans");
        const mapped = args.actions.map((a) => ({
          orphan: a.orphan as OrphanCandidate,
          action: a.action as OrphanAction,
        }));
        const result = await applyOpenExchangeOrphanActions(mapped, ctx.kc);
        return result;
      }),
  );

  // ── Explore / inventory (phase B–D) ─────────────────────────────────────

  server.registerTool(
    "list_entity_facets",
    {
      description:
        "Facet counts by instanceOf (or other groupBy). package defaults to workingPackage if set.",
      inputSchema: z.object({
        package: z.string().optional(),
        groupBy: z.string().optional().describe("Default instanceOf"),
      }),
    },
    async (args) =>
      withTool(ctx, "list_entity_facets", async () => {
        await ctx.ensureSchemaLoaded();
        const pkg = ctx.resolveReadPackage(args.package);
        const facetsResp = await ctx.kc.listEntityFacets({
          package: pkg,
          groupBy: args.groupBy || "instanceOf",
        });
        const items = (facetsResp.facets || []).map((f) => ({
          classId: f.classId,
          classLocal: ctx.schema.classLocal(f.classId) || f.classId.split("/").pop() || f.classId,
          count: f.count,
        }));
        items.sort((a, b) => b.count - a.count || a.classLocal.localeCompare(b.classLocal));
        return { package: pkg ?? null, groupBy: args.groupBy || "instanceOf", items };
      }),
  );

  server.registerTool(
    "list_relationships",
    {
      description:
        "List relationships of a type in a package, with source/target labels resolved.",
      inputSchema: z.object({
        package: z.string().optional(),
        relationshipTypeLocal: z.string(),
        sourceId: z.string().optional(),
        targetId: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
        cursor: z.string().optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "list_relationships", async () => {
        await ctx.ensureSchemaLoaded();
        if (!isRelationshipClassLocal(args.relationshipTypeLocal)) {
          throw new Error(`Not a relationship type: ${args.relationshipTypeLocal}`);
        }
        const pkg = ctx.resolveReadPackage(args.package);
        const instanceOf = ctx.schema.classIri(args.relationshipTypeLocal);
        const page = await ctx.kc.listEntities({
          package: pkg,
          kind: "entity",
          instanceOf,
          includeSubclasses: true,
          limit: args.limit ?? 50,
          cursor: args.cursor,
          include: "statements",
          properties: "relSource,relTarget,instanceOf",
        });
        const items = [];
        for (const e of page.items || []) {
          let source: string | undefined;
          let target: string | undefined;
          for (const s of e.statements || []) {
            const pl = ctx.schema.propertyLocal(s.property) || s.property.split("/").pop();
            if (pl === "relSource" && s.value?.type === "EntityReference") source = s.value.entityId;
            if (pl === "relTarget" && s.value?.type === "EntityReference") target = s.value.entityId;
          }
          if (!source || !target) {
            const stmts = await ctx.kc.getStatements(e.id);
            for (const s of stmts.items) {
              const pl = ctx.schema.propertyLocal(s.property) || s.property.split("/").pop();
              if (pl === "relSource" && s.value?.type === "EntityReference") source = s.value.entityId;
              if (pl === "relTarget" && s.value?.type === "EntityReference") target = s.value.entityId;
            }
          }
          if (args.sourceId && source !== args.sourceId) continue;
          if (args.targetId && target !== args.targetId) continue;
          const ends = await ctx.kc.batchReadEntities({
            ids: [source, target].filter(Boolean) as string[],
          });
          const byId = new Map(
            (ends.results || []).filter((r) => r.entity).map((r) => [r.id, r.entity!]),
          );
          const srcE = source ? byId.get(source) : undefined;
          const tgtE = target ? byId.get(target) : undefined;
          items.push({
            id: e.id,
            type: args.relationshipTypeLocal,
            source: source
              ? summarizeEntity(srcE || { id: source }, ctx)
              : null,
            target: target
              ? summarizeEntity(tgtE || { id: target }, ctx)
              : null,
          });
        }
        return {
          package: pkg ?? null,
          relationshipTypeLocal: args.relationshipTypeLocal,
          items,
          nextCursor: page.nextCursor,
        };
      }),
  );

  server.registerTool(
    "batch_get_entities",
    {
      description: "Batch-read entities by id (max 200). Read is unrestricted across packages.",
      inputSchema: z.object({
        ids: z.array(z.string()).min(1).max(200),
        includeStatements: z.boolean().optional(),
        properties: z.array(z.string()).optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "batch_get_entities", async () => {
        await ctx.ensureSchemaLoaded();
        const include = ["effectiveClasses"];
        if (args.includeStatements || args.properties?.length) include.push("statements");
        const resp = await ctx.kc.batchReadEntities({
          ids: args.ids,
          include,
          properties: args.properties,
        });
        return {
          results: (resp.results || []).map((r) => ({
            id: r.id,
            error: r.error,
            entity: r.entity ? summarizeEntity(r.entity, ctx) : undefined,
            statements: r.statements?.map((s) => ({
              id: s.id,
              property: ctx.schema.propertyLocal(s.property) || s.property,
              value: s.value,
              display: valueToDisplay(s.value),
            })),
          })),
        };
      }),
  );

  server.registerTool(
    "inventory_report",
    {
      description:
        "Compact package inventory: facets + optional top labels per classLocal.",
      inputSchema: z.object({
        package: z.string().optional(),
        classLocals: z.array(z.string()).optional(),
        topPerClass: z.number().int().positive().max(50).optional(),
      }),
    },
    async (args) =>
      withTool(ctx, "inventory_report", async () => {
        await ctx.ensureSchemaLoaded();
        const pkg = ctx.resolveReadPackage(args.package);
        if (!pkg) throw new Error("inventory_report requires package= or workingPackage");
        const facetsResp = await ctx.kc.listEntityFacets({ package: pkg, groupBy: "instanceOf" });
        const facets = (facetsResp.facets || []).map((f) => ({
          classId: f.classId,
          classLocal: ctx.schema.classLocal(f.classId) || f.classId.split("/").pop() || f.classId,
          count: f.count,
        }));
        const want = args.classLocals?.length ? new Set(args.classLocals) : null;
        const filtered = want ? facets.filter((f) => want.has(f.classLocal)) : facets;
        filtered.sort((a, b) => b.count - a.count);
        const topN = args.topPerClass ?? 5;
        const samples: Record<string, Array<{ id: string; label: string }>> = {};
        for (const f of filtered.slice(0, 30)) {
          if (f.count === 0) continue;
          try {
            const page = await ctx.kc.listEntities({
              package: pkg,
              kind: "entity",
              instanceOf: f.classId,
              includeSubclasses: true,
              limit: topN,
            });
            samples[f.classLocal] = (page.items || []).map((e) => ({
              id: e.id,
              label: summarizeEntity(e, ctx).label,
            }));
          } catch {
            samples[f.classLocal] = [];
          }
        }
        return { package: pkg, facets: filtered, samples };
      }),
  );

  server.registerTool(
    "health",
    {
      description: "MCP/KC health: reachability, schema loaded, write allowlist, session summary",
      inputSchema: z.object({}),
    },
    async () =>
      withTool(ctx, "health", async () => {
        let kcOk = false;
        let kcError: string | null = null;
        try {
          const res = await fetch(`${ctx.config.kcBaseUrl}/healthz`);
          kcOk = res.ok;
          if (!res.ok) kcError = `HTTP ${res.status}`;
        } catch (e) {
          kcError = e instanceof Error ? e.message : String(e);
        }
        let schemaClasses = 0;
        try {
          await ctx.ensureSchemaLoaded();
          schemaClasses = ctx.schema.snapshot.classesByLocal.size;
        } catch (e) {
          kcError = kcError || (e instanceof Error ? e.message : String(e));
        }
        return {
          ok: kcOk && schemaClasses > 0,
          kcBaseUrl: ctx.config.kcBaseUrl,
          kcOk,
          kcError,
          schemaLoaded: schemaClasses > 0,
          schemaClasses,
          writePackagesAllowlist: [...ctx.session.writePackagesAllowlist],
          session: ctx.session.getPublicView(),
          pid: ctx.pid,
          startedAt: ctx.startedAt,
        };
      }),
  );

  return server;
}
