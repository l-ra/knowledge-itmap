/** Stable mapping between Open Exchange identifiers and KC iriLocal / aliases. */

export const EXCHANGE_ALIAS_PREFIX = "https://archimate.openexchange/id/";

export function exchangeAliasIri(identifier: string): string {
  return `${EXCHANGE_ALIAS_PREFIX}${identifier}`;
}

export function identifierFromAliasIri(iri: string): string | null {
  if (!iri.startsWith(EXCHANGE_ALIAS_PREFIX)) return null;
  return iri.slice(EXCHANGE_ALIAS_PREFIX.length) || null;
}

/** Use Exchange identifier as KC iriLocal (relative path segment). */
export function iriLocalFromIdentifier(identifier: string): string {
  return identifier.replace(/^\/+/, "").trim();
}

export function identifierFromEntity(opts: {
  iriLocal?: string;
  aliases?: Array<{ iri: string; kind: string }>;
  publicId: string;
}): string {
  if (opts.iriLocal && opts.iriLocal.trim()) return opts.iriLocal.trim();
  const imported = opts.aliases?.find((a) => a.kind === "imported");
  if (imported) {
    const fromAlias = identifierFromAliasIri(imported.iri);
    if (fromAlias) return fromAlias;
  }
  // Last resort: last path segment of public IRI
  try {
    const u = new URL(opts.publicId);
    const seg = u.pathname.replace(/\/+$/, "").split("/").pop();
    if (seg) return seg;
  } catch {
    /* ignore */
  }
  return opts.publicId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "entity";
}

export function isExchangeManagedAlias(aliases: Array<{ iri: string; kind: string }> | undefined): boolean {
  return Boolean(aliases?.some((a) => a.kind === "imported" && a.iri.startsWith(EXCHANGE_ALIAS_PREFIX)));
}
