import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a user-supplied path under one of the allowed roots (realpath).
 * Rejects path traversal outside roots.
 */
export function resolveSafePath(userPath: string, allowedRoots: string[]): string {
  if (!userPath?.trim()) {
    throw new Error("path is required");
  }
  if (!allowedRoots.length) {
    throw new Error(
      "File-path OE tools require ITMAP_MCP_FILE_ROOTS (colon- or comma-separated absolute directories)",
    );
  }

  const abs = path.resolve(userPath.trim());
  let resolved: string;
  try {
    // If the file does not exist yet (export), resolve parent + basename.
    if (fs.existsSync(abs)) {
      resolved = fs.realpathSync(abs);
    } else {
      const parent = path.dirname(abs);
      if (!fs.existsSync(parent)) {
        throw new Error(`Parent directory does not exist: ${parent}`);
      }
      resolved = path.join(fs.realpathSync(parent), path.basename(abs));
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Parent")) throw e;
    throw new Error(`Cannot resolve path „${userPath}“: ${e instanceof Error ? e.message : e}`);
  }

  const ok = allowedRoots.some((root) => {
    const r = fs.realpathSync(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
  if (!ok) {
    throw new Error(
      `Path „${resolved}“ is outside ITMAP_MCP_FILE_ROOTS (${allowedRoots.join(", ")})`,
    );
  }
  return resolved;
}

export function parseFileRoots(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,:]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const abs = path.resolve(s);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        throw new Error(`ITMAP_MCP_FILE_ROOTS entry is not a directory: ${s}`);
      }
      return fs.realpathSync(abs);
    });
}
