import { describe, expect, it } from "vitest";
import {
  buildShellShareUrl,
  buildTabShareUrl,
  decodeSharePayload,
  encodeSharePayload,
  isSharedShell,
  isSharedTab,
  normalizeSharedShell,
  normalizeSharedTab,
  pruneCardUiMap,
  SHARE_PAYLOAD_GZIP_PREFIX,
  snapshotCardUi,
  type SharedShell,
  type SharedTab,
} from "./workspaceShare";

describe("workspaceShare", () => {
  it("roundtrips tab payload v2 with gzip cardUi", async () => {
    const tab: SharedTab = {
      v: 2,
      kind: "tab",
      rootEntityId: "root-1",
      title: "Root",
      focusId: "child-2",
      columns: [
        [{ entityId: "root-1" }],
        [{ entityId: "child-2", openedFrom: { entityId: "root-1", slotLabel: "Roles" } }],
      ],
      collapsedLevels: [1],
      columnWidths: { "0": 400 },
      cardUi: {
        "0:root-1": { hidden: ["props", "expert"], inplace: ["rel::x"] },
        "0:root-1:inplace:rel::x": { hidden: ["desc", "fields", "props"], emptyChips: true },
      },
    };
    const encoded = await encodeSharePayload(tab);
    expect(encoded.startsWith(SHARE_PAYLOAD_GZIP_PREFIX)).toBe(true);
    const decoded = await decodeSharePayload(encoded);
    expect(isSharedTab(decoded)).toBe(true);
    expect(normalizeSharedTab(decoded)).toEqual(tab);
    const url = await buildTabShareUrl("http://localhost:5173", tab);
    expect(url).toContain("/cards/child-2?ws=gz1.");
  });

  it("decodes legacy uncompressed base64url payload", async () => {
    const legacy = {
      v: 1,
      kind: "tab",
      rootEntityId: "a",
      title: "A",
      focusId: "a",
      columns: [[{ entityId: "a" }]],
    };
    const raw = btoa(JSON.stringify(legacy))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const decoded = await decodeSharePayload(raw);
    expect(normalizeSharedTab(decoded)?.rootEntityId).toBe("a");
    expect(normalizeSharedTab(decoded)?.v).toBe(2);
  });

  it("migrates legacy v1 tab to v2", () => {
    const legacy = {
      v: 1,
      kind: "tab",
      rootEntityId: "a",
      title: "A",
      focusId: "a",
      columns: [[{ entityId: "a" }]],
    };
    const normalized = normalizeSharedTab(legacy);
    expect(normalized?.v).toBe(2);
    expect(normalized?.cardUi).toBeUndefined();
    expect(normalized?.rootEntityId).toBe("a");
  });

  it("roundtrips shell payload v2 gzip", async () => {
    const shell: SharedShell = {
      v: 2,
      kind: "shell",
      active: 0,
      tabs: [
        {
          v: 2,
          rootEntityId: "a",
          title: "A",
          focusId: "a",
          columns: [[{ entityId: "a" }]],
          cardUi: { "0:a": { hidden: ["props"] } },
        },
      ],
    };
    const encoded = await encodeSharePayload(shell);
    expect(encoded.startsWith(SHARE_PAYLOAD_GZIP_PREFIX)).toBe(true);
    const decoded = await decodeSharePayload(encoded);
    expect(isSharedShell(decoded)).toBe(true);
    expect(normalizeSharedShell(decoded)).toEqual(shell);
    expect(await buildShellShareUrl("http://x", shell)).toContain("/cards?shell=gz1.");
  });

  it("migrates legacy v1 shell tabs", () => {
    const legacy = {
      v: 1,
      kind: "shell",
      active: "hub",
      tabs: [
        {
          rootEntityId: "a",
          title: "A",
          focusId: "a",
          columns: [[{ entityId: "a" }]],
        },
      ],
    };
    const normalized = normalizeSharedShell(legacy);
    expect(normalized?.v).toBe(2);
    expect(normalized?.tabs[0]?.v).toBe(2);
  });

  it("snapshots and prunes cardUi", () => {
    expect(
      snapshotCardUi({
        hidden: ["props", "desc"],
        inplaceOpen: { a: true, b: false },
        emptyChips: false,
      }),
    ).toEqual({ hidden: ["desc", "props"], inplace: ["a"] });

    const map = {
      "0:x": { hidden: ["props"] },
      "0:x:inplace:k": { emptyChips: true },
      "1:y": { hidden: ["desc"] },
    };
    expect(pruneCardUiMap(map, "0:x")).toEqual({ "1:y": { hidden: ["desc"] } });
  });
});
