import type { PresentationProfileDef } from "./types";

/**
 * Resolve presentation profile from ArchiMate class + property values.
 * Prefer more specific match (more matchProperties keys). Tie-break by profileCode.
 */
export function resolvePresentationProfile(
  classLocal: string,
  propertyValues: Record<string, string | undefined>,
  profiles: PresentationProfileDef[],
): PresentationProfileDef | null {
  const candidates = profiles.filter((p) => p.archimateElementType === classLocal);
  const matched: PresentationProfileDef[] = [];

  for (const p of candidates) {
    const entries = Object.entries(p.matchProperties);
    if (entries.length === 0) {
      matched.push(p);
      continue;
    }
    const ok = entries.every(([key, expected]) => propertyValues[key] === expected);
    if (ok) matched.push(p);
  }

  if (matched.length === 0) return null;
  if (matched.length === 1) return matched[0];

  matched.sort((a, b) => {
    const byKeys = Object.keys(b.matchProperties).length - Object.keys(a.matchProperties).length;
    if (byKeys !== 0) return byKeys;
    return a.profileCode.localeCompare(b.profileCode);
  });

  if (
    matched.length > 1 &&
    Object.keys(matched[0].matchProperties).length ===
      Object.keys(matched[1].matchProperties).length
  ) {
    console.warn(
      "Multiple presentation profiles match",
      classLocal,
      propertyValues,
      matched.map((m) => m.profileCode),
    );
  }

  return matched[0];
}
