/** Short ArchiMate Lite modeling primer (CS + EN). Not UI-traversal specific. */

export type PrimerLang = "cs" | "en";

export const MODELING_PRIMER_CS = `ArchiMate Lite (IT Map) — stručný primer

Účel: modelovat architekturu organizace v Knowledge Core podmnožinou ArchiMate (Lite).
Zápisy jdou vždy přes open ChangeSet; člověk typicky schvaluje commit (režim propose).

Granularita (L0–L4):
- L0 katalog: systém, vlastník, kritičnost, RTO/RPO, business služba
- L1 hlavní závislosti: klíčové aplikace, DB, IdP, storage, DNS, síťové služby
- L2 aplikační rozpad: FE/BE/worker/API, fronty, datové objekty
- L3 provozní infra: clustery, VM, namespace, lokality, síťové zóny
- L4 technický detail u kritických systémů (VIP, DNS, významné endpointy)
L5 (jednotlivé IP, porty, dočasné pody) do modelu nepatří — eventualní SoT jinde.

Do modelu patří objekt, pokud je důležitý pro pochopení architektury, má dopad na
dostupnost/DR, je sdílenou závislostí, má vlastníka, nebo odpovídá na „co se stane
při výpadku X?“. Nezapisujte metamodel packages (archimate-lite, kc-base, UI).

Vztahy: jen dle AllowedRelationship matice. Flow vyžaduje flowLabel.

Karty (archimate-ui-cards): business labely typů a vazebních slotů (např. „Poskytuje
služby“ = Realization). Karty nejsou KC Lens — jen projekce pro agenta/UI.

Views: DiagramView / ViewNode / ViewConnection = prezentace; nejdřív element/rel
v grafu, potom node/connection.

Čištění / změna typu (zachovat id):
- Nepoužívejte import_open_exchange k reclassify (riziko dual instanceOf).
- Preferujte reclassify_entity / reclassify_entities (stejné id i iriLocal; views zůstanou).
- Shaped třídy (BusinessActor, Flow, …): nejdřív get_class_constraints(newClassLocal).
- dryRun=true s props → missingRequiredProps + invalidRelationships (peer projection v batchi).
- Doplňte props / vyřešte vztahy, pak dryRun=false; strictRelations=fail při konfliktu matice.
- Deprecate entity jen při skutečné náhradě novým id (ne po čistém reclassify).

Reclassify shaped (Function→Actor):
1. get_class_constraints("BusinessActor") → actorKind, organizationScope
2. reclassify_*(…, dryRun=true, props={actorKind, organizationScope})
3. Doplnit props / deprecate|update_relationship dle reportu
4. reclassify_*(…, dryRun=false, props=…)
5. commit_changeset(confirm_commit=true)
Příklad props: actorKind=organizationalUnit|organization|person, organizationScope=internal|external.

Recept AS→AC „split“ (bez dedicovaného toolu):
1. reclassify_entities (ApplicationService → ApplicationComponent, preserve id)
2. create_entity (ApplicationService) — behaviorální companion
3. create_relationship (Realization AC → AS)
4. update_relationship (Serving ends / typ) dle potřeby
5. update_entity (labels) volitelně
6. deprecate_entity jen pokud vzniká náhradní entita s novým id

Open Exchange: import/export ArchiMate 3 XML (včetně views); identity přes IRI aliasy.
OE zůstává pro bulk sync, ne pro typové migrace.`;

export const MODELING_PRIMER_EN = `ArchiMate Lite (IT Map) — short primer

Purpose: model organizational architecture in Knowledge Core with an ArchiMate subset (Lite).
Writes always use an open ChangeSet; humans typically approve commit (propose mode).

Granularity (L0–L4):
- L0 catalog: system, owner, criticality, RTO/RPO, business service
- L1 main dependencies: key apps, DB, IdP, storage, DNS, network services
- L2 application breakdown: FE/BE/worker/API, queues, data objects
- L3 runtime infra: clusters, VMs, namespaces, sites, network zones
- L4 technical detail for critical systems (VIP, DNS, notable endpoints)
L5 (every IP, switch ports, ephemeral pods) does not belong in the model.

Include an object if it matters for understanding architecture, availability/DR,
shared dependency, ownership, or “what happens if X fails?”. Never write metamodel
packages (archimate-lite, kc-base, UI packages).

Relationships: AllowedRelationship matrix only. Flow requires flowLabel.

Cards (archimate-ui-cards): business labels for types and relationship slots
(e.g. “Provides services” = Realization). Cards are not KC Lens — projection only.

Views: DiagramView / ViewNode / ViewConnection are presentation; ensure element/rel
exist before adding nodes/connections.

Type cleanup (preserve id):
- Do not use import_open_exchange to reclassify (dual instanceOf risk).
- Prefer reclassify_entity / reclassify_entities (same id and iriLocal; views stay linked).
- Shaped classes (BusinessActor, Flow, …): call get_class_constraints(newClassLocal) first.
- dryRun=true with props → missingRequiredProps + invalidRelationships (peer projection in batch).
- Fix props / relations, then dryRun=false; strictRelations=fail blocks matrix conflicts.
- Deprecate an entity only when replacing it with a new id (not after pure reclassify).

Shaped reclassify (Function→Actor):
1. get_class_constraints("BusinessActor") → actorKind, organizationScope
2. reclassify_*(…, dryRun=true, props={actorKind, organizationScope})
3. Supply props / deprecate|update_relationship per report
4. reclassify_*(…, dryRun=false, props=…)
5. commit_changeset(confirm_commit=true)
Example props: actorKind=organizationalUnit|organization|person, organizationScope=internal|external.

Recipe AS→AC “split” (compose primitives; no dedicated tool):
1. reclassify_entities (ApplicationService → ApplicationComponent, preserve id)
2. create_entity (ApplicationService) — behavioral companion
3. create_relationship (Realization AC → AS)
4. update_relationship (Serving ends / type) as needed
5. update_entity (labels) optional
6. deprecate_entity only if a replacement entity with a new id is created

Open Exchange: import/export ArchiMate 3 XML (including views); identity via IRI aliases.
OE is for bulk sync, not type migrations.`;

export function getModelingPrimer(lang: PrimerLang = "cs"): string {
  return lang === "en" ? MODELING_PRIMER_EN : MODELING_PRIMER_CS;
}

export const MODELING_PRIMER = {
  cs: MODELING_PRIMER_CS,
  en: MODELING_PRIMER_EN,
} as const;
