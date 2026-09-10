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
  log("create_element", { id: created.entity.id, iriLocal: created.entity.iriLocal });

  const svc = await ctx.model.createTypedElement({
    packageCode: writePkg,
    classLocal: "ApplicationService",
    name: `MCP Smoke Svc ${stamp}`,
    iriLocal: `mcp-smoke-svc-${stamp}`,
  });
  log("create_element service", svc.entity.id);

  const rel = await ctx.model.createRelationship({
    packageCode: writePkg,
    typeLocal: "Realization",
    sourceId: created.entity.id,
    targetId: svc.entity.id,
  });
  log("create_relationship", rel.id);

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
