import { describe, expect, it } from "vitest";
import { assertAllowed } from "./allowedRelationship";

describe("assertAllowed", () => {
  const schema = {
    isAllowed(typeLocal: string, sourceLocal: string, targetLocal: string) {
      return (
        typeLocal === "Serving" &&
        sourceLocal === "ApplicationComponent" &&
        targetLocal === "BusinessService"
      );
    },
  };

  it("allows matrix hits", () => {
    expect(() =>
      assertAllowed(schema, "Serving", "ApplicationComponent", "BusinessService"),
    ).not.toThrow();
  });

  it("rejects disallowed triples with clear Czech message", () => {
    expect(() => assertAllowed(schema, "Serving", "BusinessActor", "Node")).toThrow(
      /Vztah Serving není dovolen mezi BusinessActor → Node \(AllowedRelationship\)\./,
    );
  });
});
