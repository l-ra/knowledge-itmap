#!/usr/bin/env node
/**
 * Bundle MCP server + @itmap/archimate-core into a single runnable ESM file.
 * npm dependencies stay external (resolved from node_modules at runtime).
 *
 * Usage: node server/build.mjs
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(__dirname, "dist", "index.js");
const coreEntry = path.resolve(__dirname, "../packages/archimate-core/src/index.ts");

fs.mkdirSync(path.dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(__dirname, "src/index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node\n",
  },
  alias: {
    "@itmap/archimate-core": coreEntry,
  },
  // Bundle workspace TS; leave npm packages in node_modules (CJS/ESM interop).
  packages: "external",
  logLevel: "info",
});

let code = fs.readFileSync(outfile, "utf8");
code = code.replace(/^(#!\/usr\/bin\/env node\n)+/, "#!/usr/bin/env node\n");
fs.writeFileSync(outfile, code);
fs.chmodSync(outfile, 0o755);
console.error(`Wrote ${outfile} (${(fs.statSync(outfile).size / 1024).toFixed(0)} KB)`);
