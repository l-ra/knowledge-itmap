/**
 * Class shape constraints for reclassify / agent guidance.
 * Prefer KC GET /v1/shapes; fall back to documented AML required locals.
 */
import type { KcClient } from "./kcClient";
import type { SchemaResolver } from "./schema";
import {
  isAbstractArchimateClassLocal,
  isRelationshipClassLocal,
  isViewClassLocal,
} from "./openExchange/typeMap";

export type ClassConstraintProperty = {
  propertyLocal: string;
  propertyId: string;
  valueKinds?: string[];
  enums?: string[];
};

export type ClassConstraints = {
  classLocal: string;
  classId: string;
  requiredProperties: ClassConstraintProperty[];
  recommendedProperties: ClassConstraintProperty[];
  source: string;
  shapeCodes: string[];
};

/**
 * Interim table when shapes API is empty/unavailable.
 * Locals only — IRIs via SchemaResolver. Matches KC error-severity shapes.
 */
export const FALLBACK_REQUIRED_BY_CLASS: Record<string, string[]> = {
  BusinessActor: ["actorKind", "organizationScope"],
  Flow: ["flowLabel"],
};

/** Warning-severity AML shapes → recommended (do not block reclassify). */
export const FALLBACK_RECOMMENDED_BY_CLASS: Record<string, string[]> = {
  BusinessFunction: ["modelingDepth"],
  Association: ["associationKind"],
  CommunicationNetwork: ["networkKind"],
};

export type ShapeProfileDto = {
  id?: string;
  code: string;
  classId: string;
  packageCode?: string;
  document?: {
    requiredProperties?: string[];
    allowedProperties?: string[];
    closed?: boolean;
    severity?: string;
  };
};

function enrichProp(
  schema: SchemaResolver,
  propertyLocal: string,
): ClassConstraintProperty | null {
  const propertyId = schema.tryPropertyIri(propertyLocal);
  if (!propertyId) return null;
  const enums = schema.enumValues(propertyLocal);
  return {
    propertyLocal,
    propertyId,
    valueKinds: ["string"],
    enums: enums.length ? enums : undefined,
  };
}

function localsFromPropertyIds(
  schema: SchemaResolver,
  propertyIds: string[],
): string[] {
  const out: string[] = [];
  for (const id of propertyIds) {
    const local = schema.propertyLocal(id);
    if (local) out.push(local);
    else {
      const tail = id.split("/").pop();
      if (tail && schema.tryPropertyIri(tail)) out.push(tail);
    }
  }
  return out;
}

function uniqueLocals(locals: string[]): string[] {
  return [...new Set(locals.filter(Boolean))];
}

function isConcreteElementLocal(local: string): boolean {
  if (isAbstractArchimateClassLocal(local)) return false;
  if (isRelationshipClassLocal(local) || isViewClassLocal(local)) return false;
  if (
    local.startsWith("Ui") ||
    local.startsWith("Presentation") ||
    local.startsWith("RelationSlot") ||
    local === "AllowedRelationship" ||
    local === "StringEnum"
  ) {
    return false;
  }
  return true;
}

/** KC: empty severity defaults to error (blocks strict writes). */
function isErrorSeverity(severity: string | undefined): boolean {
  return !severity || severity === "error";
}

/**
 * Resolve required/recommended properties for a class local.
 * `requiredProperties` = error-severity shape requirements (block reclassify if missing).
 * `recommendedProperties` = warning-severity (e.g. modelingDepth).
 */
export async function getClassConstraints(
  kc: KcClient,
  schema: SchemaResolver,
  classLocal: string,
): Promise<ClassConstraints> {
  const classId = schema.classIri(classLocal);
  const shapeCodes: string[] = [];
  let requiredLocals: string[] = [];
  let recommendedLocals: string[] = [];
  let source = "fallback-table";

  try {
    const shapes = await kc.listShapes("archimate-lite");
    const applicable = shapes.filter((s) => {
      if (s.classId === classId) return true;
      const shapeLocal = schema.classLocal(s.classId);
      if (shapeLocal === "ArchiMateElement" && isConcreteElementLocal(classLocal)) return true;
      if (shapeLocal === "ArchiMateRelationship" && isRelationshipClassLocal(classLocal)) {
        return true;
      }
      return false;
    });
    if (applicable.length) {
      source = "kc-shapes";
      for (const sh of applicable) {
        if (sh.code) shapeCodes.push(sh.code);
        const ids = sh.document?.requiredProperties || [];
        const locals = localsFromPropertyIds(schema, ids);
        if (isErrorSeverity(sh.document?.severity)) {
          requiredLocals.push(...locals);
        } else {
          recommendedLocals.push(...locals);
        }
      }
    }
  } catch {
    /* use fallback */
  }

  const fallbackReq = FALLBACK_REQUIRED_BY_CLASS[classLocal] || [];
  const fallbackRec = FALLBACK_RECOMMENDED_BY_CLASS[classLocal] || [];

  if (!requiredLocals.length && !recommendedLocals.length && (fallbackReq.length || fallbackRec.length)) {
    requiredLocals = [...fallbackReq];
    recommendedLocals = [...fallbackRec];
    source = "fallback-table";
  } else {
    if (fallbackReq.length) {
      requiredLocals = uniqueLocals([...requiredLocals, ...fallbackReq]);
      if (source === "kc-shapes") source = "kc-shapes+fallback";
    }
    if (fallbackRec.length) {
      recommendedLocals = uniqueLocals([...recommendedLocals, ...fallbackRec]);
    }
  }

  requiredLocals = uniqueLocals(requiredLocals);
  recommendedLocals = uniqueLocals(recommendedLocals).filter((l) => !requiredLocals.includes(l));

  const requiredProperties = requiredLocals
    .map((local) => enrichProp(schema, local))
    .filter((p): p is ClassConstraintProperty => p !== null);
  const recommendedProperties = recommendedLocals
    .map((local) => enrichProp(schema, local))
    .filter((p): p is ClassConstraintProperty => p !== null);

  return {
    classLocal,
    classId,
    requiredProperties,
    recommendedProperties,
    source: shapeCodes.length ? `${source}:${shapeCodes.join(",")}` : source,
    shapeCodes,
  };
}

/** Locals required by constraints that are missing from props and existing entity values. */
export function missingRequiredPropLocals(
  constraints: ClassConstraints,
  props: Record<string, string> | undefined,
  existingLocalsWithValue: Set<string>,
): string[] {
  const missing: string[] = [];
  for (const req of constraints.requiredProperties) {
    const fromProps = props?.[req.propertyLocal]?.trim();
    if (fromProps) continue;
    if (existingLocalsWithValue.has(req.propertyLocal)) continue;
    missing.push(req.propertyLocal);
  }
  return missing;
}
