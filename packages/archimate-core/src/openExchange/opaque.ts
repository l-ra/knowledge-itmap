import type { ExchangeProperty, ExchangeStyle } from "./types";

export type OpaquePropertyBag = {
  key: string;
  value: string;
  /** Optional source hint: property | attr */
  source?: "property" | "attr";
};

export function serializeOpaqueProperties(items: OpaquePropertyBag[]): string {
  return JSON.stringify(items);
}

export function parseOpaqueProperties(raw: string | undefined | null): OpaquePropertyBag[] {
  if (!raw?.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is OpaquePropertyBag => !!x && typeof x === "object" && typeof (x as OpaquePropertyBag).key === "string")
      .map((x) => ({
        key: String(x.key),
        value: String(x.value ?? ""),
        source: x.source === "attr" ? "attr" : x.source === "property" ? "property" : undefined,
      }));
  } catch {
    return [];
  }
}

export function propertiesToOpaque(props: ExchangeProperty[], extraAttrs: Record<string, string> = {}): OpaquePropertyBag[] {
  const out: OpaquePropertyBag[] = props.map((p) => ({
    key: p.key,
    value: p.value,
    source: "property" as const,
  }));
  for (const [k, v] of Object.entries(extraAttrs)) {
    out.push({ key: k, value: v, source: "attr" });
  }
  return out;
}

export function opaqueToExchangeProperties(items: OpaquePropertyBag[]): {
  properties: ExchangeProperty[];
  extraAttrs: Record<string, string>;
} {
  const properties: ExchangeProperty[] = [];
  const extraAttrs: Record<string, string> = {};
  for (const item of items) {
    if (item.source === "attr") extraAttrs[item.key] = item.value;
    else properties.push({ key: item.key, value: item.value });
  }
  return { properties, extraAttrs };
}

export function serializeStyle(style: ExchangeStyle | undefined): string | undefined {
  if (!style) return undefined;
  return JSON.stringify(style);
}

export function parseStyle(raw: string | undefined | null): ExchangeStyle | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return JSON.parse(raw) as ExchangeStyle;
  } catch {
    return { raw: { _unparsed: raw } };
  }
}

export function serializeBendpoints(points: Array<{ x: number; y: number }>): string {
  return JSON.stringify(points);
}

export function parseBendpoints(raw: string | undefined | null): Array<{ x: number; y: number }> {
  if (!raw?.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .map((p) => {
        if (!p || typeof p !== "object") return null;
        const o = p as { x?: unknown; y?: unknown };
        const x = Number(o.x);
        const y = Number(o.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
      })
      .filter((p): p is { x: number; y: number } => p !== null);
  } catch {
    return [];
  }
}
