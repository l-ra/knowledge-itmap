import { getKc, type KcClient } from "./client";
import type { Entity, PropertyEntity, SchemaConfig } from "./types";
import {
  ARCHIMATE_LITE_PKG,
  UI_TRAVERSAL_PKG,
  indexWithUiTraversalAliases,
  rewriteUiTraversalIri,
} from "./uiTraversalIriMigration";

const AML = ARCHIMATE_LITE_PKG;
const UI_TRAV = UI_TRAVERSAL_PKG;
const UI_CARDS = "archimate-ui-cards";
const KC_BASE = "kc-base";

export interface SchemaSnapshot {
  instanceOfProperty: string;
  classesByLocal: Map<string, Entity>;
  propertiesByLocal: Map<string, PropertyEntity>;
  classIriToLocal: Map<string, string>;
  propertyIriToLocal: Map<string, string>;
  relSource: string;
  relTarget: string;
  allowed: AllowedRel[];
  enums: Map<string, string[]>;
  loadedAt: number;
}

export interface AllowedRel {
  typeLocal: string;
  typeIri: string;
  sourceLocal: string;
  sourceIri: string;
  targetLocal: string;
  targetIri: string;
}

function label(e: Entity, _lang = "en"): string {
  return e.labels?.cs || e.labels?.en || e.iriLocal || e.id;
}

/** Display name for a package: root-entity labels, else package code. */
function packageLabel(
  pkg: { code: string; labels?: Record<string, string> } | null | undefined,
  fallbackCode?: string,
): string {
  const code = pkg?.code || fallbackCode || "";
  if (!pkg?.labels) return code;
  return pkg.labels.cs || pkg.labels.en || Object.values(pkg.labels).find((v) => v?.trim()) || code;
}

export class SchemaResolver {
  private snap: SchemaSnapshot | null = null;

  constructor(private kc: KcClient = getKc()) {}

  get snapshot(): SchemaSnapshot {
    if (!this.snap) throw new Error("Schema not loaded — call load() first");
    return this.snap;
  }

  isLoaded(): boolean {
    return this.snap !== null;
  }

  async load(force = false): Promise<SchemaSnapshot> {
    if (this.snap && !force) return this.snap;

    const config = await this.kc.getSchemaConfig();
    if (!config.instanceOfProperty) {
      throw new Error(
        "schema-config.instanceOfProperty is empty — import kc-base and set instanceOf",
      );
    }

    const [amlClasses, amlProperties, uiClasses, uiProperties, cardClasses, cardProperties] =
      await Promise.all([
        this.loadAllKind(AML, "class"),
        this.loadAllKind(AML, "property") as Promise<PropertyEntity[]>,
        this.loadAllKind(UI_TRAV, "class").catch((e) => {
          console.warn("archimate-ui-traversal classes load skipped:", e);
          return [] as Entity[];
        }),
        this.loadAllKind(UI_TRAV, "property").catch((e) => {
          console.warn("archimate-ui-traversal properties load skipped:", e);
          return [] as PropertyEntity[];
        }) as Promise<PropertyEntity[]>,
        this.loadAllKind(UI_CARDS, "class").catch((e) => {
          console.warn("archimate-ui-cards classes load skipped:", e);
          return [] as Entity[];
        }),
        this.loadAllKind(UI_CARDS, "property").catch((e) => {
          console.warn("archimate-ui-cards properties load skipped:", e);
          return [] as PropertyEntity[];
        }) as Promise<PropertyEntity[]>,
      ]);

    let allowedRows: AllowedRel[] = [];
    try {
      allowedRows = await this.loadAllowed(config);
    } catch (e) {
      console.warn("AllowedRelationship load skipped:", e);
    }

    // Also load kc-base properties for instanceOf / usage
    const baseProps = (await this.loadAllKind(KC_BASE, "property")) as PropertyEntity[];

    const classesByLocal = new Map<string, Entity>();
    const classIriToLocal = new Map<string, string>();
    for (const c of [...amlClasses, ...uiClasses, ...cardClasses]) {
      if (c.iriLocal) {
        classesByLocal.set(c.iriLocal, c);
        indexWithUiTraversalAliases(classIriToLocal, c.iriLocal, c.id);
        if (c.iri) indexWithUiTraversalAliases(classIriToLocal, c.iriLocal, c.iri);
        classIriToLocal.set(c.id, c.iriLocal);
        if (c.iri) classIriToLocal.set(c.iri, c.iriLocal);
      }
    }

    const propertiesByLocal = new Map<string, PropertyEntity>();
    const propertyIriToLocal = new Map<string, string>();
    for (const p of [...amlProperties, ...uiProperties, ...baseProps]) {
      if (p.iriLocal) {
        propertiesByLocal.set(p.iriLocal, p);
        indexWithUiTraversalAliases(propertyIriToLocal, p.iriLocal, p.id);
        if (p.iri) indexWithUiTraversalAliases(propertyIriToLocal, p.iriLocal, p.iri);
      }
    }
    // Cards properties: index IRI→local for statement reading; do not overwrite
    // shared locals (profileCode, sortOrder, …) used by ui-traversal.
    for (const p of cardProperties) {
      if (!p.iriLocal) continue;
      if (!propertiesByLocal.has(p.iriLocal)) {
        propertiesByLocal.set(p.iriLocal, p);
      }
      propertyIriToLocal.set(p.id, p.iriLocal);
      if (p.iri) propertyIriToLocal.set(p.iri, p.iriLocal);
    }

    const relSource = propertiesByLocal.get("relSource")?.id;
    const relTarget = propertiesByLocal.get("relTarget")?.id;
    if (!relSource || !relTarget) {
      throw new Error("archimate-lite missing relSource/relTarget properties");
    }

    const enums = await this.loadEnums(propertiesByLocal);

    this.snap = {
      instanceOfProperty: config.instanceOfProperty,
      classesByLocal,
      propertiesByLocal,
      classIriToLocal,
      propertyIriToLocal,
      relSource,
      relTarget,
      allowed: allowedRows,
      enums,
      loadedAt: Date.now(),
    };
    return this.snap;
  }

  classIri(local: string): string {
    const c = this.snapshot.classesByLocal.get(local);
    if (!c) throw new Error(`Unknown class iriLocal: ${local}`);
    return c.id;
  }

  propertyIri(local: string): string {
    const p = this.snapshot.propertiesByLocal.get(local);
    if (!p) throw new Error(`Unknown property iriLocal: ${local}`);
    return p.id;
  }

  tryPropertyIri(local: string): string | undefined {
    return this.snapshot.propertiesByLocal.get(local)?.id;
  }

  classLocal(iri: string): string | undefined {
    const snap = this.snapshot;
    return snap.classIriToLocal.get(iri) || snap.classIriToLocal.get(rewriteUiTraversalIri(iri));
  }

  propertyLocal(iri: string): string | undefined {
    const snap = this.snapshot;
    return (
      snap.propertyIriToLocal.get(iri) || snap.propertyIriToLocal.get(rewriteUiTraversalIri(iri))
    );
  }

  classLabel(local: string): string {
    const c = this.snapshot.classesByLocal.get(local);
    return c ? label(c) : local;
  }

  isAllowed(typeLocal: string, sourceLocal: string, targetLocal: string): boolean {
    return this.snapshot.allowed.some(
      (a) =>
        a.typeLocal === typeLocal &&
        a.sourceLocal === sourceLocal &&
        a.targetLocal === targetLocal,
    );
  }

  enumValues(propertyLocal: string): string[] {
    return this.snapshot.enums.get(propertyLocal) || [];
  }

  private async loadAllKind(pkg: string, kind: string): Promise<Entity[]> {
    const items: Entity[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kc.listEntities({
        package: pkg,
        kind,
        limit: 200,
        cursor,
      });
      items.push(...page.items);
      cursor = page.nextCursor || undefined;
    } while (cursor);
    return items;
  }

  private async loadAllowed(config: SchemaConfig): Promise<AllowedRel[]> {
    const allowedClass = await this.resolveByLocal(AML, "AllowedRelationship");
    if (!allowedClass) return [];

    const rows = await this.kc.listEntities({
      package: AML,
      instanceOf: allowedClass.id,
      includeSubclasses: true,
      limit: 200,
    });

    const typeProp = await this.resolveProp(AML, "allowedRelType");
    const srcProp = await this.resolveProp(AML, "allowedSourceClass");
    const tgtProp = await this.resolveProp(AML, "allowedTargetClass");
    if (!typeProp || !srcProp || !tgtProp) return [];

    const out: AllowedRel[] = [];
    for (const row of rows.items) {
      const stmts = await this.kc.getStatements(row.id);
      const byProp = new Map(stmts.items.map((s) => [s.property, s]));
      const typeS = byProp.get(typeProp.id);
      const srcS = byProp.get(srcProp.id);
      const tgtS = byProp.get(tgtProp.id);
      if (
        typeS?.value.type === "EntityReference" &&
        srcS?.value.type === "EntityReference" &&
        tgtS?.value.type === "EntityReference"
      ) {
        const typeEnt = await this.kc.getEntity(typeS.value.entityId);
        const srcEnt = await this.kc.getEntity(srcS.value.entityId);
        const tgtEnt = await this.kc.getEntity(tgtS.value.entityId);
        out.push({
          typeLocal: typeEnt.iriLocal || typeEnt.id,
          typeIri: typeEnt.id,
          sourceLocal: srcEnt.iriLocal || srcEnt.id,
          sourceIri: srcEnt.id,
          targetLocal: tgtEnt.iriLocal || tgtEnt.id,
          targetIri: tgtEnt.id,
        });
      }
    }
    void config;
    return out;
  }

  private async loadEnums(
    propertiesByLocal: Map<string, PropertyEntity>,
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    const enumLocals = [
      "actorKind",
      "organizationScope",
      "ownership",
      "associationKind",
      "networkKind",
      "networkRole",
      "flowKind",
      "accessMode",
      "dependencyStrength",
      "modelingDepth",
    ];

    for (const local of enumLocals) {
      const prop = propertiesByLocal.get(local);
      if (!prop) continue;
      // Try enum/{iriLocal} entity pattern
      const enumEnt = await this.resolveByLocal(AML, `enum/${local}`);
      if (!enumEnt) continue;
      const stmts = await this.kc.getStatements(enumEnt.id);
      const allowedProp = await this.resolveProp(KC_BASE, "allowedValue");
      if (!allowedProp) continue;
      const values = stmts.items
        .filter((s) => s.property === allowedProp.id && s.value.type === "String")
        .map((s) => (s.value.type === "String" ? s.value.string : ""))
        .filter(Boolean);
      if (values.length) result.set(local, values);
    }
    return result;
  }

  private async resolveByLocal(pkg: string, iriLocal: string): Promise<Entity | null> {
    const res = await this.kc.listEntities({ package: pkg, iriLocal, limit: 1 });
    return res.items[0] || null;
  }

  private async resolveProp(pkg: string, iriLocal: string): Promise<PropertyEntity | null> {
    const res = await this.kc.listEntities({ package: pkg, kind: "property", iriLocal, limit: 1 });
    return (res.items[0] as PropertyEntity) || null;
  }
}

let schemaSingleton: SchemaResolver | null = null;

export function getSchema(): SchemaResolver {
  if (!schemaSingleton) schemaSingleton = new SchemaResolver();
  return schemaSingleton;
}

export { label as entityLabel, packageLabel };
