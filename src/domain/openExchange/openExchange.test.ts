import { describe, expect, it } from "vitest";
import { parseOpenExchangeXml, collectXmlIdentifiers } from "./parseXml";
import { serializeOpenExchangeXml } from "./serializeXml";
import { findOrphans } from "./reconcile";
import type { Entity } from "@/kc/types";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-model1">
  <name xml:lang="en">Sample</name>
  <elements>
    <element identifier="id-proc1" xsi:type="BusinessProcess">
      <name xml:lang="en">Proc</name>
      <properties>
        <property key="customKey">customVal</property>
      </properties>
    </element>
    <element identifier="id-junc1" xsi:type="AndJunction">
      <name xml:lang="en">Junction</name>
    </element>
  </elements>
  <relationships>
    <relationship identifier="id-rel1" xsi:type="Serving" source="id-proc1" target="id-junc1"/>
  </relationships>
  <organizations>
    <item>
      <label xml:lang="en">Business</label>
      <item identifierRef="id-proc1"/>
    </item>
  </organizations>
  <views>
    <diagrams>
      <view identifier="id-view1" xsi:type="Diagram">
        <name xml:lang="en">V1</name>
        <node identifier="id-node1" xsi:type="Element" elementRef="id-proc1" x="10" y="20" w="100" h="50">
          <style><fillColor>#fff</fillColor></style>
        </node>
        <connection identifier="id-conn1" xsi:type="Relationship" relationshipRef="id-rel1" source="id-node1" target="id-node1">
          <bendpoint x="1" y="2"/>
        </connection>
      </view>
    </diagrams>
  </views>
</model>`;

describe("openExchange parse/serialize", () => {
  it("parses elements, foreign type, views and properties", () => {
    const model = parseOpenExchangeXml(SAMPLE);
    expect(model.identifier).toBe("id-model1");
    expect(model.elements).toHaveLength(2);
    expect(model.elements[0].xsiType).toBe("BusinessProcess");
    expect(model.elements[0].properties).toEqual([{ key: "customKey", value: "customVal" }]);
    expect(model.elements[1].xsiType).toBe("AndJunction");
    expect(model.relationships).toHaveLength(1);
    expect(model.views).toHaveLength(1);
    expect(model.views[0].nodes[0].x).toBe(10);
    expect(model.views[0].connections[0].bendpoints).toEqual([{ x: 1, y: 2 }]);
  });

  it("round-trips identifiers and xsi types through serialize", () => {
    const model = parseOpenExchangeXml(SAMPLE);
    const xml = serializeOpenExchangeXml(model);
    const again = parseOpenExchangeXml(xml);
    expect(again.elements.map((e) => e.identifier).sort()).toEqual(
      model.elements.map((e) => e.identifier).sort(),
    );
    expect(again.elements.find((e) => e.identifier === "id-junc1")?.xsiType).toBe("AndJunction");
    expect(again.elements.find((e) => e.identifier === "id-proc1")?.properties).toEqual([
      { key: "customKey", value: "customVal" },
    ]);
    expect(collectXmlIdentifiers(again).has("id-rel1")).toBe(true);
  });
});

describe("orphan reconcile", () => {
  it("lists exchange-managed entities missing from XML", () => {
    const entities: Entity[] = [
      {
        id: "https://ex/a",
        status: "active",
        kind: "entity",
        revisionNo: 1,
        labels: { en: "Gone" },
        iriLocal: "id-gone",
        iriAliases: [{ iri: "https://archimate.openexchange/id/id-gone", kind: "imported" }],
      },
      {
        id: "https://ex/b",
        status: "active",
        kind: "entity",
        revisionNo: 1,
        labels: { en: "Native" },
        iriLocal: "native-slug",
      },
      {
        id: "https://ex/c",
        status: "active",
        kind: "entity",
        revisionNo: 1,
        labels: { en: "Present" },
        iriLocal: "id-proc1",
        iriAliases: [{ iri: "https://archimate.openexchange/id/id-proc1", kind: "imported" }],
      },
    ];
    const orphans = findOrphans({
      packageEntities: entities,
      xmlIdentifiers: new Set(["id-proc1"]),
      classLocalOf: () => "BusinessProcess",
      exchangeManagedIds: new Set(["https://ex/a", "https://ex/c"]),
    });
    expect(orphans).toHaveLength(1);
    expect(orphans[0].iriLocal).toBe("id-gone");
  });
});
