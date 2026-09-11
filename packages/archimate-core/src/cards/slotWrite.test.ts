import { describe, expect, it } from "vitest";
import {
  listAllowedForSubject,
  modelActionForEdge,
  pickCreateClass,
  resolveSlotEndpoints,
} from "./slotWrite";
import type { SchemaResolver, SchemaSnapshot } from "../schema";

describe("resolveSlotEndpoints", () => {
  it("maps outgoing to subject→neighbor / from-selected-to-new", () => {
    expect(resolveSlotEndpoints("S", "N", "outgoing")).toEqual({
      sourceId: "S",
      targetId: "N",
      modelDirection: "from-selected-to-new",
    });
  });

  it("maps incoming to neighbor→subject / from-new-to-selected", () => {
    expect(resolveSlotEndpoints("S", "N", "incoming")).toEqual({
      sourceId: "N",
      targetId: "S",
      modelDirection: "from-new-to-selected",
    });
  });
});

describe("pickCreateClass", () => {
  it("uses explicit class", () => {
    expect(pickCreateClass(["A", "B"], "B")).toBe("B");
  });

  it("uses single target class", () => {
    expect(pickCreateClass(["BusinessRole"])).toBe("BusinessRole");
  });

  it("throws when multiple and no explicit", () => {
    expect(() => pickCreateClass(["A", "B"])).toThrow(/více cílových tříd/);
  });

  it("throws when empty and no explicit", () => {
    expect(() => pickCreateClass([])).toThrow(/nemá targetClasses/);
  });
});

describe("modelActionForEdge", () => {
  it("builds ModelAddAction with direction mapping", () => {
    const action = modelActionForEdge({
      createsClass: "BusinessRole",
      relationshipType: "Assignment",
      direction: "outgoing",
      relationshipDefaults: { associationKind: "reportsTo" },
      elementDefaults: { actorKind: "person" },
    });
    expect(action).toEqual({
      createsClass: "BusinessRole",
      defaults: { actorKind: "person" },
      derivesRelationship: "Assignment",
      relationshipDirection: "from-selected-to-new",
      relationshipDefaults: { associationKind: "reportsTo" },
    });

    expect(
      modelActionForEdge({
        createsClass: "BusinessActor",
        relationshipType: "Composition",
        direction: "incoming",
      }).relationshipDirection,
    ).toBe("from-new-to-selected");
  });
});

describe("listAllowedForSubject", () => {
  it("lists outgoing and incoming rows for the subject class", () => {
    const snap = {
      allowed: [
        {
          typeLocal: "Serving",
          typeIri: "T-s",
          sourceLocal: "ApplicationComponent",
          sourceIri: "C-app",
          targetLocal: "BusinessProcess",
          targetIri: "C-bp",
        },
        {
          typeLocal: "Assignment",
          typeIri: "T-a",
          sourceLocal: "BusinessActor",
          sourceIri: "C-ba",
          targetLocal: "ApplicationComponent",
          targetIri: "C-app",
        },
        {
          typeLocal: "Flow",
          typeIri: "T-f",
          sourceLocal: "Node",
          sourceIri: "C-n",
          targetLocal: "Device",
          targetIri: "C-d",
        },
      ],
    } as unknown as SchemaSnapshot;

    const schema = {
      snapshot: snap,
      classLabel: (local: string) => local,
    } as unknown as SchemaResolver;

    const rows = listAllowedForSubject(schema, "ApplicationComponent");
    expect(rows.map((r) => `${r.direction}:${r.typeLocal}:${r.otherClassLocal}`)).toEqual([
      "outgoing:Serving:BusinessProcess",
      "incoming:Assignment:BusinessActor",
    ]);
  });
});
