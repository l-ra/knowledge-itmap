/** HTTP / API error from Knowledge Core. */
import type { ValidationFinding, ValidationPayload } from "./types";

export class KcError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body?: unknown,
    public method?: string,
    public path?: string,
  ) {
    super(message);
    this.name = "KcError";
  }
}

/** Extract structured KC validation from a 422 (or WriteResponse-shaped) error body. */
export function extractValidationPayload(body: unknown): ValidationPayload | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const raw = (root.validation ?? root) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") return null;
  const findingsRaw = raw.findings;
  if (!Array.isArray(findingsRaw)) return null;
  const findings: ValidationFinding[] = findingsRaw.map((f) => {
    const row = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    return {
      severity: String(row.severity ?? ""),
      code: String(row.code ?? ""),
      message: String(row.message ?? ""),
      propertyId: typeof row.propertyId === "string" ? row.propertyId : undefined,
      classId: typeof row.classId === "string" ? row.classId : undefined,
      shapeCode: typeof row.shapeCode === "string" ? row.shapeCode : undefined,
      entityId: typeof row.entityId === "string" ? row.entityId : undefined,
      statementId: typeof row.statementId === "string" ? row.statementId : undefined,
    };
  });
  const summaryRaw = (raw.summary && typeof raw.summary === "object"
    ? raw.summary
    : {}) as Record<string, unknown>;
  return {
    entityId: typeof raw.entityId === "string" ? raw.entityId : undefined,
    findings,
    summary: {
      errors: Number(summaryRaw.errors ?? 0),
      warnings: Number(summaryRaw.warnings ?? 0),
      infos: summaryRaw.infos !== undefined ? Number(summaryRaw.infos) : undefined,
    },
  };
}

export function validationFromKcError(err: unknown): ValidationPayload | null {
  if (!(err instanceof KcError)) return null;
  return extractValidationPayload(err.body);
}

/** Human-readable error for UI, MCP, and logs (no DOM). */
export function formatAppError(err: unknown, context?: string): string {
  const parts: string[] = [];
  if (context) parts.push(context);

  if (err instanceof KcError) {
    parts.push(`KC ${err.method || "?"} ${err.path || "?"} → HTTP ${err.status}`);
    if (err.code && err.code !== "error") parts.push(`code=${err.code}`);
    parts.push(err.message || "(bez zprávy)");
    const validation = extractValidationPayload(err.body);
    if (validation?.findings?.length) {
      const compact = validation.findings
        .slice(0, 8)
        .map((f) => {
          const bits = [f.code || "?", f.message || ""];
          if (f.propertyId) bits.push(`propertyId=${f.propertyId}`);
          if (f.shapeCode) bits.push(`shape=${f.shapeCode}`);
          return bits.filter(Boolean).join(": ");
        })
        .join("; ");
      parts.push(
        `validation findings (${validation.summary.errors} errors): ${compact}`,
      );
    }
    const hint = hintForKcError(err);
    if (hint) parts.push(hint);
    return parts.join(" — ");
  }

  if (err instanceof Error) {
    parts.push(err.message || err.name);
    return parts.join(" — ");
  }

  parts.push(String(err));
  return parts.join(" — ");
}

/**
 * Structured MCP/tool error payload (JSON-serializable).
 * Prefer this when returning isError tool results so agents see findings[].
 */
export function structuredAppError(
  err: unknown,
  context?: string,
): {
  message: string;
  validation?: ValidationPayload;
  status?: number;
  code?: string;
} {
  const message = formatAppError(err, context);
  if (err instanceof KcError) {
    const validation = extractValidationPayload(err.body) || undefined;
    return {
      message,
      validation,
      status: err.status,
      code: err.code,
    };
  }
  return { message };
}

function hintForKcError(err: KcError): string | null {
  if (err.status === 404 || /not found/i.test(err.message)) {
    if (err.path?.includes("/iri-aliases")) {
      return "Alias nelze nastavit na entitu, která ještě není commitnutá (ChangeSet overlay).";
    }
    if (err.path?.includes("/packages/")) {
      return "Org package neexistuje — nejdřív vytvořte / použijte package.";
    }
    if (err.path?.includes("/entities/") && err.method === "GET") {
      return "Entita v KC neexistuje (nebo není vidět bez ChangeSet headeru).";
    }
    if (err.path?.includes("/changesets/") && err.path?.includes("/commit")) {
      return "Commit open ChangeSetu selhal (často chybějící subject/property při apply, ne zmizelý CS). Detaily výše.";
    }
    if (err.path?.includes("/changesets/")) {
      return "ChangeSet neexistuje nebo už není open.";
    }
    return "KC vrátilo 404 not found — často chybějící package, entita nebo property IRI.";
  }
  if (err.status === 401 || err.status === 403) {
    return "Zkontrolujte autentizaci (Settings / KC token).";
  }
  if (err.status === 409) {
    return "Konflikt (revize / claim) — zkuste znovu nebo vyřešte otevřený ChangeSet.";
  }
  if (err.status === 422) {
    return "Shape/constraint validace — viz validation.findings (code, propertyId).";
  }
  return null;
}

export function logAppError(err: unknown, context?: string): void {
  const summary = formatAppError(err, context);
  console.error("[IT Map]", summary, err instanceof KcError ? err.body : err);
}
