#!/usr/bin/env node
/**
 * Live acceptance smoke against a running Knowledge Core.
 *
 * Requires env (same as MCP server):
 *   ITMAP_KC_BASE_URL, ITMAP_MCP_WRITE_PACKAGES (or legacy ORG_PACKAGE),
 *   ITMAP_KC_AUTH_MODE=dev (or token), ITMAP_MCP_WRITE_MODE=propose
 *
 * Exit 0 on success; non-zero if KC unreachable or a step fails.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertAllowed,
  exportOpenExchange,
  getModelingPrimer,
  importOpenExchange,
} from "@itmap/archimate-core";
import { loadConfig } from "./config.js";
import { AppContext } from "./context.js";
import { resolveSafePath } from "./paths.js";

function log(step: string, detail?: unknown) {
  const extra =
    detail === undefined
      ? ""
      : ` ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  console.log(`✓ ${step}${extra}`);
}

async function main(): Promise<void> {
  if (!process.env.ITMAP_MCP_WRITE_MODE) process.env.ITMAP_MCP_WRITE_MODE = "propose";
  if (!process.env.ITMAP_MCP_TRANSPORT) process.env.ITMAP_MCP_TRANSPORT = "stdio";

  const config = loadConfig();
  const healthUrl = `${config.kcBaseUrl}/healthz`;
  let healthOk = false;
  try {
    const res = await fetch(healthUrl);
    healthOk = res.ok;
  } catch {
    healthOk = false;
  }
  if (!healthOk) {
    throw new Error(
      `KC not reachable at ${healthUrl}. Start Knowledge Core, seed packages, then re-run npm run mcp:smoke.`,
    );
  }
  log("KC healthz", healthUrl);

  const ctx = AppContext.create(config);
  await ctx.ensureSchemaLoaded();
  log("schema loaded", {
    classes: ctx.schema.snapshot.classesByLocal.size,
    allowed: ctx.schema.snapshot.allowed.length,
  });

  const primer = getModelingPrimer(config.lang);
  if (primer.length < 100) throw new Error("primer too short");
  log("primer", `${config.lang} (${primer.length} chars)`);

  if (!ctx.schema.snapshot.classesByLocal.has("ApplicationComponent")) {
    throw new Error("ApplicationComponent missing from schema — import archimate-lite");
  }
  log("element types present");

  const writePkg = config.defaultPackage || config.writePackages[0];
  if (!writePkg) throw new Error("no write package in config");

  // Write without approval must fail
  let denied = false;
  try {
    ctx.resolveWritePackage(writePkg);
  } catch {
    denied = true;
  }
  if (!denied) throw new Error("expected write without approval to fail");
  log("write gate rejects unapproved package");

  ctx.approveWritePackage(writePkg);
  log("approve_write_package", writePkg);

  const listed = await ctx.kc.listEntities({
    package: writePkg,
    limit: 5,
  });
  log("list_entities", { count: listed.items.length, package: writePkg });

  // Typed list smoke when BusinessActor exists
  const facets = await ctx.kc.listEntityFacets({ package: writePkg, groupBy: "instanceOf" });
  const baFacet = (facets.facets || []).find((f) => f.classId.endsWith("/BusinessActor"));
  if (baFacet && baFacet.count > 0) {
    const ba = await ctx.kc.listEntities({
      package: writePkg,
      instanceOf: ctx.schema.classIri("BusinessActor"),
      includeSubclasses: true,
      limit: 5,
    });
    if (!ba.items.length) {
      throw new Error(
        `BusinessActor facet count=${baFacet.count} but list_entities returned 0 — typed list broken`,
      );
    }
    log("typed list BusinessActor", { facet: baFacet.count, listed: ba.items.length });
  } else {
    log("typed list BusinessActor skipped (no actors in package)");
  }

  // Matrix guard (no write)
  let matrixReject = false;
  try {
    assertAllowed(ctx.schema, "Serving", "DataObject", "Location");
  } catch {
    matrixReject = true;
  }
  if (!matrixReject) {
    throw new Error("expected assertAllowed to reject Serving DataObject→Location");
  }
  log("isAllowed reject (Serving DataObject→Location)");

  const stamp = Date.now().toString(36);
  const cs = await ctx.ensureOpenChangeSet("mcp-smoke");
  log("open_changeset", cs);

  const created = await ctx.model.createTypedElement({
    packageCode: writePkg,
    classLocal: "ApplicationComponent",
    name: `MCP Smoke App ${stamp}`,
    iriLocal: `mcp-smoke-app-${stamp}`,
  });
  log("create_entity", { id: created.entity.id, iriLocal: created.entity.iriLocal });

  const svc = await ctx.model.createTypedElement({
    packageCode: writePkg,
    classLocal: "ApplicationService",
    name: `MCP Smoke Svc ${stamp}`,
    iriLocal: `mcp-smoke-svc-${stamp}`,
  });
  log("create_entity service", svc.entity.id);

  const rel = await ctx.model.createRelationship({
    packageCode: writePkg,
    typeLocal: "Realization",
    sourceId: created.entity.id,
    targetId: svc.entity.id,
  });
  log("create_relationship", rel.id);

  // Graph mutations: statement → reclassify (preserve id) → deprecate statement
  const misclass = await ctx.model.createTypedElement({
    packageCode: writePkg,
    classLocal: "ApplicationService",
    name: `MCP Smoke Reclass ${stamp}`,
    iriLocal: `mcp-smoke-reclass-${stamp}`,
  });
  const preservedId = misclass.entity.id;
  const preservedIri = misclass.entity.iriLocal;
  log("create_entity for reclassify", { id: preservedId, iriLocal: preservedIri });

  const stmt = await ctx.model.createTypedStatement({
    packageCode: writePkg,
    subjectId: preservedId,
    propertyLocal: "modelingDepth",
    valueType: "string",
    value: "catalog",
  });
  log("create_statement", { statementId: stmt.statement.id, property: "modelingDepth" });

  const dry = await ctx.model.reclassifyEntity({
    id: preservedId,
    packageCode: writePkg,
    newClassLocal: "ApplicationComponent",
    dryRun: true,
    strictRelations: "fail",
  });
  if (!dry.ok && dry.invalidRelationships.length) {
    throw new Error(`reclassify dryRun unexpected invalid: ${JSON.stringify(dry.invalidRelationships)}`);
  }
  log("reclassify_entity dryRun", { from: dry.fromClass, to: dry.toClass, wouldWrite: dry.wouldWrite });

  const reclass = await ctx.model.reclassifyEntity({
    id: preservedId,
    packageCode: writePkg,
    newClassLocal: "ApplicationComponent",
    strictRelations: "warn",
    dryRun: false,
  });
  if (!reclass.written) throw new Error("reclassify_entity did not write");
  const after = await ctx.kc.getEntity(preservedId);
  if (after.id !== preservedId) throw new Error("reclassify changed entity id");
  if (after.iriLocal !== preservedIri) throw new Error("reclassify changed iriLocal");
  const io = await ctx.model.listStatementsForSubject(preservedId, "instanceOf");
  if (io.length !== 1) throw new Error(`expected exactly 1 active instanceOf, got ${io.length}`);
  log("reclassify_entity", {
    id: preservedId,
    iriLocal: after.iriLocal,
    instanceOfCount: io.length,
    writeMode: reclass.writeMode,
    from: reclass.fromClass,
    to: reclass.toClass,
  });

  // Shaped reclassify: BusinessFunction → BusinessActor with required props
  const actorConstraints = await ctx.model.getClassConstraints("BusinessActor");
  const reqLocals = actorConstraints.requiredProperties.map((p) => p.propertyLocal);
  if (!reqLocals.includes("actorKind") || !reqLocals.includes("organizationScope")) {
    throw new Error(
      `get_class_constraints(BusinessActor) missing actorKind/organizationScope: ${reqLocals.join(",")}`,
    );
  }
  log("get_class_constraints BusinessActor", {
    source: actorConstraints.source,
    required: reqLocals,
  });

  const fnEnt = await ctx.model.createTypedElement({
    packageCode: writePkg,
    classLocal: "BusinessFunction",
    name: `MCP Smoke ActorFn ${stamp}`,
    iriLocal: `mcp-smoke-actor-fn-${stamp}`,
    extraProps: { modelingDepth: "catalog" },
  });
  const actorDryMissing = await ctx.model.reclassifyEntity({
    id: fnEnt.entity.id,
    packageCode: writePkg,
    newClassLocal: "BusinessActor",
    dryRun: true,
    strictRelations: "fail",
  });
  if (actorDryMissing.ok) {
    throw new Error("expected dryRun without props to fail for BusinessActor");
  }
  if (
    !actorDryMissing.missingRequiredProps.includes("actorKind") ||
    !actorDryMissing.missingRequiredProps.includes("organizationScope")
  ) {
    throw new Error(
      `expected missingRequiredProps actorKind+organizationScope, got ${JSON.stringify(actorDryMissing.missingRequiredProps)}`,
    );
  }
  log("reclassify_entity Actor dryRun missing props", actorDryMissing.missingRequiredProps);

  const actorProps = {
    actorKind: "organizationalUnit",
    organizationScope: "internal",
  };
  const actorDryOk = await ctx.model.reclassifyEntity({
    id: fnEnt.entity.id,
    packageCode: writePkg,
    newClassLocal: "BusinessActor",
    props: actorProps,
    dryRun: true,
    strictRelations: "fail",
  });
  if (!actorDryOk.ok) {
    throw new Error(`Actor dryRun with props failed: ${actorDryOk.error}`);
  }
  const actorReclass = await ctx.model.reclassifyEntity({
    id: fnEnt.entity.id,
    packageCode: writePkg,
    newClassLocal: "BusinessActor",
    props: actorProps,
    strictRelations: "warn",
    dryRun: false,
  });
  if (!actorReclass.written) throw new Error("Actor reclassify did not write");
  if (actorReclass.writeMode !== "revise" && actorReclass.writeMode !== "create") {
    throw new Error(`unexpected writeMode ${actorReclass.writeMode}`);
  }
  const actorIo = await ctx.model.listStatementsForSubject(fnEnt.entity.id, "instanceOf");
  if (actorIo.length !== 1) {
    throw new Error(`Actor expected 1 instanceOf, got ${actorIo.length}`);
  }
  log("reclassify_entity BusinessActor", {
    id: fnEnt.entity.id,
    writeMode: actorReclass.writeMode,
    instanceOfCount: actorIo.length,
  });

  const depr = await ctx.model.deprecateStatementById(stmt.statement.id, stmt.statement.revisionNo);
  log("deprecate_statement", { statementId: stmt.statement.id, changeSetId: depr.id });

  const csInfo = await ctx.kc.getChangeSet(cs);
  log("get_changeset", { id: csInfo.id, status: csInfo.status, itemCount: csInfo.itemCount });

  const card = await ctx.cards.loadCard(created.entity.id);
  log("get_card", { profile: card.profile?.profileCode, slots: card.slots.length });

  if (ctx.session.writeMode === "propose") {
    // commit requires elevate — smoke uses direct kc commit after tools
  }
  await ctx.kc.commitChangeSet(cs);
  ctx.clearActiveChangeSet();
  log("commit_changeset");

  // OE roundtrip via file path
  const roots = config.fileRoots.length
    ? config.fileRoots
    : [fs.mkdtempSync(path.join(os.tmpdir(), "itmap-mcp-oe-"))];
  if (!config.fileRoots.length) {
    process.env.ITMAP_MCP_FILE_ROOTS = roots[0];
  }
  const outPath = path.join(roots[0], `smoke-export-${stamp}.xml`);
  const exported = await exportOpenExchange({
    packageCode: writePkg,
    kc: ctx.kc,
    schema: ctx.schema,
  });
  const safeOut = resolveSafePath(outPath, roots);
  fs.writeFileSync(safeOut, exported.xml, "utf8");
  log("export_open_exchange", { path: safeOut, bytes: exported.xml.length });

  ctx.approveWritePackage(writePkg);
  const importCs = await ctx.ensureOpenChangeSet("mcp-smoke-oe-import");
  await importOpenExchange({
    xml: exported.xml,
    packageCode: writePkg,
    kc: ctx.kc,
    schema: ctx.schema,
  });
  await ctx.kc.commitChangeSet(importCs);
  ctx.clearActiveChangeSet();
  log("import_open_exchange", { changeSet: importCs });

  // Cross-package read (metamodel class) must work without write approval on that package
  const meta = await ctx.kc.getEntity(ctx.schema.classIri("BusinessActor"));
  log("cross-package read", { id: meta.id, package: meta.packageCode });

  console.log("\nAll MCP smoke checks passed.");
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
