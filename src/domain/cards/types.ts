export const UI_CARDS_PKG = "archimate-ui-cards";

export type SlotImportance = "recommended" | "optional";
export type SlotDirection = "outgoing" | "incoming";

export interface RelationSlotDef {
  id: string;
  iriLocal?: string;
  slotCode: string;
  labelCs: string;
  relationshipType: string;
  direction: SlotDirection;
  targetClasses: string[];
  targetProfileCodes: string[];
  importance: SlotImportance;
  sortOrder: number;
}

export interface PresentationProfileDef {
  id: string;
  iriLocal?: string;
  packageCode?: string;
  profileCode: string;
  profileVersion?: string;
  minCatalogVersion?: string;
  isSystemDefault?: boolean;
  archimateElementType: string;
  matchProperties: Record<string, string>;
  fieldProperties: string[];
  labelCs: string;
  labelEn?: string;
  descriptionCs?: string;
  sortOrder: number;
  slots: RelationSlotDef[];
}

export interface CardNeighbor {
  entityId: string;
  entityLabel: string;
  classLocal: string;
  profileCode?: string;
  profileLabelCs?: string;
  relationshipId: string;
  relationshipType: string;
}

export interface CardSlotView {
  slot: RelationSlotDef;
  neighbors: CardNeighbor[];
  empty: boolean;
}

export interface CardFieldView {
  propertyLocal: string;
  label: string;
  value: string;
}

export interface CardViewModel {
  entityId: string;
  entityLabel: string;
  classLocal: string;
  description?: string;
  profile: PresentationProfileDef | null;
  /** True when no presentation profile matched */
  raw: boolean;
  fields: CardFieldView[];
  slots: CardSlotView[];
  /** Unmatched AML edges (for expert mode) */
  expertNeighbors: CardNeighbor[];
}
