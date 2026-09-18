import { describe, expect, it } from "vitest";
import {
  projectRelationImpact,
  resolveInstanceOfWriteMode,
  toStatementValue,
  type IncidentRelationship,
} from "./graphMutations";
import { missingRequiredPropLocals, type ClassConstraints } from "./classConstraints";
import { extractValidationPayload } from "./errors";

describe("projectRelationImpact", () => {
  const schema = {
    isAllowed(typeLocal: string, sourceLocal: string, targetLocal: string) {
      if (
        typeLocal === "Serving" &&
        sourceLocal === "ApplicationComponent" &&
        targetLocal === "BusinessProcess"
      ) {
        return true;
      }
      if (
        typeLocal === "Association" &&
        sourceLocal === "BusinessActor" &&
        targetLocal === "BusinessActor"
      ) {
        return true;
      }
      return false;
    },
  };

  const servingAsSource: IncidentRelationship = {
    relationshipId: "R1",
    typeLocal: "Serving",
    sourceId: "E1",
    targetId: "E2",
    sourceClassLocal: "ApplicationService",
    targetClassLocal: "BusinessProcess",
    role: "source",
  };

  it("reports invalid when new class breaks matrix", () => {
    const invalid = projectRelationImpact(schema, [servingAsSource], "ApplicationService");
    expect(invalid).toHaveLength(1);
    expect(invalid[0].sourceClassLocal).toBe("ApplicationService");
    expect(invalid[0].reason).toMatch(/Serving/);
  });

  it("allows when new class satisfies matrix", () => {
    const invalid = projectRelationImpact(schema, [servingAsSource], "ApplicationComponent");
    expect(invalid).toHaveLength(0);
  });

  it("projects target-role class change", () => {
    const asTarget: IncidentRelationship = {
      ...servingAsSource,
      role: "target",
      sourceClassLocal: "ApplicationComponent",
      targetClassLocal: "BusinessService",
    };
    const invalid = projectRelationImpact(schema, [asTarget], "Node");
    expect(invalid).toHaveLength(1);
    expect(invalid[0].targetClassLocal).toBe("Node");
  });

  it("peer projection clears Association false alarm between batch peers", () => {
    const assoc: IncidentRelationship = {
      relationshipId: "R-assoc",
      typeLocal: "Association",
      sourceId: "A",
      targetId: "B",
      sourceClassLocal: "BusinessFunction",
      targetClassLocal: "BusinessFunction",
      role: "source",
    };
    const withoutPeer = projectRelationImpact(schema, [assoc], "BusinessActor");
    expect(withoutPeer).toHaveLength(1);

    const peerMap = new Map([
      ["A", "BusinessActor"],
      ["B", "BusinessActor"],
    ]);
    const withPeer = projectRelationImpact(schema, [assoc], "BusinessActor", peerMap);
    expect(withPeer).toHaveLength(0);
  });
});

describe("resolveInstanceOfWriteMode", () => {
  it("maps active counts to write modes", () => {
    expect(resolveInstanceOfWriteMode(0)).toBe("create");
    expect(resolveInstanceOfWriteMode(1)).toBe("revise");
    expect(resolveInstanceOfWriteMode(2)).toBe("normalize-multi");
  });
});

describe("missingRequiredPropLocals", () => {
  const constraints: ClassConstraints = {
    classLocal: "BusinessActor",
    classId: "C-actor",
    requiredProperties: [
      { propertyLocal: "actorKind", propertyId: "P-ak" },
      { propertyLocal: "organizationScope", propertyId: "P-os" },
    ],
    recommendedProperties: [],
    source: "test",
    shapeCodes: ["aml-business-actor"],
  };

  it("reports missing when props and existing are empty", () => {
    expect(missingRequiredPropLocals(constraints, undefined, new Set())).toEqual([
      "actorKind",
      "organizationScope",
    ]);
  });

  it("accepts props and existing values", () => {
    expect(
      missingRequiredPropLocals(constraints, { actorKind: "person" }, new Set(["organizationScope"])),
    ).toEqual([]);
  });
});

describe("extractValidationPayload", () => {
  it("parses KC 422 validation findings", () => {
    const payload = extractValidationPayload({
      error: { code: "validation", message: "validation failed" },
      validation: {
        entityId: "E1",
        summary: { errors: 2, warnings: 0 },
        findings: [
          {
            severity: "error",
            code: "shape_required_missing",
            message: "shape aml-business-actor requires property P-ak",
            propertyId: "P-ak",
            shapeCode: "aml-business-actor",
          },
        ],
      },
    });
    expect(payload?.summary.errors).toBe(2);
    expect(payload?.findings[0].code).toBe("shape_required_missing");
    expect(payload?.findings[0].propertyId).toBe("P-ak");
  });
});

describe("toStatementValue", () => {
  it("maps string / boolean / entityRef", () => {
    expect(toStatementValue("string", "x")).toEqual({ type: "String", string: "x" });
    expect(toStatementValue("boolean", true)).toEqual({ type: "Boolean", bool: true });
    expect(toStatementValue("entityRef", "Q1")).toEqual({
      type: "EntityReference",
      entityId: "Q1",
    });
  });

  it("rejects mismatched types", () => {
    expect(() => toStatementValue("string", true)).toThrow(/string/);
    expect(() => toStatementValue("entityRef", "")).toThrow(/entity/);
  });
});
