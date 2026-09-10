import { describe, expect, it } from "vitest";
import {
  classLocalFromEffective,
  classLocalFromStatements,
  classNeedsMatchProps,
  matchKeysForClass,
  propMapFromStatements,
  statementToString,
} from "./hubResolve";
import { resolvePresentationProfile } from "./profileResolver";
import type { PresentationProfileDef } from "./types";
import type { Entity, Statement } from "@/kc/types";

function profile(
  partial: Partial<PresentationProfileDef> & Pick<PresentationProfileDef, "profileCode" | "archimateElementType">,
): PresentationProfileDef {
  return {
    id: partial.id || partial.profileCode,
    profileCode: partial.profileCode,
    archimateElementType: partial.archimateElementType,
    matchProperties: partial.matchProperties || {},
    fieldProperties: partial.fieldProperties || [],
    labelCs: partial.labelCs || partial.profileCode,
    sortOrder: partial.sortOrder ?? 0,
    slots: [],
  };
}

describe("hubResolve helpers", () => {
  it("prefers effectiveClasses for classLocal without statements", () => {
    const map = new Map([
      ["C1", "ApplicationComponent"],
      ["C2", "BusinessActor"],
    ]);
    const entity = {
      id: "Q1",
      effectiveClasses: ["C1"],
    } as Entity;
    expect(classLocalFromEffective(entity, map)).toBe("ApplicationComponent");
  });

  it("skips abstract ancestors in effectiveClasses and returns the concrete class", () => {
    const map = new Map([
      ["C-concept", "ArchiMateConcept"],
      ["C-element", "ArchiMateElement"],
      ["C-app", "ApplicationComponent"],
    ]);
    // Unordered ancestor closure — abstract first (as KC map iteration can yield).
    const entity = {
      id: "Q1",
      effectiveClasses: ["C-concept", "C-element", "C-app"],
    } as Entity;
    expect(classLocalFromEffective(entity, map)).toBe("ApplicationComponent");

    const abstractsOnly = {
      id: "Q2",
      effectiveClasses: ["C-concept", "C-element"],
    } as Entity;
    expect(classLocalFromEffective(abstractsOnly, map)).toBe("ArchiMateConcept");
  });

  it("prefers concrete instanceOf over abstract when multiple are present", () => {
    const classMap = new Map([
      ["C-concept", "ArchiMateConcept"],
      ["C-actor", "BusinessActor"],
    ]);
    const stmts: Statement[] = [
      {
        id: "S0",
        subject: "Q1",
        property: "P-instanceOf",
        value: { type: "EntityReference", entityId: "C-concept" },
      },
      {
        id: "S1",
        subject: "Q1",
        property: "P-instanceOf",
        value: { type: "EntityReference", entityId: "C-actor" },
      },
    ];
    expect(classLocalFromStatements(stmts, "P-instanceOf", classMap)).toBe("BusinessActor");
  });

  it("resolves classLocal + match props from one statements list", () => {
    const classMap = new Map([["C-actor", "BusinessActor"]]);
    const stmts: Statement[] = [
      {
        id: "S1",
        subject: "Q1",
        property: "P-instanceOf",
        value: { type: "EntityReference", entityId: "C-actor" },
      },
      {
        id: "S2",
        subject: "Q1",
        property: "P-actorKind",
        value: { type: "String", string: "person" },
      },
      {
        id: "S3",
        subject: "Q1",
        property: "P-other",
        value: { type: "String", string: "ignored" },
      },
    ];
    expect(classLocalFromStatements(stmts, "P-instanceOf", classMap)).toBe("BusinessActor");

    const propLocal = (iri: string) => {
      if (iri === "P-actorKind") return "actorKind";
      if (iri === "P-other") return "other";
      return undefined;
    };
    const props = propMapFromStatements(stmts, new Set(["actorKind"]), propLocal);
    expect(props).toEqual({ actorKind: "person" });
    expect(statementToString(stmts[1].value)).toBe("person");
  });

  it("classNeedsMatchProps is false when only default (empty match) profiles exist", () => {
    const profiles = [
      profile({
        profileCode: "app-default",
        archimateElementType: "ApplicationComponent",
        matchProperties: {},
        fieldProperties: ["name"],
      }),
    ];
    expect(classNeedsMatchProps(profiles, "ApplicationComponent")).toBe(false);
    expect(matchKeysForClass(profiles, "ApplicationComponent").size).toBe(0);
  });

  it("resolves specific profile from match props; fieldProperties do not affect hub keys", () => {
    const profiles = [
      profile({
        profileCode: "actor-default",
        archimateElementType: "BusinessActor",
        matchProperties: {},
        labelCs: "Aktor",
      }),
      profile({
        profileCode: "actor-person",
        archimateElementType: "BusinessActor",
        matchProperties: { actorKind: "person" },
        fieldProperties: ["email", "phone"],
        labelCs: "Osoba",
      }),
    ];
    expect(classNeedsMatchProps(profiles, "BusinessActor")).toBe(true);
    expect([...matchKeysForClass(profiles, "BusinessActor")]).toEqual(["actorKind"]);

    const resolved = resolvePresentationProfile(
      "BusinessActor",
      { actorKind: "person" },
      profiles,
    );
    expect(resolved?.profileCode).toBe("actor-person");
    expect(resolved?.labelCs).toBe("Osoba");
  });
});
