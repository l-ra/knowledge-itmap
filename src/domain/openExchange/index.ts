import {
  importOpenExchange as coreImport,
  exportOpenExchange as coreExport,
  applyOpenExchangeOrphanActions as coreApplyOrphans,
  parseOpenExchangeXml,
  serializeOpenExchangeXml,
  applyOrphanActions,
  type ExportResult,
  type ImportResult,
  type OrphanAction,
  type OrphanCandidate,
  type ImportWarning,
  type KcClient,
  type SchemaResolver,
} from "@itmap/archimate-core";
import { getKc } from "@/kc/client";
import { getSchema } from "@/kc/schema";

export type { ExportResult, ImportResult, OrphanAction, OrphanCandidate, ImportWarning };
export { parseOpenExchangeXml, serializeOpenExchangeXml, applyOrphanActions };

type ProgressFn = (message: string, done: number, total: number) => void;

export async function importOpenExchange(opts: {
  xml: string;
  packageCode: string;
  kc?: KcClient;
  schema?: SchemaResolver;
  onProgress?: ProgressFn;
}): Promise<ImportResult> {
  return coreImport({
    ...opts,
    kc: opts.kc || getKc(),
    schema: opts.schema || getSchema(),
  });
}

export async function exportOpenExchange(opts: {
  packageCode: string;
  kc?: KcClient;
  schema?: SchemaResolver;
  onProgress?: ProgressFn;
}): Promise<ExportResult> {
  return coreExport({
    ...opts,
    kc: opts.kc || getKc(),
    schema: opts.schema || getSchema(),
  });
}

export async function applyOpenExchangeOrphanActions(
  actions: Array<{ orphan: OrphanCandidate; action: OrphanAction }>,
  kc: KcClient = getKc(),
) {
  return coreApplyOrphans(actions, kc);
}
