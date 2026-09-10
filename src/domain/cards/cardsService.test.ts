import { describe, expect, it, vi } from "vitest";
import { CardsService } from "./cardsService";
import type { CardsProfileLoader } from "./profileLoader";
import type { PresentationProfileDef } from "./types";
import type { KcClient } from "@/kc/client";
import type { SchemaResolver, SchemaSnapshot } from "@/kc/schema";
import type { Entity, ListResponse, Statement } from "@/kc/types";

function entity(id: string, label: string, classIri?: string): Entity {
  return {
    id,
    status: "active",
    kind: "entity",
    revisionNo: 1,
    labels: { cs: label },
    effectiveClasses: classIri ? [classIri] : undefined,
  };
}

function profile(p: Partial<PresentationProfileDef> & Pick<PresentationProfileDef, "profileCode" | "archimateElementType">): PresentationProfileDef {
  return {
    id: p.profileCode,
    profileCode: p.profileCode,
    archimateElementType: p.archimateElementType,
    matchProperties: p.matchProperties || {},
    fieldProperties: p.fieldProperties || ["shouldNotLoad"],
    labelCs: p.labelCs || p.profileCode,
    sortOrder: 0,
    slots: [],
  };
}

describe("CardsService.listBrowsableEntities", () => {
  it("pages with cursor and does not request statements when class has no match props", async () => {
    const listCalls: Array<{ cursor?: string; limit?: number }> = [];
    const getStatements = vi.fn(async () => ({ items: [] as Statement[] }));

    const page1: Entity[] = Array.from({ length: 50 }, (_, i) =>
      entity(`Q${String(i).padStart(3, "0")}`, `E${i}`, "C-app"),
    );
    const page2: Entity[] = [entity("Q050", "E50", "C-app")];

    const kc = {
      listEntities: async (params: { cursor?: string; limit?: number; include?: string }) => {
        listCalls.push({ cursor: params.cursor, limit: params.limit });
        expect(params.include).toContain("effectiveClasses");
        if (!params.cursor) {
          return { items: page1, nextCursor: "Q049" } satisfies ListResponse<Entity>;
        }
        return { items: page2 } satisfies ListResponse<Entity>;
      },
      listEntityFacets: async () => ({
        facets: [{ classId: "C-app", count: 51 }],
      }),
      getStatements,
    } as unknown as KcClient;

    const snap = {
      instanceOfProperty: "P-io",
      classesByLocal: new Map([["ApplicationComponent", { id: "C-app" }]]),
      propertiesByLocal: new Map(),
      classIriToLocal: new Map([["C-app", "ApplicationComponent"]]),
      propertyIriToLocal: new Map(),
      relSource: "P-src",
      relTarget: "P-tgt",
      allowed: [],
      enums: new Map(),
      loadedAt: 0,
    } as unknown as SchemaSnapshot;

    const schema = {
      snapshot: snap,
      propertyLocal: () => undefined,
      tryPropertyIri: () => undefined,
    } as unknown as SchemaResolver;

    const loader = {
      loadAllProfiles: async () => [
        profile({
          profileCode: "app",
          archimateElementType: "ApplicationComponent",
          matchProperties: {},
          fieldProperties: ["shouldNotLoad"],
        }),
      ],
    } as unknown as CardsProfileLoader;

    const svc = new CardsService(kc, schema, loader);
    const first = await svc.listBrowsableEntities("org", { pageSize: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe("Q049");
    expect(first.total).toBe(51);
    expect(first.typeFacets).toEqual([{ classLocal: "ApplicationComponent", count: 51 }]);
    expect(getStatements).not.toHaveBeenCalled();
    expect(listCalls).toHaveLength(1);

    const second = await svc.listBrowsableEntities("org", {
      pageSize: 50,
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(listCalls).toHaveLength(2);
    expect(listCalls[1].cursor).toBe("Q049");
    expect(getStatements).not.toHaveBeenCalled();
  });

  it("fetches statements once per entity when matchProperties are needed", async () => {
    const getStatements = vi.fn(async (id: string) => ({
      items: [
        {
          id: `S-${id}`,
          subject: id,
          property: "P-actorKind",
          value: { type: "String" as const, string: "person" },
        },
      ] as Statement[],
    }));

    const kc = {
      listEntities: async () =>
        ({
          items: [entity("Q1", "Alice", "C-actor")],
        }) satisfies ListResponse<Entity>,
      listEntityFacets: async () => ({
        facets: [{ classId: "C-actor", count: 1 }],
      }),
      getStatements,
    } as unknown as KcClient;

    const snap = {
      instanceOfProperty: "P-io",
      classesByLocal: new Map([["BusinessActor", { id: "C-actor" }]]),
      propertiesByLocal: new Map(),
      classIriToLocal: new Map([["C-actor", "BusinessActor"]]),
      propertyIriToLocal: new Map([["P-actorKind", "actorKind"]]),
      relSource: "P-src",
      relTarget: "P-tgt",
      allowed: [],
      enums: new Map(),
      loadedAt: 0,
    } as unknown as SchemaSnapshot;

    const schema = {
      snapshot: snap,
      propertyLocal: (iri: string) => (iri === "P-actorKind" ? "actorKind" : undefined),
      tryPropertyIri: () => undefined,
    } as unknown as SchemaResolver;

    const loader = {
      loadAllProfiles: async () => [
        profile({
          profileCode: "person",
          archimateElementType: "BusinessActor",
          matchProperties: { actorKind: "person" },
          fieldProperties: ["email"],
          labelCs: "Osoba",
        }),
      ],
    } as unknown as CardsProfileLoader;

    const svc = new CardsService(kc, schema, loader);
    const page = await svc.listBrowsableEntities("org", { pageSize: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].profile?.labelCs).toBe("Osoba");
    expect(getStatements).toHaveBeenCalledTimes(1);
    expect(getStatements).toHaveBeenCalledWith("Q1");
  });

  it("resolveEntityLabels uses batch-read", async () => {
    const batchReadEntities = vi.fn(async ({ ids }: { ids: string[] }) => ({
      results: ids.map((id) =>
        id === "Q-missing"
          ? { id, error: "not_found" }
          : {
              id,
              entity: entity(id, `Label-${id}`),
            },
      ),
    }));
    const getEntity = vi.fn();
    const kc = { batchReadEntities, getEntity } as unknown as KcClient;
    const schema = { snapshot: {} } as unknown as SchemaResolver;
    const loader = { loadAllProfiles: async () => [] } as unknown as CardsProfileLoader;
    const svc = new CardsService(kc, schema, loader);
    const map = await svc.resolveEntityLabels(["Q1", "Q1", "Q-missing"]);
    expect(batchReadEntities).toHaveBeenCalledTimes(1);
    expect(getEntity).not.toHaveBeenCalled();
    expect(map.get("Q1")).toBe("Label-Q1");
    expect(map.get("Q-missing")).toBe("Q-missing");
  });
});
