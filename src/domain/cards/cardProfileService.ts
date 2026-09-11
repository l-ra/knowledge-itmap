import { getKc, type KcClient } from "@/kc/client";
import { getSchema, type SchemaResolver } from "@/kc/schema";
import type { ChangeSet } from "@/kc/types";
import {
  getCardsProfileLoader,
  UI_CARDS_PKG,
  type CardsProfileLoader,
  type PresentationProfileDef,
  type RelationSlotDef,
  type SlotDirection,
  type SlotImportance,
} from "@/domain/cards";

export type ProfileSlotDraft = {
  id?: string;
  slotCode: string;
  labelCs: string;
  relationshipType: string;
  direction: SlotDirection;
  targetClasses: string;
  targetProfileCodes: string;
  importance: SlotImportance;
  sortOrder: number;
};

export type ProfileDraft = {
  id?: string;
  profileCode: string;
  labelCs: string;
  labelEn: string;
  descriptionCs: string;
  archimateElementType: string;
  matchPropertiesJson: string;
  fieldProperties: string;
  sortOrder: number;
  slots: ProfileSlotDraft[];
};

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function parseMatchJson(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("matchProperties musí být JSON objekt { klíč: hodnota }");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") {
      throw new Error(`matchProperties.${k} musí být string`);
    }
    out[k] = v;
  }
  return out;
}

/** Human-readable Czech summary of a presentation profile. */
export function formatProfileDefinition(p: PresentationProfileDef): string {
  const lines: string[] = [];
  lines.push(`ArchiMate typ: ${p.archimateElementType}`);
  const matchEntries = Object.entries(p.matchProperties);
  if (matchEntries.length) {
    lines.push(
      `Platí když: ${matchEntries.map(([k, v]) => `${k} = ${v}`).join(", ")}`,
    );
  } else {
    lines.push("Platí pro všechny instance daného typu (bez match podmínek).");
  }
  if (p.fieldProperties.length) {
    lines.push(`Pole na kartě: ${p.fieldProperties.join(", ")}`);
  } else {
    lines.push("Pole na kartě: —");
  }
  if (p.slots.length === 0) {
    lines.push("Sloty vazeb: žádné");
  } else {
    lines.push("Sloty vazeb:");
    for (const s of p.slots) {
      const arrow = s.direction === "outgoing" ? "→" : "←";
      const targets =
        s.targetClasses.length > 0
          ? s.targetClasses.join(", ")
          : s.targetProfileCodes.length > 0
            ? `profily: ${s.targetProfileCodes.join(", ")}`
            : "libovolný cíl";
      lines.push(
        `  • ${s.labelCs || s.slotCode}: ${s.relationshipType} ${arrow} ${targets} (${s.importance})`,
      );
    }
  }
  return lines.join("\n");
}

export function draftFromProfile(p: PresentationProfileDef): ProfileDraft {
  return {
    id: p.id,
    profileCode: p.profileCode,
    labelCs: p.labelCs,
    labelEn: p.labelEn || "",
    descriptionCs: p.descriptionCs || "",
    archimateElementType: p.archimateElementType,
    matchPropertiesJson: JSON.stringify(p.matchProperties || {}, null, 2),
    fieldProperties: p.fieldProperties.join(", "),
    sortOrder: p.sortOrder,
    slots: p.slots.map(slotToDraft),
  };
}

export function emptyProfileDraft(): ProfileDraft {
  return {
    profileCode: "",
    labelCs: "",
    labelEn: "",
    descriptionCs: "",
    archimateElementType: "BusinessActor",
    matchPropertiesJson: "{\n  \n}",
    fieldProperties: "",
    sortOrder: 100,
    slots: [],
  };
}

export function emptySlotDraft(): ProfileSlotDraft {
  return {
    slotCode: "",
    labelCs: "",
    relationshipType: "Association",
    direction: "outgoing",
    targetClasses: "",
    targetProfileCodes: "",
    importance: "recommended",
    sortOrder: 1,
  };
}

function slotToDraft(s: RelationSlotDef): ProfileSlotDraft {
  return {
    id: s.id,
    slotCode: s.slotCode,
    labelCs: s.labelCs,
    relationshipType: s.relationshipType,
    direction: s.direction,
    targetClasses: s.targetClasses.join(", "),
    targetProfileCodes: s.targetProfileCodes.join(", "),
    importance: s.importance,
    sortOrder: s.sortOrder,
  };
}

function isSystemPackage(packageCode?: string): boolean {
  return !packageCode || packageCode === UI_CARDS_PKG;
}

export class CardProfileService {
  constructor(
    private kc: KcClient = getKc(),
    private schema: SchemaResolver = getSchema(),
    private loader: CardsProfileLoader = getCardsProfileLoader(),
  ) {}

  async listResolvedProfiles(orgPackage: string): Promise<PresentationProfileDef[]> {
    return this.loader.loadAllProfiles(true, orgPackage);
  }

  async listSystemProfiles(): Promise<PresentationProfileDef[]> {
    return this.loader.loadProfilesInPackage(UI_CARDS_PKG);
  }

  async listOrgProfiles(orgPackage: string): Promise<PresentationProfileDef[]> {
    if (!orgPackage || orgPackage === UI_CARDS_PKG) return [];
    return this.loader.loadProfilesInPackage(orgPackage);
  }

  isEditableInPackage(profile: PresentationProfileDef, orgPackage: string): boolean {
    return !!profile.packageCode && profile.packageCode === orgPackage && !isSystemPackage(profile.packageCode);
  }

  async upsertProfile(
    orgPackage: string,
    draft: ProfileDraft,
  ): Promise<{ profileId: string; changeSet: ChangeSet }> {
    if (!this.kc.getManualChangeSetId()) {
      throw new Error("Otevřete manuální ChangeSet pro úpravu profilů karet.");
    }
    parseMatchJson(draft.matchPropertiesJson);
    if (!draft.profileCode.trim()) throw new Error("profileCode je povinný");
    if (!draft.labelCs.trim()) throw new Error("Český label je povinný");
    if (!draft.archimateElementType.trim()) throw new Error("ArchiMate typ je povinný");

    const previousSlotIds = draft.id
      ? (await this.loader.loadProfile(draft.id)).slots.map((s) => s.id)
      : [];

    const { result, changeSet } = await this.kc.runLogicalChangeSet(
      { operationType: "upsertPresentationProfile", comment: draft.profileCode },
      async () => {
        let profileId = draft.id;
        if (!profileId) {
          profileId = await this.createCardsEntity(orgPackage, "PresentationProfile", {
            iriLocal: `card-profile-${slugify(draft.profileCode)}-${Date.now().toString(36)}`,
            labels: { cs: draft.labelCs, en: draft.labelEn || draft.labelCs },
            descriptions: draft.descriptionCs
              ? { cs: draft.descriptionCs, en: draft.descriptionCs }
              : undefined,
          });
        } else {
          const existing = await this.kc.getEntity(profileId);
          if (existing.packageCode !== orgPackage) {
            throw new Error("Systémový profil nelze přepsat — nejdřív ho zkopírujte do org.");
          }
          await this.kc.patchEntity(profileId, {
            labels: { cs: draft.labelCs, en: draft.labelEn || draft.labelCs },
            descriptions: draft.descriptionCs
              ? { cs: draft.descriptionCs, en: draft.descriptionCs }
              : undefined,
          });
        }

        await this.setString(orgPackage, profileId, "profileCode", draft.profileCode.trim());
        await this.setString(orgPackage, profileId, "profileVersion", "1.0.0");
        await this.setString(
          orgPackage,
          profileId,
          "archimateElementType",
          draft.archimateElementType.trim(),
        );
        await this.setString(orgPackage, profileId, "labelCs", draft.labelCs.trim());
        if (draft.labelEn.trim()) {
          await this.setString(orgPackage, profileId, "labelEn", draft.labelEn.trim());
        }
        await this.setString(
          orgPackage,
          profileId,
          "matchProperties",
          JSON.stringify(parseMatchJson(draft.matchPropertiesJson)),
        );
        await this.setString(
          orgPackage,
          profileId,
          "fieldProperties",
          draft.fieldProperties
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .join(","),
        );
        await this.setInteger(orgPackage, profileId, "sortOrder", draft.sortOrder);
        await this.setBoolean(orgPackage, profileId, "isSystemDefault", false);

        const keptSlotIds = new Set<string>();
        for (const slot of draft.slots) {
          const slotId = await this.upsertSlot(orgPackage, profileId, slot);
          keptSlotIds.add(slotId);
        }

        for (const existingId of previousSlotIds) {
          if (!keptSlotIds.has(existingId)) {
            await this.deprecateEntityStatements(existingId);
          }
        }

        return { profileId };
      },
    );

    this.loader.clearCache();
    return { profileId: result.profileId, changeSet };
  }

  /** Copy a system (or other) profile into the org package for editing. */
  async forkProfileToOrg(
    sourceProfileId: string,
    orgPackage: string,
  ): Promise<{ profileId: string; changeSet: ChangeSet }> {
    if (!this.kc.getManualChangeSetId()) {
      throw new Error("Otevřete manuální ChangeSet pro úpravu profilů karet.");
    }
    const source = await this.loader.loadProfile(sourceProfileId);
    const draft = draftFromProfile(source);
    draft.id = undefined;
    for (const s of draft.slots) s.id = undefined;

    // Prefer unique code when forking same package collision — keep code so it overrides.
    return this.upsertProfile(orgPackage, draft);
  }

  private async upsertSlot(
    packageCode: string,
    profileId: string,
    slot: ProfileSlotDraft,
  ): Promise<string> {
    if (!slot.slotCode.trim()) throw new Error("slotCode je povinný");
    if (!slot.labelCs.trim()) throw new Error("Label slotu je povinný");
    if (!slot.relationshipType.trim()) throw new Error("Typ vztahu slotu je povinný");

    let slotId = slot.id;
    if (!slotId) {
      slotId = await this.createCardsEntity(packageCode, "RelationSlot", {
        iriLocal: `card-slot-${slugify(slot.slotCode)}-${Date.now().toString(36)}`,
        labels: { cs: slot.labelCs, en: slot.labelCs },
      });
    }

    await this.setEntityRef(packageCode, slotId, "parentProfile", profileId);
    await this.setString(packageCode, slotId, "slotCode", slot.slotCode.trim());
    await this.setString(packageCode, slotId, "slotLabelCs", slot.labelCs.trim());
    await this.setString(packageCode, slotId, "relationshipType", slot.relationshipType.trim());
    await this.setString(packageCode, slotId, "traverseDirection", slot.direction);
    await this.setString(packageCode, slotId, "importance", slot.importance);
    await this.setString(
      packageCode,
      slotId,
      "targetClasses",
      slot.targetClasses
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(","),
    );
    await this.setString(
      packageCode,
      slotId,
      "targetProfileCodes",
      slot.targetProfileCodes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(","),
    );
    await this.setInteger(packageCode, slotId, "sortOrder", slot.sortOrder);
    return slotId;
  }

  private async createCardsEntity(
    packageCode: string,
    classLocal: "PresentationProfile" | "RelationSlot",
    opts: {
      iriLocal: string;
      labels: Record<string, string>;
      descriptions?: Record<string, string>;
    },
  ): Promise<string> {
    const classId =
      classLocal === "PresentationProfile"
        ? await this.loader.presentationProfileClassId()
        : await this.loader.relationSlotClassId();
    const created = await this.kc.createEntity({
      packageCode,
      labels: opts.labels,
      descriptions: opts.descriptions,
      iriLocal: opts.iriLocal,
    });
    await this.kc.createStatement({
      packageCode,
      subject: created.data.id,
      property: this.schema.snapshot.instanceOfProperty,
      value: { type: "EntityReference", entityId: classId },
      upsert: true,
    });
    return created.data.id;
  }

  private async setString(
    packageCode: string,
    subject: string,
    propLocal: string,
    value: string,
  ): Promise<void> {
    const propIri = await this.loader.cardsPropertyIri(propLocal);
    const existing = await this.kc.getStatements(subject, propIri);
    for (const stmt of existing.items) {
      await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
    }
    if (value === "") return;
    await this.kc.createStatement({
      packageCode,
      subject,
      property: propIri,
      value: { type: "String", string: value },
    });
  }

  private async setInteger(
    packageCode: string,
    subject: string,
    propLocal: string,
    value: number,
  ): Promise<void> {
    const propIri = await this.loader.cardsPropertyIri(propLocal);
    const existing = await this.kc.getStatements(subject, propIri);
    for (const stmt of existing.items) {
      await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
    }
    await this.kc.createStatement({
      packageCode,
      subject,
      property: propIri,
      value: { type: "Integer", int64: value },
    });
  }

  private async setBoolean(
    packageCode: string,
    subject: string,
    propLocal: string,
    value: boolean,
  ): Promise<void> {
    const propIri = await this.loader.cardsPropertyIri(propLocal);
    const existing = await this.kc.getStatements(subject, propIri);
    for (const stmt of existing.items) {
      await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
    }
    await this.kc.createStatement({
      packageCode,
      subject,
      property: propIri,
      value: { type: "Boolean", bool: value },
    });
  }

  private async setEntityRef(
    packageCode: string,
    subject: string,
    propLocal: string,
    entityId: string,
  ): Promise<void> {
    const propIri = await this.loader.cardsPropertyIri(propLocal);
    const existing = await this.kc.getStatements(subject, propIri);
    for (const stmt of existing.items) {
      await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
    }
    await this.kc.createStatement({
      packageCode,
      subject,
      property: propIri,
      value: { type: "EntityReference", entityId },
    });
  }

  private async deprecateEntityStatements(entityId: string): Promise<void> {
    const stmts = await this.kc.getStatements(entityId);
    for (const stmt of stmts.items) {
      await this.kc.deprecateStatement(stmt.id, { expectedRevision: stmt.revisionNo });
    }
  }
}

let serviceSingleton: CardProfileService | null = null;

export function getCardProfileService(): CardProfileService {
  if (!serviceSingleton) serviceSingleton = new CardProfileService();
  return serviceSingleton;
}
