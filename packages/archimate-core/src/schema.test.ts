import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  SchemaResolver,
  hydrateSnapshot,
  serializeSnapshot,
  type SchemaSnapshot,
} from "./schema";
import { schemaFingerprint } from "./schemaFingerprint";
import type { KcClient } from "./kcClient";
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
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe("serializeSnapshot / hydrateSnapshot", () => {
  it("round-trips maps", () => {
    const snap: SchemaSnapshot = {
      instanceOfProperty: "P-io",
      classesByLocal: new Map([["Serving", ent("C-srv", "Serving")]]),
      propertiesByLocal: new Map([["relSource", prop("P-relS", "relSource")]]),
      classIriToLocal: new Map([["C-srv", "Serving"]]),
      propertyIriToLocal: new Map([["P-relS", "relSource"]]),
      relSource: "P-relS",
      relTarget: "P-relT",
      allowed: [
        {
          typeLocal: "Serving",
          typeIri: "C-srv",
          sourceLocal: "ApplicationComponent",
          sourceIri: "C-app",
          targetLocal: "BusinessService",
          targetIri: "C-bs",
        },
      ],
      enums: new Map([["flowKind", ["a", "b"]]]),
      loadedAt: 123,
    };
    const payload = serializeSnapshot("fp1", snap);
    const back = hydrateSnapshot(payload) as SchemaSnapshot;
    expect(back.instanceOfProperty).toBe("P-io");
    expect(back.classesByLocal.get("Serving")?.id).toBe("C-srv");
    expect(back.enums.get("flowKind")).toEqual(["a", "b"]);
    expect(back.allowed).toHaveLength(1);
  });
});

describe("SchemaResolver", () => {
  beforeEach(() => {
    /* no package-level singleton */
  });

  it("loads AllowedRelationship via include=statements + batch-read", async () => {
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
            prop("P-relS", "relSource"),
            prop("P-relT", "relTarget"),
            prop("P-art", "allowedRelType"),
            prop("P-asc", "allowedSourceClass"),
            prop("P-atc", "allowedTargetClass"),
          ],
        };
      }
      if (params.instanceOf === "C-allowed") {
        return {
          items: [
            {
              ...ent("row1", "allowed-1"),
              statements: [
                refStmt("P-art", "C-srv"),
                refStmt("P-asc", "C-src"),
                refStmt("P-atc", "C-tgt"),
              ],
            },
          ],
        };
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

    const getEntity = vi.fn(async (id: string) => {
      if (id === "P-io") return prop("P-io", "instanceOf");
      throw new Error(`unexpected getEntity ${id}`);
    });
    const getStatements = vi.fn();

    const kc = {
      getSchemaConfig: async () => ({ instanceOfProperty: "P-io" }),
      listEntities,
      batchReadEntities,
      getEntity,
      getStatements,
    } as unknown as KcClient;

    const schema = new SchemaResolver({ kc });
    const snap = await schema.load({ force: true });

    expect(batchReadEntities).toHaveBeenCalled();
    expect(getEntity).toHaveBeenCalledWith("P-io");
    expect(getStatements).not.toHaveBeenCalled();
    expect(snap.instanceOfProperty).toBe("P-io");
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

  it("fails load when schema-config instanceOfProperty entity is missing", async () => {
    const kc = {
      getSchemaConfig: async () => ({ instanceOfProperty: "P-missing-io" }),
      listEntities: async () => ({ items: [] }),
      batchReadEntities: async () => ({ results: [] }),
      getEntity: async () => {
        throw new Error("not found");
      },
      getStatements: async () => ({ items: [] }),
    } as unknown as KcClient;

    const schema = new SchemaResolver({ kc });
    await expect(schema.load({ force: true })).rejects.toThrow(/P-missing-io/);
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

    const schema = new SchemaResolver({ kc });
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

    const schema = new SchemaResolver({ kc });
    await schema.load({ fingerprint: "fp-same", force: true });
    getSchemaConfig.mockClear();
    await schema.load({ fingerprint: "fp-same" });
    expect(getSchemaConfig).not.toHaveBeenCalled();
  });

  it("isAllowed returns false for unknown triples", async () => {
    const kc = {
      getSchemaConfig: async () => ({ instanceOfProperty: "P-io" }),
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
    const schema = new SchemaResolver({ kc });
    await schema.load({ force: true });
    expect(schema.isAllowed("Serving", "ApplicationComponent", "BusinessService")).toBe(false);
  });
});
