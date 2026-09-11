import {
  CardsProfileLoader as CoreLoader,
  CardsService as CoreService,
  bindCardsProfileLoader,
  getCardsProfileLoader,
  resetCardsProfileLoader,
  resolvePresentationProfile,
  classLocalFromEffective,
  classLocalFromStatements,
  classNeedsMatchProps,
  interestingKeysForClass,
  matchKeysForClass,
  propMapFromStatements,
  resolveClassLocalFromEmbeds,
  statementToString,
  UI_CARDS_PKG,
  type CardsHubPage,
  type CardsHubRow,
  type CardFieldView,
  type CardNeighbor,
  type CardSlotView,
  type CardSystemInfo,
  type CardViewModel,
  type PresentationProfileDef,
  type RelationSlotDef,
  type SlotDirection,
  type SlotImportance,
} from "@itmap/archimate-core";
import { getKc } from "@/kc/client";
import { getSchema } from "@/kc/schema";

export { UI_CARDS_PKG };
export type {
  CardFieldView,
  CardNeighbor,
  CardSlotView,
  CardSystemInfo,
  CardViewModel,
  PresentationProfileDef,
  RelationSlotDef,
  SlotDirection,
  SlotImportance,
  CardsHubPage,
  CardsHubRow,
};
export {
  resolvePresentationProfile,
  classLocalFromEffective,
  classLocalFromStatements,
  classNeedsMatchProps,
  interestingKeysForClass,
  matchKeysForClass,
  propMapFromStatements,
  resolveClassLocalFromEmbeds,
  statementToString,
  getCardsProfileLoader,
  resetCardsProfileLoader,
  bindCardsProfileLoader,
};

export {
  formatProfileDefinition,
  draftFromProfile,
  emptyProfileDraft,
  emptySlotDraft,
  getCardProfileService,
  CardProfileService,
} from "./cardProfileService";
export type { ProfileDraft, ProfileSlotDraft } from "./cardProfileService";

export class CardsProfileLoader extends CoreLoader {
  constructor(kc = getKc(), schema = getSchema()) {
    super(kc, schema);
  }
}

export class CardsService extends CoreService {
  constructor(kc = getKc(), schema = getSchema(), loader = getCardsProfileLoader()) {
    super(kc, schema, loader);
  }
}

// Bind SPA singleton factory once on module load.
bindCardsProfileLoader(() => new CardsProfileLoader());
