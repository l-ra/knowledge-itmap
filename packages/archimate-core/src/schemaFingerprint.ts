import type { PackageInfo } from "./types";

/** System packages whose entities feed SchemaResolver. */
export const SCHEMA_PACKAGE_CODES = [
  "kc-base",
  "archimate-lite",
  "archimate-ui-traversal",
  "archimate-ui-cards",
] as const;

/**
 * Stable fingerprint of metamodel inputs. When unchanged, SchemaResolver may
 * reuse memory / IndexedDB cache instead of re-downloading package contents.
 */
export function schemaFingerprint(
  packages: PackageInfo[],
  schemaConfigUpdatedAt?: string,
): string {
  const byCode = new Map(packages.map((p) => [p.code, p]));
  const parts = SCHEMA_PACKAGE_CODES.map((code) => {
    const p = byCode.get(code);
    if (!p) return `${code}:missing`;
    const ver = p.latestReleaseVersion ?? "";
    const dirty = p.modifiedAfterRelease ? "1" : "0";
    const updated = p.updatedAt ?? "";
    return `${code}@${ver}:${dirty}:${updated}`;
  });
  if (schemaConfigUpdatedAt) parts.push(`cfg:${schemaConfigUpdatedAt}`);
  return parts.join("|");
}
