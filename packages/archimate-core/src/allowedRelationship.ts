/** Minimal schema surface needed to check AllowedRelationship matrix. */
export interface AllowedRelationshipSchema {
  isAllowed(typeLocal: string, sourceLocal: string, targetLocal: string): boolean;
}

/**
 * Throw when the relationship type is not in the AllowedRelationship matrix
 * for the given source → target class locals.
 */
export function assertAllowed(
  schema: AllowedRelationshipSchema,
  typeLocal: string,
  sourceLocal: string,
  targetLocal: string,
): void {
  if (schema.isAllowed(typeLocal, sourceLocal, targetLocal)) return;
  throw new Error(
    `Vztah ${typeLocal} není dovolen mezi ${sourceLocal} → ${targetLocal} (AllowedRelationship).`,
  );
}
