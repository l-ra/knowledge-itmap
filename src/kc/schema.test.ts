import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  SchemaResolver,
  hydrateSnapshot,
  serializeSnapshot,
  resetSchemaForTests,
  type SchemaSnapshot,
} from "./schema";
import { schemaFingerprint } from "./schemaFingerprint";
import type { KcClient } from "./client";
import type { Entity, PackageInfo, PropertyEntity, Statement } from "./types";

function ent(
  id: string,
  iriLocal: string,
  kind: Entity["kind"] = "class",
  extra?: Partial<Entity>,
): Entity {
  return {
    id,
    status: "active",
    kind,
    revisionNo: 1,
    labels: { en: iriLocal },
    iriLocal,
    ...extra,
  };
}

function prop(id: string, iriLocal: string): PropertyEntity {
  return {
    ...ent(id, iriLocal, "property"),
    kind: "property",
    datatype: "EntityReference",
  };
}

function refStmt(property: string, entityId: string): Statement {
  return {
    id: `S-${property}-${entityId}`,
    subject: "row",
    property,
    value: { type: "EntityReference", entityId },
  };
}

describe("schemaFingerprint", () => {
  it("changes when release version or dirty flag changes", () => {
    const base: PackageInfo[] = [
      {
        code: "archimate-lite",
        lifecycle: "released",
        labels: {},
        latestReleaseVersion: "3.2.0",
        modifiedAfterRelease: false,
        updatedAt: "t1",
      },
      { code: "kc-base", lifecycle: "released", labels: {}, latestReleaseVersion: "1.0.0" },
      {
        code: "archimate-ui-traversal",
        lifecycle: "released",
        labels: {},
        latestReleaseVersion: "1.0.0",
      },
      {
        code: "archimate-ui-cards",
        lifecycle: "released",
        labels: {},
        latestReleaseVersion: "1.0.0",
      },
    ];
    const a = schemaFingerprint(base, "cfg1");
    const b = schemaFingerprint(
      base.map((p) =>
        p.code === "archimate-lite" ? { ...p, latestReleaseVersion: "3.2.1" } : p,
      ),
      "cfg1",
    );
    const c = schemaFingerprint(
      base.map((p) =>
        p.code === "archimate-lite" ? { ...p, modifiedAfterRelease: true } : p,
      ),
      "cfg1",
    );
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain("cfg:cfg1");
  });
});

describe("serialize/hydrate", () => {
  it("round-trips Maps", () => {
    const snap: SchemaSnapshot = {
      instanceOfProperty: "P-io",
      classesByLocal: new Map([["ApplicationComponent", ent("C1", "ApplicationComponent")]]),
      propertiesByLocal: new Map([["relSource", prop("P1", "relSource")]]),
      classIriToLocal: new Map([["C1", "ApplicationComponent"]]),
      propertyIriToLocal: new Map([["P1", "relSource"]]),
      relSource: "P1",
      relTarget: "P2",
      allowed: [
        {
          typeLocal: "Serving",
          typeIri: "C-srv",
          sourceLocal: "A",
          sourceIri: "C-a",
          targetLocal: "B",
          targetIri: "C-b",
        },
      ],
      enums: new Map([["actorKind", ["Person", "Organization"]]]),
      loadedAt: 42,
    };
    const payload = serializeSnapshot("fp1", snap);
    const back = hydrateSnapshot(payload);
    expect(back.instanceOfProperty).toBe("P-io");
    expect(back.classesByLocal.get("ApplicationComponent")?.id).toBe("C1");
    expect(back.enums.get("actorKind")).toEqual(["Person", "Organization"]);
    expect(back.allowed).toHaveLength(1);
    expect(payload.fingerprint).toBe("fp1");
  });
});

describe("SchemaResolver.loadAllowed (phase-22)", () => {
  beforeEach(() => {
    resetSchemaForTests();
  });

  it("uses include=statements + batch-read instead of per-row getEntity", async () => {
    const listEntities = vi.fn(async (params: Record<string, unknown>) => {
      if (params.kind === "class" && params.package === "archimate-lite") {
        return {
          items: [
            ent("C-allowed", "AllowedRelationship"),
            ent("C-srv", "Serving"),
            ent("C-src", "ApplicationComponent"),
            ent("C-tgt", "BusinessService"),
          ],
        };
      }
      if (params.kind === "property" && params.package === "archimate-lite") {
        return {
          items: [
            prop("P-type", "allowedRelType"),
            prop("P-src", "allowedSourceClass"),
            prop("P-tgt", "allowedTargetClass"),
            prop("P-relS", "relSource"),
            prop("P-relT", "relTarget"),
          ],
        };
      }
      if (params.kind === "property") {
        return { items: [prop("P-io", "instanceOf"), prop("P-av", "allowedValue")] };
      }
      if (params.kind === "class") {
        return { items: [] };
      }
      if (params.instanceOf === "C-allowed") {
        expect(params.include).toBe("statements");
        expect(String(params.properties)).toContain("allowedRelType");
        return {
          items: [
            {
              ...ent("Q-row1", "allowed-1", "entity"),
              statements: [
                refStmt("P-type", "C-srv"),
                refStmt("P-src", "C-src"),
                refStmt("P-tgt", "C-tgt"),
              ],
            },
          ],
        };
      }
      if (typeof params.iriLocal === "string" && String(params.iriLocal).startsWith("enum/")) {
        return { items: [] };
      }
      return { items: [] };
    });

    const batchReadEntities = vi.fn(async ({ ids }: { ids: string[] }) => ({
      results: ids.map((id) => {
        const local =
          id === "C-srv"
            ? "Serving"
            : id === "C-src"
              ? "ApplicationComponent"
              : id === "C-tgt"
                ? "BusinessService"
                : id;
        return { id, entity: ent(id, local) };
      }),
    }));

    const getEntity = vi.fn();
    const getStatements = vi.fn();

    const kc = {
      getSchemaConfig: async () => ({ instanceOfProperty: "P-io" }),
      listEntities,
      batchReadEntities,
      getEntity,
      getStatements,
    } as unknown as KcClient;

    const schema = new SchemaResolver(kc);
    const snap = await schema.load({ force: true });

    expect(batchReadEntities).toHaveBeenCalled();
    expect(getEntity).not.toHaveBeenCalled();
    expect(getStatements).not.toHaveBeenCalled();
    expect(snap.allowed).toEqual([
      {
        typeLocal: "Serving",
        typeIri: "C-srv",
        sourceLocal: "ApplicationComponent",
        sourceIri: "C-src",
        targetLocal: "BusinessService",
        targetIri: "C-tgt",
      },
    ]);
  });

  it("dedupes concurrent load() calls (StrictMode)", async () => {
    let calls = 0;
    const kc = {
      getSchemaConfig: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return { instanceOfProperty: "P-io" };
      },
      listEntities: async (params: Record<string, unknown>) => {
        if (params.kind === "property" && params.package === "archimate-lite") {
          return {
            items: [prop("P-relS", "relSource"), prop("P-relT", "relTarget")],
          };
        }
        return { items: [] };
      },
      batchReadEntities: async () => ({ results: [] }),
      getEntity: async () => ent("x", "x"),
      getStatements: async () => ({ items: [] }),
    } as unknown as KcClient;

    const schema = new SchemaResolver(kc);
    const [a, b] = await Promise.all([schema.load({ force: true }), schema.load({ force: true })]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("reuses memory snapshot when fingerprint matches", async () => {
    const getSchemaConfig = vi.fn(async () => ({ instanceOfProperty: "P-io" }));
    const kc = {
      getSchemaConfig,
      listEntities: async (params: Record<string, unknown>) => {
        if (params.kind === "property" && params.package === "archimate-lite") {
          return {
            items: [prop("P-relS", "relSource"), prop("P-relT", "relTarget")],
          };
        }
        return { items: [] };
      },
      batchReadEntities: async () => ({ results: [] }),
      getEntity: async () => ent("x", "x"),
      getStatements: async () => ({ items: [] }),
    } as unknown as KcClient;

    const schema = new SchemaResolver(kc);
    await schema.load({ fingerprint: "fp-same", force: true });
    getSchemaConfig.mockClear();
    await schema.load({ fingerprint: "fp-same" });
    expect(getSchemaConfig).not.toHaveBeenCalled();
  });
});
