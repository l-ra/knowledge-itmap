import { getKc, type KcClient } from "../../kc/client";
import { entityLabel, getSchema, type SchemaResolver } from "../../kc/schema";
import type { Entity } from "../../kc/types";
import { resolvePresentationProfile } from "./profileResolver";
import { getCardsProfileLoader, type CardsProfileLoader } from "./profileLoader";
import type {
  CardFieldView,
  CardNeighbor,
  CardSlotView,
  CardViewModel,
  PresentationProfileDef,
  RelationSlotDef,
} from "./types";

/**
 * Builds card view-models and queries neighbors for relation slots.
 * Does not import TraversalEngine / navigation profiles.
 */
export class CardsService {
  constructor(
    private kc: KcClient = getKc(),
    private schema: SchemaResolver = getSchema(),
    private loader: CardsProfileLoader = getCardsProfileLoader(),
  ) {}

  async listBrowsableEntities(packageCode: string, query?: string): Promise<
    Array<{
      entity: Entity;
      classLocal: string;
      profile: PresentationProfileDef | null;
    }>
  > {
    const profiles = await this.loader.loadAllProfiles();
    const page = await this.kc.listEntities({
      package: packageCode,
      q: query?.trim() || undefined,
      limit: 200,
    });

    const out: Array<{
      entity: Entity;
      classLocal: string;
      profile: PresentationProfileDef | null;
    }> = [];

    for (const entity of page.items) {
      const classLocal = await this.resolveClassLocal(entity);
      if (!classLocal) continue;
      // Skip metamodel / UI meta entities that might appear if package is wrong
      if (classLocal.startsWith("Ui") || classLocal === "AllowedRelationship") continue;
      if (!this.schema.snapshot.classesByLocal.has(classLocal)) continue;

      const props = await this.readInterestingProps(entity.id, profiles, classLocal);
      const profile = resolvePresentationProfile(classLocal, props, profiles);
      out.push({ entity, classLocal, profile });
    }

    out.sort((a, b) => entityLabel(a.entity).localeCompare(entityLabel(b.entity), "cs"));
    return out;
  }

  async loadCard(entityId: string, options?: { expert?: boolean }): Promise<CardViewModel> {
    const expert = options?.expert ?? false;
    const entity = await this.kc.getEntity(entityId);
    const classLocal = (await this.resolveClassLocal(entity)) || "?";
    const profiles = await this.loader.loadAllProfiles();
    const props = await this.readInterestingProps(entityId, profiles, classLocal);
    const profile = resolvePresentationProfile(classLocal, props, profiles);

    const fields: CardFieldView[] = [];
    if (profile) {
      for (const propLocal of profile.fieldProperties) {
        const value = props[propLocal] ?? (await this.readStringProp(entityId, propLocal)) ?? "";
        fields.push({
          propertyLocal: propLocal,
          label: this.schema.snapshot.propertiesByLocal.get(propLocal)
            ? entityLabel(this.schema.snapshot.propertiesByLocal.get(propLocal)!)
            : propLocal,
          value,
        });
      }
    }

    const slots: CardSlotView[] = [];
    const claimedRelIds = new Set<string>();

    if (profile) {
      for (const slot of profile.slots) {
        const neighbors = await this.querySlotNeighbors(entityId, slot, profiles);
        for (const n of neighbors) claimedRelIds.add(n.relationshipId);
        const empty = neighbors.length === 0;
        if (!empty || slot.importance === "recommended" || expert) {
          slots.push({ slot, neighbors, empty });
        }
      }
    }

    let expertNeighbors: CardNeighbor[] = [];
    if (expert) {
      const all = await this.queryAllNeighbors(entityId, profiles);
      expertNeighbors = all.filter((n) => !claimedRelIds.has(n.relationshipId));
    }

    return {
      entityId: entity.id,
      entityLabel: entityLabel(entity),
      classLocal,
      description: entity.descriptions?.cs || entity.descriptions?.en,
      profile,
      raw: !profile,
      fields,
      slots,
      expertNeighbors,
    };
  }

  async querySlotNeighbors(
    entityId: string,
    slot: RelationSlotDef,
    profiles?: PresentationProfileDef[],
  ): Promise<CardNeighbor[]> {
    const allProfiles = profiles ?? (await this.loader.loadAllProfiles());
    const relClass = this.schema.snapshot.classesByLocal.get(slot.relationshipType);
    if (!relClass) return [];

    const pairs = await this.neighborsViaRel(entityId, relClass.id, slot.direction);
    const out: CardNeighbor[] = [];

    for (const { neighborId, relId } of pairs) {
      const entity = await this.kc.getEntity(neighborId);
      const classLocal = (await this.resolveClassLocal(entity)) || "?";
      if (slot.targetClasses.length && !slot.targetClasses.includes(classLocal)) continue;

      const props = await this.readInterestingProps(neighborId, allProfiles, classLocal);
      const neighborProfile = resolvePresentationProfile(classLocal, props, allProfiles);
      if (
        slot.targetProfileCodes.length &&
        (!neighborProfile || !slot.targetProfileCodes.includes(neighborProfile.profileCode))
      ) {
        continue;
      }

      out.push({
        entityId: entity.id,
        entityLabel: entityLabel(entity),
        classLocal,
        profileCode: neighborProfile?.profileCode,
        profileLabelCs: neighborProfile?.labelCs,
        relationshipId: relId,
        relationshipType: slot.relationshipType,
      });
    }

    out.sort((a, b) => a.entityLabel.localeCompare(b.entityLabel, "cs"));
    return out;
  }

  private async queryAllNeighbors(
    entityId: string,
    profiles: PresentationProfileDef[],
  ): Promise<CardNeighbor[]> {
    const snap = this.schema.snapshot;
    const [asSource, asTarget] = await Promise.all([
      this.kc.getIncoming(entityId, snap.relSource),
      this.kc.getIncoming(entityId, snap.relTarget),
    ]);

    const out: CardNeighbor[] = [];
    const seen = new Set<string>();

    for (const role of [
      ...asSource.items.map((s) => ({ stmt: s, as: "source" as const })),
      ...asTarget.items.map((s) => ({ stmt: s, as: "target" as const })),
    ]) {
      const relId = role.stmt.subject;
      if (seen.has(relId)) continue;
      seen.add(relId);

      const relEnt = await this.kc.getEntity(relId);
      const relClassLocal = await this.resolveClassLocal(relEnt);
      if (!relClassLocal) continue;

      const stmts = await this.kc.getStatements(relId);
      const src = stmts.items.find((s) => s.property === snap.relSource);
      const tgt = stmts.items.find((s) => s.property === snap.relTarget);
      if (src?.value.type !== "EntityReference" || tgt?.value.type !== "EntityReference") continue;

      const neighborId =
        role.as === "source" ? tgt.value.entityId : src.value.entityId;
      if (neighborId === entityId) continue;

      const entity = await this.kc.getEntity(neighborId);
      const classLocal = (await this.resolveClassLocal(entity)) || "?";
      const props = await this.readInterestingProps(neighborId, profiles, classLocal);
      const neighborProfile = resolvePresentationProfile(classLocal, props, profiles);

      out.push({
        entityId: entity.id,
        entityLabel: entityLabel(entity),
        classLocal,
        profileCode: neighborProfile?.profileCode,
        profileLabelCs: neighborProfile?.labelCs,
        relationshipId: relId,
        relationshipType: relClassLocal,
      });
    }

    out.sort((a, b) => a.entityLabel.localeCompare(b.entityLabel, "cs"));
    return out;
  }

  private async neighborsViaRel(
    entityId: string,
    relClassIri: string,
    direction: "outgoing" | "incoming",
  ): Promise<Array<{ neighborId: string; relId: string }>> {
    const snap = this.schema.snapshot;
    const [asSource, asTarget] = await Promise.all([
      this.kc.getIncoming(entityId, snap.relSource),
      this.kc.getIncoming(entityId, snap.relTarget),
    ]);

    const candidateRels = [
      ...asSource.items.map((s) => ({ stmt: s, role: "source" as const })),
      ...asTarget.items.map((s) => ({ stmt: s, role: "target" as const })),
    ];

    const out: Array<{ neighborId: string; relId: string }> = [];

    for (const { stmt, role } of candidateRels) {
      const relId = stmt.subject;
      const relEnt = await this.kc.getEntity(relId);
      const classLocal = await this.resolveClassLocal(relEnt);
      const classIri = classLocal ? snap.classesByLocal.get(classLocal)?.id : undefined;
      if (classIri !== relClassIri && !(await this.entityIsClass(relEnt, relClassIri))) {
        continue;
      }

      const stmts = await this.kc.getStatements(relId);
      const src = stmts.items.find((s) => s.property === snap.relSource);
      const tgt = stmts.items.find((s) => s.property === snap.relTarget);
      if (src?.value.type !== "EntityReference" || tgt?.value.type !== "EntityReference") {
        continue;
      }

      // outgoing: subject is source → neighbor is target
      // incoming: subject is target → neighbor is source
      if (direction === "outgoing" && role === "source") {
        out.push({ neighborId: tgt.value.entityId, relId });
      } else if (direction === "incoming" && role === "target") {
        out.push({ neighborId: src.value.entityId, relId });
      }
    }

    return out;
  }

  private async entityIsClass(ent: Entity, classIri: string): Promise<boolean> {
    const snap = this.schema.snapshot;
    if (ent.effectiveClasses?.includes(classIri)) return true;
    const stmts = await this.kc.getStatements(ent.id);
    return stmts.items.some(
      (s) =>
        s.property === snap.instanceOfProperty &&
        s.value.type === "EntityReference" &&
        s.value.entityId === classIri,
    );
  }

  private async readInterestingProps(
    entityId: string,
    profiles: PresentationProfileDef[],
    classLocal: string,
  ): Promise<Record<string, string | undefined>> {
    const keys = new Set<string>();
    for (const p of profiles) {
      if (p.archimateElementType !== classLocal) continue;
      for (const k of Object.keys(p.matchProperties)) keys.add(k);
      for (const k of p.fieldProperties) keys.add(k);
    }
    // Always useful for actors
    keys.add("actorKind");
    keys.add("organizationScope");

    const out: Record<string, string | undefined> = {};
    for (const k of keys) {
      out[k] = await this.readStringProp(entityId, k);
    }
    return out;
  }

  private async readStringProp(entityId: string, propertyLocal: string): Promise<string | undefined> {
    const propIri = this.schema.tryPropertyIri(propertyLocal);
    if (!propIri) return undefined;
    const page = await this.kc.getStatements(entityId, propIri);
    const v = page.items[0]?.value;
    if (!v) return undefined;
    if (v.type === "String") return v.string;
    if (v.type === "LocalizedString") return v.langMap.cs || v.langMap.en;
    return undefined;
  }

  private async resolveClassLocal(entity: Entity): Promise<string | undefined> {
    const snap = this.schema.snapshot;
    if (entity.effectiveClasses?.length) {
      for (const c of entity.effectiveClasses) {
        const local = snap.classIriToLocal.get(c);
        if (local) return local;
      }
    }
    const stmts = await this.kc.getStatements(entity.id);
    for (const s of stmts.items) {
      if (s.property !== snap.instanceOfProperty) continue;
      if (s.value.type !== "EntityReference") continue;
      const local = snap.classIriToLocal.get(s.value.entityId);
      if (local) return local;
    }
    return undefined;
  }
}
