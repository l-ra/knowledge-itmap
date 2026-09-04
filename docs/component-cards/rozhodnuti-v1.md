# Karty komponent — rozhodnutí v1

**Stav:** uzavřeno; prerekvizita AML 3.1.0 splněna  
**Diskuse:** [koncept-karet-komponent.md](./koncept-karet-komponent.md)  
**Prerekvizita:** [zadani-archimate-lite-3.1.0.md](./zadani-archimate-lite-3.1.0.md) (splněno v knowledge-models)  
**Implementace:** [implementacni-plan-karty-v1.md](./implementacni-plan-karty-v1.md) — ke schválení

---

## 1. Uzavřená rozhodnutí

| Téma | Rozhodnutí |
|------|------------|
| Oddělení od Browse | Karty jsou samostatný režim; nesdílí traversal koncept ani non-univerzální kód |
| KC konfigurace | Nový package `archimate-ui-cards` (ne `archimate-ui-traversal`) |
| Profile resolution | Odvozovat z `instanceOf` + match properties; žádné IRI profilu na instanci |
| První slice | Jen procházení (hub → karta → sloty → soused) |
| V1 entity | `PresentationProfile` + `RelationSlot` (sekce layoutu v profilu) |
| Hrany | Jen jednohranové sloty; path patterns / ModelingConvention odloženy |
| Prázdné sloty | Default: existující + recommended; expert až toggle |
| Validace hran | Slot ≠ matice; pozdější create jen přes `AllowedRelationship` |
| Labely | Properties/enumy ze schema; v profilu label profilu + labely slotů |
| Raw escape | Ano až u create slice; **bez miningu** nových profilů z usage |
| AML taxonomie | `actorKind` + `organizationScope` v archimate-lite **3.1.0** (viz zadání) |

### Sdílený kód (povoleno)

- KC client, auth, ChangeSet  
- `SchemaResolver` / AML schema  
- Tenký write/read bez importů z traversal (`ModelService` po auditu, nebo cards-own write helpers)

### Nesdílet s Kartami

- `TraversalEngine`, `templates.ts`, `navigationProfile*`, FlowColumns, `browserUrlState`, typy `UiStage` / `UiTransition`

---

## 2. Non-goals v1

- Create / edit na kartě a ve slotech  
- `CardDefinition` jako samostatná entita  
- `ModelingConvention` / multi-hop path edit  
- `QualityRules` systém  
- Duplicate detection / LLM  
- Mining PresentationProfile z usage  
- Org override sady profilů (až po system seedu)  
- Nahrazení column browseru

---

## 3. Datový model v1

```text
PresentationProfile
  id, label, description
  archimateElementType          # ref AML class iriLocal
  matchProperties[]             # všechny musí sedět na instanci
  defaultProperties[]           # až create slice
  fields[]                      # refs AML properties (labely ze schema)
  slots[]                       # RelationSlot

RelationSlot
  id, label                     # doménový label (Poskytuje, Běží na, …)
  relationshipType              # AML relationship class
  direction                     # outgoing | incoming
  targetElementTypes[]          # optional
  targetProfileIds[]            # optional
  importance                    # recommended | optional
                                # (expert = AML hrany mimo sloty profilu)
```

**Resolution**

1. Filtr profilů se stejným `archimateElementType` jako `instanceOf` entity.  
2. Zůstávají jen profily, jejichž všechny `matchProperties` sedí.  
3. 0 match → raw ArchiMate karta (generická).  
4. >1 match → vybrat nejpřesnější (nejvíce match properties); při remíze stabilní sort podle `id` + first; log warning.

Obrana proti druhému metamodelu: každé pole profilu je (a) reference na AML, (b) UX label/order/importance, nebo (c) match/default existujících properties.

---

## 4. Pilotní profily (papírový test — jednohranové sloty)

Profily počítají s AML **3.1.0**.

### 4.1 Oddělení (`department`)

- Match: `BusinessActor` + `actorKind=organizationalUnit` + `organizationScope=internal`
- Fields: (ze schema) — zatím žádné povinné nad rámec name/description entity
- Sloty (návrh):

| Slot | Label | Relace | Směr | Cíl | Importance |
|------|-------|--------|------|-----|------------|
| parts | Části / podřízené jednotky | Composition | outgoing | BusinessActor | recommended |
| parent | Nadřízená jednotka | Composition | incoming | BusinessActor | optional |
| roles | Zastává role | Assignment | outgoing | BusinessRole | recommended |
| people | Osoby v jednotce | Composition | outgoing | BusinessActor (person) | recommended |

### 4.2 Osoba (`person`)

- Match: `BusinessActor` + `actorKind=person` + `organizationScope=internal`
- Sloty:

| Slot | Label | Relace | Směr | Cíl | Importance |
|------|-------|--------|------|-----|------------|
| roles | Zastává role | Assignment | outgoing | BusinessRole | recommended |
| unit | Patří do jednotky | Composition | incoming | BusinessActor | recommended |
| reportsTo | Nadřízený | Association (`associationKind=reportsTo`) | outgoing* | BusinessActor | optional |

\*Přesný směr Association ověřit proti demo / AllowedRelationship při seedu.

### 4.3 Externí organizace (`externalOrganization`)

- Match: `BusinessActor` + `actorKind=organization` + `organizationScope=external`
- Sloty: role / poskytované služby dle demo — minimálně Assignment na BusinessRole (optional), Association na interní actory (optional).

### 4.4 Aplikace (`application`)

- Match: `ApplicationComponent` (bez kind property, dokud AML nemá `componentKind`)
- Sloty:

| Slot | Label | Relace | Směr | Cíl | Importance |
|------|-------|--------|------|-----|------------|
| provides | Poskytuje služby | Realization | outgoing | ApplicationService | recommended |
| serves | Podporuje | Serving | outgoing | BusinessProcess / BusinessFunction / … | recommended |
| usedBy | Používáno | Serving | incoming | (dle matice) | optional |
| composedOf | Části | Composition | outgoing | ApplicationComponent | optional |
| partOf | Součást | Composition | incoming | ApplicationComponent | optional |

**Odloženo:** „Běží na“ přes Artifact path (ModelingConvention).

Při seedu `archimate-ui-cards` tyto sloty zapsat a ověřit proti `AllowedRelationship`; upravit, pokud matice směr/typ nepovolí.

---

## 5. UX v1 (read-only)

1. Menu položka **Karty** → route `/cards`  
2. Hub: hledání / seznam entit org package → otevření karty  
3. Karta: header (profil label + AML typ), fields, sloty (filled + empty recommended), toggle expert  
4. Klik na souseda → navigace na jeho kartu + historie zpět  
5. Tenký generický detail vztahu (bez editace)

---

## 6. Pořadí prací

1. **Provedení** [zadani-archimate-lite-3.1.0.md](./zadani-archimate-lite-3.1.0.md) v `knowledge-models`  
2. IT Map: bump seed na AML 3.1.0 + úpravy Browse závislé na starých enum hodnotách  
3. Package `archimate-ui-cards` + seed 4 profilů  
4. Read-only UI `/cards`
