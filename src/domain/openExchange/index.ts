import { getKc, type KcClient } from "@/kc/client";
import { getSchema, type SchemaResolver } from "@/kc/schema";
import { parseOpenExchangeXml } from "./parseXml";
import { serializeOpenExchangeXml } from "./serializeXml";
import {
  applyOrphanActions,
  exportExchangeModel,
  importExchangeModel,
  type ProgressFn,
} from "./sync";
import type { ExportResult, ImportResult, OrphanAction, OrphanCandidate } from "./types";

export type { ExportResult, ImportResult, OrphanAction, OrphanCandidate, ImportWarning } from "./types";
export { parseOpenExchangeXml } from "./parseXml";
export { serializeOpenExchangeXml } from "./serializeXml";
export { applyOrphanActions } from "./sync";

export async function importOpenExchange(opts: {
  xml: string;
  packageCode: string;
  kc?: KcClient;
  schema?: SchemaResolver;
  onProgress?: ProgressFn;
}): Promise<ImportResult> {
  const { formatAppError, logAppError } = await import("@/kc/errors");
  try {
    const kc = opts.kc || getKc();
    const schema = opts.schema || getSchema();
    if (!schema.isLoaded()) await schema.load();
    if (!schema.snapshot.classesByLocal.has("ExchangeForeignElement")) {
      throw new Error(
        "archimate-lite v tomto KC ještě nemá ExchangeForeignElement — importujte release archimate-lite 3.2.1+ (Packages → Import release bundle)",
      );
    }
    if (!schema.snapshot.propertiesByLocal.has("inView")) {
      throw new Error(
        "archimate-lite v tomto KC nemá property inView — importujte release archimate-lite 3.2.1+",
      );
    }
    opts.onProgress?.("Parsuji XML…", 0, 1);
    const model = parseOpenExchangeXml(opts.xml);
    opts.onProgress?.(
      `XML OK: ${model.elements.length} prvků, ${model.relationships.length} vztahů, ${model.views.length} views`,
      0,
      1,
    );
    return await importExchangeModel({
      kc,
      schema,
      packageCode: opts.packageCode,
      model,
      onProgress: opts.onProgress,
    });
  } catch (e) {
    logAppError(e, "importOpenExchange");
    throw new Error(formatAppError(e, `Import do „${opts.packageCode}“`));
  }
}

export async function exportOpenExchange(opts: {
  packageCode: string;
  kc?: KcClient;
  schema?: SchemaResolver;
  onProgress?: ProgressFn;
}): Promise<ExportResult> {
  const kc = opts.kc || getKc();
  const schema = opts.schema || getSchema();
  if (!schema.isLoaded()) await schema.load();
  const model = await exportExchangeModel({
    kc,
    schema,
    packageCode: opts.packageCode,
    onProgress: opts.onProgress,
  });
  const xml = serializeOpenExchangeXml(model);
  return {
    xml,
    elementCount: model.elements.length,
    relationshipCount: model.relationships.length,
    viewCount: model.views.length,
  };
}

export async function applyOpenExchangeOrphanActions(
  actions: Array<{ orphan: OrphanCandidate; action: OrphanAction }>,
  kc: KcClient = getKc(),
) {
  return applyOrphanActions({ kc, actions });
}
