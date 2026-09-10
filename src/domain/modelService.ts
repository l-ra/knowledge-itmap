import {
  ModelService as CoreModelService,
  type CreateElementInput,
  type LinkElementInput,
  type CreateResult,
  type ModelAddAction,
  valueToDisplay,
} from "@itmap/archimate-core";
import { getKc } from "@/kc/client";
import { getSchema } from "@/kc/schema";

export type { CreateElementInput, LinkElementInput, CreateResult, ModelAddAction };
export { valueToDisplay };

/** Browser ModelService with getKc/getSchema defaults. */
export class ModelService extends CoreModelService {
  constructor(kc = getKc(), schema = getSchema()) {
    super(kc, schema);
  }
}
