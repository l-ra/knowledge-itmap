#!/usr/bin/env node
/**
 * Live acceptance smoke against a running Knowledge Core.
 *
 * Requires env (same as MCP server):
 *   ITMAP_KC_BASE_URL, ITMAP_MCP_ORG_PACKAGE,
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

  const listed = await ctx.kc.listEntities({
    package: config.orgPackage,
    limit: 5,
  });
  log("list_entities", { count: listed.items.length, package: config.orgPackage });

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
    packageCode: config.orgPackage,
    classLocal: "ApplicationComponent",
    name: `MCP Smoke App ${stamp}`,
    iriLocal: `mcp-smoke-app-${stamp}`,
  });
  log("create_element", { id: created.entity.id, iriLocal: created.entity.iriLocal });

  const svc = await ctx.model.createTypedElement({
    packageCode: config.orgPackage,
    classLocal: "ApplicationService",
    name: `MCP Smoke Svc ${stamp}`,
    iriLocal: `mcp-smoke-svc-${stamp}`,
  });
  const rel = await ctx.model.createRelationship({
    packageCode: config.orgPackage,
    typeLocal: "Realization",
    sourceId: created.entity.id,
    targetId: svc.entity.id,
  });
  log("create_relationship", { id: rel.id, type: "Realization" });

  const card = await ctx.cards.loadCard(created.entity.id);
  log("get_card", {
    profile: card.profile?.profileCode ?? null,
    slots: card.slots.length,
    classLocal: card.classLocal,
  });

  if (ctx.session.writeMode !== "propose") {
    throw new Error("smoke expects ITMAP_MCP_WRITE_MODE=propose");
  }
  await ctx.kc.commitChangeSet(cs);
  ctx.clearActiveChangeSet();
  log("commit_changeset after propose edits");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "itmap-mcp-smoke-"));
  try {
    const roots = [tmpRoot];
    (ctx.config as { fileRoots: string[] }).fileRoots = roots;

    const exported = await exportOpenExchange({
      packageCode: config.orgPackage,
      kc: ctx.kc,
      schema: ctx.schema,
    });
    const exportPath = resolveSafePath(path.join(roots[0], `smoke-export-${stamp}.xml`), roots);
    fs.writeFileSync(exportPath, exported.xml, "utf8");
    log("export_open_exchange path", {
      path: exportPath,
      bytes: Buffer.byteLength(exported.xml, "utf8"),
    });

    const mini = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-smoke-${stamp}">
  <name xml:lang="en">Smoke</name>
  <elements>
    <element identifier="id-smoke-el-${stamp}" xsi:type="ApplicationComponent">
      <name xml:lang="en">Smoke Path Import ${stamp}</name>
    </element>
  </elements>
</model>`;
    const importPath = resolveSafePath(path.join(roots[0], `smoke-import-${stamp}.xml`), roots);
    fs.writeFileSync(importPath, mini, "utf8");
    const importCs = await ctx.ensureOpenChangeSet("mcp-smoke-oe");
    const xml = fs.readFileSync(importPath, "utf8");
    const imp = await importOpenExchange({
      xml,
      packageCode: config.orgPackage,
      kc: ctx.kc,
      schema: ctx.schema,
    });
    await ctx.kc.cancelChangeSet(importCs);
    ctx.clearActiveChangeSet();
    log("import_open_exchange path", {
      path: importPath,
      created: imp.created,
      cancelledCs: importCs,
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log("\nMCP live acceptance smoke OK");
}

main().catch((e) => {
  console.error("\nMCP smoke FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
