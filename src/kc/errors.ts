import { KcError } from "@/kc/client";

/** Human-readable error for UI + console. */
export function formatAppError(err: unknown, context?: string): string {
  const parts: string[] = [];
  if (context) parts.push(context);

  if (err instanceof KcError) {
    parts.push(`KC ${err.method || "?"} ${err.path || "?"} → HTTP ${err.status}`);
    if (err.code && err.code !== "error") parts.push(`code=${err.code}`);
    parts.push(err.message || "(bez zprávy)");
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
  return null;
}

export function logAppError(err: unknown, context?: string): void {
  const summary = formatAppError(err, context);
  console.error("[IT Map]", summary, err instanceof KcError ? err.body : err);
}
