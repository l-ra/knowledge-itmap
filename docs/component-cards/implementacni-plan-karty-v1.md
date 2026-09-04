# Implementační plán: režim Karty (v1)

**Stav:** fáze A hotova (IT Map na AML 3.1.0); další B→C→D dle plánu  
**Datum:** 2026-09-04  
**Vychází z:** [rozhodnuti-v1.md](./rozhodnuti-v1.md), [koncept-karet-komponent.md](./koncept-karet-komponent.md)  
**Prerekvizita:** archimate-lite **3.1.0** — **splněna** v `knowledge-models` (bundle + demo + UI traversal seed)

---

## 1. Cíl

Do IT Map přidat druhý režim vedle Browse:

- položka menu **Karty**
- procházení modelu po **kartách elementů** řízených PresentationProfile / RelationSlot
- v1 **jen čtení a navigace** (bez create/edit)

Browse (column browser + `archimate-ui-traversal`) zůstává beze změny jako samostatný režim.

---

## 2. Uzavřená rozhodnutí (shrnutí)

| Téma | Rozhodnutí |
|------|------------|
| Oddělení od Browse | Žádný import traversal kódu / Ui* typů do karet |
| Úložiště konfigurace | Nový KC package **`archimate-ui-cards`** |
| Mapování instance → profil | Odvozovat z `instanceOf` + match properties |
| V1 entity | `PresentationProfile` + `RelationSlot` |
| Hrany | Jen jednohranové sloty |
| Prázdné sloty | Existující + recommended; expert toggle |
| Labely | Schema = properties/enumy; profil = název profilu + labely slotů |
| Mining profilů | Ne |
| AML taxonomie | 3.1.0: `actorKind` + `organizationScope` |

**Non-goals v1:** create/edit, CardDefinition, ModelingConvention/path patterns, QualityRules, duplicate detection, org override profilů, nahrazení Browse.

---

## 3. Prerekvizita (hotovo)

V `knowledge-models` je k dispozici:

- `archimate-lite` **3.1.0** (`actorKind`: person | organizationalUnit | organization; `organizationScope`: internal | external)
- `archimate-lite-demo` na `^3.1.0`
- `archimate-ui-traversal` 1.0.0 seed upravený na novou taxonomii

IT Map ještě importuje **3.0.0** — první implementační krok je consumer bump (fáze A).

---

## 4. Architektura

```text
archimate-lite 3.1.0          archimate-ui-cards (nový)
  classes, props, enums   →     PresentationProfile
  AllowedRelationship           RelationSlot
           │                           │
           ▼                           ▼
     SchemaResolver ◄──── cards domain (loader, resolver, slot query)
           │
           ├── Browse (TraversalEngine, Ui*)     ← nesdílet s Kartami
           └── Karty UI (/cards)                 ← nový
```

**Sdílet:** KC client, auth, ChangeSet, SchemaResolver, případně tenké read API bez traversal závislostí.  
**Nesdílet:** TraversalEngine, templates, navigationProfile*, FlowColumns, browserUrlState, UiStage/UiTransition.

---

## 5. Datový model `archimate-ui-cards`

### 5.1 Třídy (návrh KC)

| Class | Účel |
|-------|------|
| `UiCardsMeta` | Kořen meta (analogie UiTraversalMeta) |
| `PresentationProfile` | Doménový typ prezentace elementu |
| `RelationSlot` | Sekce vazeb na kartě (potomek nebo child vazba na profil) |

### 5.2 PresentationProfile — properties

| Property | Typ | Význam |
|----------|-----|--------|
| `profileCode` | String | Stabilní id (`department`, `person`, `externalOrganization`, `application`) |
| `archimateElementType` | String | AML class iriLocal |
| `matchProperties` | String (JSON object) | Všechny páry property→value musí sedět |
| `fieldProperties` | String (CSV / JSON array) | Refs AML properties na kartu (labely ze schema) |
| `profileLabelCs` / labels | — | Doménový název profilu |
| `description` / descriptions | — | Krátký popis pro hub |

`defaultProperties` až ve create slice — do v1 seedu lze připravit, UI je nepoužije.

### 5.3 RelationSlot — properties

| Property | Typ | Význam |
|----------|-----|--------|
| `slotCode` | String | Id v rámci profilu |
| `parentProfile` | EntityRef | → PresentationProfile |
| `slotLabelCs` | String | Doménový label sekce |
| `relationshipType` | String | AML relationship class |
| `traverseDirection` | String | `outgoing` \| `incoming` |
| `targetClasses` | String (CSV) | Volitelný filtr cílových tříd |
| `targetProfileCodes` | String (CSV) | Volitelný filtr cílových profilů |
| `importance` | String | `recommended` \| `optional` |
| `sortOrder` | Integer / String | Pořadí na kartě |

### 5.4 Profile resolution (runtime)

1. Načíst všechny PresentationProfile ze system package (v1 bez org override).  
2. Match: `archimateElementType` == class entity ∧ všechny `matchProperties`.  
3. 0 → raw ArchiMate karta.  
4. >1 → nejvíce match keys; remíza → sort `profileCode`, first + warning.

### 5.5 Pilotní seed (4 profily)

Shodně s [rozhodnuti-v1.md](./rozhodnuti-v1.md) §4:

| profileCode | Match |
|-------------|--------|
| `department` | BusinessActor + organizationalUnit + internal |
| `person` | BusinessActor + person + internal |
| `externalOrganization` | BusinessActor + organization + external |
| `application` | ApplicationComponent |

Sloty ověřit proti `AllowedRelationship` při seedu; neplatné kombinace upravit (zejm. Association/`reportsTo`).

Package závisí na `kc-base` + `archimate-lite ^3.1.0`.

---

## 6. Fáze implementace

### Fáze A — IT Map consumer bump na AML 3.1.0

**Repo:** `knowledge-itmap`  
**Cíl:** Browse a seed fungují proti 3.1.0 (bez karet).

| Úkol | Soubory (orientačně) |
|------|----------------------|
| Import bundle 3.1.0 | `scripts/seed-demo.sh`, `scripts/check-kc.sh`, README |
| FALLBACK templates | `src/domain/templates.ts` — actorKinds / defaults + organizationScope |
| Doménové labely | `src/domain/traversal.ts` — `domainLabelFor` |
| Inspector | `Inspector.tsx` — edit `organizationScope`; actorKind nové hodnoty |
| Docs | `koncept-prochazeni-grafem.md`, zmínky ve funkční specifikaci |

**Akceptace:** čerstvý seed-demo, business-exploration ukáže organizační jednotky / osoby, Inspector uloží obě properties.

---

### Fáze B — Package `archimate-ui-cards` v knowledge-models

**Repo:** `knowledge-models`  
**Cíl:** catalog + bundle + system seed 4 profilů se sloty.

| Úkol | Poznámka |
|------|----------|
| `archimate-ui-cards/catalog.json` | Třídy + properties dle §5 |
| `build_bundle.py` / release `1.0.0` | Stejný pattern jako ui-traversal |
| Seed profilů | JSON nebo generátor |
| README + krátké RELEASE notes | Závislosti, účel (IT Map Karty) |

**Akceptace:** import `kc-base` → AML 3.1.0 → ui-traversal → **ui-cards** → demo bez chyby; entity profilů queryovatelné v KC.

---

### Fáze C — Domain vrstva karet v IT Map

**Repo:** `knowledge-itmap`  
**Cíl:** načtení profilů a sestavení view-modelu karty **bez** React navigace Browse.

| Modul (návrh) | Odpovědnost |
|---------------|-------------|
| `src/domain/cards/types.ts` | PresentationProfile, RelationSlot, CardViewModel |
| `src/domain/cards/profileLoader.ts` | Load z KC package `archimate-ui-cards` |
| `src/domain/cards/profileResolver.ts` | Match instance → profil / raw |
| `src/domain/cards/slotQuery.ts` | Pro slot: sousedé přes relSource/relTarget (vlastní query, ne TraversalEngine) |
| `src/kc/schema.ts` | Rozšířit load o ui-cards package (oddělené IRI, žádné Ui* reuse) |

Seed-demo / check-kc: importovat i `archimate-ui-cards` 1.0.0.

**Akceptace:** unit/smoke — pro demo `compliance-dept` resolvne `department`; slot `roles`/`people` vrátí sousedy dle modelu.

---

### Fáze D — UI read-only `/cards`

**Repo:** `knowledge-itmap`

| Úkol | Detail |
|------|--------|
| Route + menu | `App.tsx`: **Karty** → `/cards` |
| Hub | Seznam/hledání elementů org package; otevření karty |
| Card page | `/cards/:entityId` — header, fields, sloty, empty recommended, expert toggle |
| Navigace | Klik na souseda → push historie; tlačítko Zpět |
| Vztah | Volitelný tenký read-only panel/detail vztahu (bez editace) |
| URL stav | Jednoduchý (entity id + volitelně history stack v session/query) — **ne** reuse `browserUrlState` |

UI styl: držet se existujícího shellu IT Map (topbar, typography), ne nový marketing layout.

**Akceptace:**

1. Z menu Karty otevřu hub, najdu Odbor Compliance → karta Oddělení.  
2. Vidím recommended sloty (i prázdné) a existující vazby.  
3. Proklik na osobu/roli otevře jejich kartu; Zpět funguje.  
4. ApplicationComponent bez specifického kind → profil Aplikace.  
5. Neznámá kombinace → raw ArchiMate karta.  
6. Expert toggle ukáže další příchozí/odchozí AML hrany mimo sloty.  
7. Žádný import z `traversal.ts` / `navigationProfile*` v cards modulech (grep/CI sanity).

---

### Fáze E — mimo tento plán (později)

Create hub, edit fields/slotů, raw ArchiMate escape, org sada profilů, ModelingConvention („běží na“), QualityRules, mining.

---

## 7. Pořadí a závislosti

```text
A (IT Map ↔ AML 3.1.0)
    │
    ▼
B (archimate-ui-cards v knowledge-models)
    │
    ▼
C (cards domain + SchemaResolver)
    │
    ▼
D (/cards UI)
```

A a B lze částečně paralelizovat (B nezávisí na A), ale C vyžaduje obojí.

---

## 8. Rizika a ošetření

| Riziko | Ošetření |
|--------|----------|
| Slot neodpovídá AllowedRelationship | Validace při seedu; upravit slot |
| `ModelService` tahá traversal defaults | Fáze D jen read; create později vlastní path |
| Přeplněná karta | Jen recommended + existing; expert za toggle |
| Dvojí metamodel v profilech | Pravidlo z rozhodnuti-v1: jen refs + UX metadata |
| Association reportsTo směr | Ověřit na demo při fázi B |

---

## 9. Dokumentace po dokončení v1

- Aktualizovat `rozhodnuti-v1.md` stav → implementováno  
- Stručný popis v README / funkční specifikaci (režim Karty)  
- Označit zadání AML 3.1.0 jako splněné  

---

## 10. Schválení

Po schválení tohoto plánu postupuji v pořadí **A → B → C → D** bez rozšiřování scope o create/edit nebo path patterns.

**Žádám o schválení** (případně úpravy před startem fáze A).
