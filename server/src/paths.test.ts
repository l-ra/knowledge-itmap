import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFileRoots, resolveSafePath } from "./paths";

describe("resolveSafePath", () => {
  it("rejects when no roots configured", () => {
    expect(() => resolveSafePath("/tmp/a.xml", [])).toThrow(/ITMAP_MCP_FILE_ROOTS/);
  });

  it("allows paths under root", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itmap-mcp-path-"));
    try {
      const file = path.join(tmp, "model.xml");
      fs.writeFileSync(file, "<x/>");
      expect(resolveSafePath(file, [tmp])).toBe(fs.realpathSync(file));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects traversal outside root", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itmap-mcp-path-"));
    const outside = path.join(os.tmpdir(), `itmap-outside-${Date.now()}.xml`);
    fs.writeFileSync(outside, "<x/>");
    try {
      expect(() => resolveSafePath(outside, [tmp])).toThrow(/outside ITMAP_MCP_FILE_ROOTS/);
    } finally {
      fs.unlinkSync(outside);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("allows export path when parent exists under root", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itmap-mcp-path-"));
    try {
      const out = path.join(tmp, "out", "export.xml");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const resolved = resolveSafePath(out, [tmp]);
      expect(resolved.endsWith(`${path.sep}out${path.sep}export.xml`)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("parseFileRoots", () => {
  it("returns empty for unset", () => {
    expect(parseFileRoots(undefined)).toEqual([]);
    expect(parseFileRoots("")).toEqual([]);
  });
});
