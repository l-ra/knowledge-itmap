# Implementační plán: konfigurace traversalu přes metadata v KC

**Stav:** Implementováno (fáze 1–5, srpen 2026)  
**Datum:** 2026-08-28  
**Kontext:** Přesun topologie column browseru z hardcoded `templates.ts` do deklarativních dat v Knowledge Core

**Související dokumenty:**

- [`koncept-prochazeni-grafem.md`](koncept-prochazeni-grafem.md) — aktuální chování TraversalEngine
- [`navrh-ui-konfiguracni-vrstvy.md`](navrh-ui-konfiguracni-vrstvy.md) — architektonické varianty (základ pro tento plán)
- [`funkcni-specifikace.md`](funkcni-specifikace.md) — vrstvení balíčků KC

---

## 1. Cíl

Implementovat **plnohodnotnou konfiguraci traversalu** jako metadata v KC tak, aby:

1. **Definice tříd** pro zápis pravidel byly v metamodelu `archimate-lite` (stejný pattern jako `AllowedRelationship`).
2. **Výchozí pravidla** (dnes v `src/domain/templates.ts`) byly seedované instance v `archimate-lite`.
3. **Uživatelská pravidla** byla připojená k organizaci přes **property na package-root entitě** org balíčku; instance profilu mohou žít v **libovolném KC package**, ale používají **stejný slovník** (`Ui*` třídy z `archimate-lite`).
4. **IT Map** měla **dedikované UI** pro prohlížení a editaci pravidel (stages, transitions, add actions).

TraversalEngine zůstane v aplikaci — mění se pouze **zdroj konfigurace** (KC místo konstant v kódu).

---

## 2. Východisko (současný stav)

| Oblast | Stav |
|--------|------|
| Topologie navigace | 3 šablony hardcoded v `templates.ts` (~480 řádků) |
| Engine | `TraversalEngine` čte `TraversalTemplate` přes `getTemplate()` |
| Metamodel | `archimate-lite` 2.1.0/2.2.0 — **bez** `Ui*` tříd |
| Org package | package-root (`kc-base:Package`) — pouze `packageCode`, labels |
| UI | Dropdown šablon v BrowserPage; žádná editace pravidel |

**Mapování současných typů → cílový metamodel:**

| `templates.ts` | KC entita |
|----------------|-----------|
| `TraversalTemplate` | `UiTraversalTemplate` |
| `StageDef` | `UiStage` |
| `TransitionDef` | `UiTransition` |
| `AddActionDef` | `UiAddAction` |
| `TEMPLATES[]` + `getTemplate()` | `UiNavigationProfile` + resolver |

---

## 3. Cílová architektura

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  archimate-lite (metamodel + systémový seed)                            │
│  ───────────────────────────────────────────                            │
│  UiNavigationProfile, UiTraversalTemplate, UiStage,                     │
│  UiTransition, UiAddAction  (třídy + properties + shapes)               │
│  ui-profile-itmap-default   (seed: 3 výchozí šablony = dnešní templates)│
└─────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ instanceOf, statements
                                    │
┌───────────────────────────────────┴───────────────────────────────────┐
│  libovolný package (org-demo, org-ote-config, …)                       │
│  ─────────────────────────────────────────────                         │
│  instance UiNavigationProfile „org-ote-custom“                         │
│    └── UiTraversalTemplate, UiStage, UiTransition, UiAddAction          │
└────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ orgNavigationProfile (EntityReference)
┌───────────────────────────────────┴───────────────────────────────────┐
│  org-{code} package-root (kc-base:Package)                              │
│  https://example.org/org/ote/.package                                  │
│    packageCode = org-ote                                               │
│    orgNavigationProfile → org-ote-custom                               │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  IT Map                                                                  │
│  NavigationProfileResolver → TraversalTemplate[]                         │
│  TraversalEngine (beze změny algoritmu)                                  │
│  NavigationConfigPage (editace pravidel)                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Odpovědnosti vrstev

| Vrstva | Odpovídá na |
|--------|-------------|
| KC instance (org package) | *Co* je v modelu organizace |
| archimate-lite `Ui*` | *Jak* se po grafu prochází — slovník + výchozí profil |
| Org package-root property | *Který* profil platí pro danou organizaci |
| IT Map engine | Interpretace profilu, cache, validace, fallback |
| IT Map UI | Editace profilu, náhled, diagnostika |

---

## 4. Rozšíření archimate-lite (knowledge-core)

**Verze:** `archimate-lite` **2.3.0** (navazuje na doménový model 2.1.0; UI profil nebyl součástí 2.2.0)

### 4.1 Nové třídy metamodelu

Všechny pod `ArchiMateLiteMeta` (policy data, ne ArchiMate instance v org modelu):

```text
ArchiMateLiteMeta
  ├── AllowedRelationship      (existující)
  ├── ExchangeSpec             (existující)
  ├── UiNavigationProfile      (nové)
  ├── UiTraversalTemplate      (nové)
  ├── UiStage                  (nové)
  ├── UiTransition             (nové)
  └── UiAddAction              (nové)
```

### 4.2 Properties — třídy a domény

#### UiNavigationProfile

| `iriLocal` | Typ | Popis |
|------------|-----|-------|
| `profileCode` | String | Unikátní kód profilu (`itmap-default`, `org-ote-custom`) |
| `profileVersion` | String | Semver profilu (`1.0.0`) |
| `minCatalogVersion` | String | Min. verze archimate-lite (`2.3.0`) |
| `isSystemDefault` | Boolean | `true` jen u seed profilu v archimate-lite |
| `parentProfile` | EntityReference → UiNavigationProfile | Volitelná dědičnost |
| `labelCs` | String | Název v UI |
| `labelEn` | String | Název EN |

#### UiTraversalTemplate

| `iriLocal` | Typ | Popis |
|------------|-----|-------|
| `parentProfile` | EntityReference → UiNavigationProfile | **povinné** |
| `templateCode` | String | `business-exploration`, … |
| `labelCs` | String | Název v dropdownu |
| `isDefault` | Boolean | Výchozí šablona v profilu |
| `startStage` | EntityReference → UiStage | První sloupec (alternativa: nejnižší `stageOrder`) |
| `sortOrder` | Integer | Pořadí v seznamu šablon |

#### UiStage

| `iriLocal` | Typ | Popis |
|------------|-----|-------|
| `parentTemplate` | EntityReference → UiTraversalTemplate | **povinné** |
| `stageCode` | String | `organization`, `functions`, … |
| `stageOrder` | Integer | Pořadí sloupce (1-based, bez mezer) |
| `columnLabelCs` | String | Popisek sloupce |
| `targetClasses` | EntityReference[] → Class | ArchiMate třídy ve sloupci (více hodnot) |
| `instanceFilter` | String | JSON whitelist filtr (viz §4.4) |
| `actorKinds` | String | CSV enum hodnot `actorKind` (`department,person`) |

#### UiTransition

| `iriLocal` | Typ | Popis |
|------------|-----|-------|
| `parentTemplate` | EntityReference → UiTraversalTemplate | **povinné** |
| `fromStage` | EntityReference → UiStage | Zdrojový sloupec |
| `toStage` | EntityReference → UiStage | Cílový sloupec |
| `relationshipClass` | EntityReference → Class | `Assignment`, `Serving`, … |
| `traverseDirection` | String enum | `model` \| `inverse` |
| `uiEdgeLabelCs` | String | Popisek hrany v column browseru |
| `requireProperty` | String | Volitelný JSON `{ "property": "associationKind", "value": "reportsTo" }` |

#### UiAddAction

| `iriLocal` | Typ | Popis |
|------------|-----|-------|
| `parentTemplate` | EntityReference → UiTraversalTemplate | **povinné** |
| `stage` | EntityReference → UiStage | Sloupec, kde je akce dostupná |
| `actionCode` | String | `add-function`, … |
| `domainLabelCs` | String | Popisek v Add menu |
| `createsClass` | EntityReference → Class | Vytvářená ArchiMate třída |
| `defaultProperties` | String | JSON `Record<string,string>` |
| `derivesRelationship` | EntityReference → Class | Volitelný odvozený vztah |
| `relationshipDirection` | String enum | `from-selected-to-new` \| `from-new-to-selected` |
| `relationshipDefaults` | String | JSON properties na vztahu |
| `sortOrder` | Integer | Pořadí v Add menu |

#### Vazba na organizaci — property na Package

| `iriLocal` | Typ | Domain | Popis |
|------------|-----|--------|-------|
| `orgNavigationProfile` | EntityReference → UiNavigationProfile | `Package` (kc-base) | Odkaz z org package-root na aktivní navigační profil |

> **Poznámka:** `Package` je třída z `kc-base`; property definujeme v `archimate-lite` s `domain: ["Package"]` — stejný pattern jako rozšiřování foundation typů.

### 4.3 Shapes (validace při zápisu)

| Shape | Třída | Povinné |
|-------|-------|---------|
| `aml-ui-navigation-profile` | UiNavigationProfile | `profileCode`, `profileVersion`, `labelCs` |
| `aml-ui-traversal-template` | UiTraversalTemplate | `parentProfile`, `templateCode`, `labelCs` |
| `aml-ui-stage` | UiStage | `parentTemplate`, `stageCode`, `stageOrder`, `columnLabelCs`, `targetClasses` |
| `aml-ui-transition` | UiTransition | `parentTemplate`, `fromStage`, `toStage`, `relationshipClass`, `traverseDirection`, `uiEdgeLabelCs` |
| `aml-ui-add-action` | UiAddAction | `parentTemplate`, `stage`, `actionCode`, `domainLabelCs`, `createsClass` |

### 4.4 Whitelist `instanceFilter` / `requireProperty`

Aby se předešlo „programování v datech“, povolené klíče:

```json
{
  "actorKind": "department | person | external",
  "ownership": "internal | external | saas",
  "associationKind": "<string>",
  "accessMode": "read | write | readWrite"
}
```

Složitější logika (skip prázdných stage, deduplikace) zůstává v `TraversalEngine`.

### 4.5 Enum entity v catalogu

| Enum | Hodnoty |
|------|---------|
| `traverseDirection` | `model`, `inverse` |
| `relationshipDirection` | `from-selected-to-new`, `from-new-to-selected` |

### 4.6 Seed výchozího profilu

Nový soubor `models/archimate-lite/ui-profile-seed.json` (nebo sekce v catalogu) — **1:1 přepis** obsahu `templates.ts`:

| Šablona | Stages | Transitions | Add actions |
|---------|--------|-------------|-------------|
| `business-exploration` | 12 | 22 | 16 |
| `application-impact` | 5 | 4 | 0 |
| `infrastructure` | 6 | 5 | 0 |

Kořenová instance:

```text
UiNavigationProfile: ui-profile-itmap-default
  profileCode: itmap-default
  isSystemDefault: true
  profileVersion: 1.0.0
  minCatalogVersion: 2.3.0
  labelCs: IT Map — výchozí navigace
```

Seed se importuje s `archimate-lite-2.3.0.bundle.json`. IT Map po importu **nepotřebuje** hardcoded konstanty (ale fallback v kódu ponecháme do Fáze 4).

### 4.7 Úkoly knowledge-core

| # | Úkol | Výstup |
|---|------|--------|
| KC-1 | Doplnit `Ui*` třídy, properties, shapes, enums do `catalog.json` | catalog diff |
| KC-2 | Přidat `orgNavigationProfile` na domain `Package` | property + shape hint |
| KC-3 | Vygenerovat seed z aktuálního `templates.ts` | `ui-profile-seed.json` |
| KC-4 | `build_bundle.py` → `archimate-lite-2.3.0.bundle.json` | release bundle |
| KC-5 | Aktualizovat `load.py`, README, semver | dokumentace KC |
| KC-6 | Volitelně: validátor profilu v load skriptu | CI check |

---

## 5. IT Map — načítání a merge profilů

### 5.1 Nový modul `NavigationProfileResolver`

Soubor: `src/domain/navigationProfile.ts`

```text
NavigationProfileResolver
  loadResolvedProfile(orgPackageCode): Promise<ResolvedNavigationProfile>
  listTemplates(orgPackageCode): Promise<TraversalTemplate[]>
  getTemplate(orgPackageCode, templateCode): Promise<TraversalTemplate>
```

**Algoritmus `loadResolvedProfile`:**

```text
1. Načti systémový profil:
     entities?package=archimate-lite&instanceOf=UiNavigationProfile
     filtr: isSystemDefault = true  →  systemProfile

2. Načti org package info → rootEntityId

3. Načti statement orgNavigationProfile na rootEntityId
     → pokud chybí: return map(systemProfile)

4. Načti orgProfile entitu (libovolný package dle entity.packageCode)

5. Merge profilů:
     templates = {}
     pro každý template v systemProfile (rekurzivně parentProfile):
       templates[templateCode] = template
     pro každý template v orgProfile (+ parent chain):
       templates[templateCode] = template   // org přepíše systém

6. Validace každé šablony → TraversalTemplate
7. Cache v paměti (invalidace při graphEpoch / reloadSchema)
```

**Dědičnost `parentProfile`:** org profil může deklarovat `parentProfile → ui-profile-itmap-default` a přidat/override jen vybrané šablony.

### 5.2 Mapper KC → `TraversalTemplate`

Soubor: `src/domain/navigationProfileMapper.ts`

- Načte všechny `UiStage` / `UiTransition` / `UiAddAction` pro daný `UiTraversalTemplate` (dotaz přes `parentTemplate` statement).
- `targetClasses` EntityReference[] → `ArchiClassLocal[]` přes `schema.classLocal()`.
- `instanceFilter` JSON → `StageDef.filter` + `actorKinds`.
- Zachová existující interface `TraversalTemplate` — **TraversalEngine se nemění**.

### 5.3 Validace při načtení

| Kontrola | Akce při chybě |
|----------|----------------|
| `relationshipClass` existuje | warning + skip transition |
| `traverseDirection` ∈ enum | error |
| `fromStage`/`toStage` patří stejnému template | error |
| `stageOrder` souvislé | warning |
| Transition ⊆ AllowedRelationship (soft) | warning v UI |
| `minCatalogVersion` ≤ loaded catalog | error s hintem na upgrade |

### 5.4 Integrace do existujícího kódu

| Soubor | Změna |
|--------|-------|
| `src/domain/templates.ts` | Ponechat typy + `FALLBACK_TEMPLATES`; export pro testy |
| `src/domain/traversal.ts` | `getTemplate` → injektovaný resolver; implementovat `requireProperty` |
| `src/state/AppContext.tsx` | `navigationResolver`, `reloadNavigationProfile()`, `resolvedTemplates` |
| `src/pages/BrowserPage.tsx` | Dropdown z resolveru; persist `templateCode` v localStorage |
| `scripts/seed-demo.sh` | Import `archimate-lite-2.3.0`; volitelně demo org profil |

### 5.5 Fallback strategie

```text
KC profil dostupný     →  použij merge(system, org)
KC profil chybí        →  FALLBACK_TEMPLATES z templates.ts + console.warn
Částečně poškozený     →  použij validní šablony + toast s chybami
```

---

## 6. IT Map — UI pro editaci pravidel

### 6.1 Umístění v aplikaci

Nová route **`/navigation`** (název v menu: **„Navigace“**), umístění v topbaru mezi Packages a Changes.

Alternativně záložka v Packages u aktivního org balíčku — doporučení: **samostatná stránka** s kontextem aktivní org.

### 6.2 Obrazovky

> **Uživatelský postup z UI** (krok za krokem, včetně ChangeSet workflow): [`koncept-prochazeni-grafem.md`](koncept-prochazeni-grafem.md) § 3.4.

#### A. Přehled profilu (`NavigationConfigPage`)

- Aktivní org, odkazovaný profil (IRI, package, verze)
- Tlačítka:
  - **Použít výchozí** — odebere `orgNavigationProfile` z package-root
  - **Duplikovat výchozí** — vytvoří kopii profilu v org package a připojí
  - **Připojit existující** — výběr `UiNavigationProfile` z KC (libovolný package)
- Seznam šablon v resolved profilu (badge: systém / org / override)
- Varování z validátoru

#### B. Editor šablony (`NavigationTemplateEditor`)

Layout ve třech panelech (podobně jako Browser):

| Panel | Obsah |
|-------|-------|
| **Stages** | Seřazený seznam `UiStage`; drag reorder → aktualizace `stageOrder` |
| **Transitions** | Tabulka from → to, vztah, směr, label; filtr dle vybraného stage |
| **Add actions** | Seznam akcí pro vybraný stage |

Akce: Přidat / Upravit / Smazat (přes ChangeSet).

#### C. Formuláře polí

- **Stage:** `stageCode`, `columnLabelCs`, multi-select `targetClasses`, `actorKinds`, `instanceFilter` (builder, ne raw JSON)
- **Transition:** pickers `fromStage`/`toStage`, select `relationshipClass`, `traverseDirection`, `uiEdgeLabelCs`, volitelný `requireProperty`
- **Add action:** pickers dle `AddActionDef` z `templates.ts`

#### D. Náhled

Tlačítko **„Otevřít v Browseru“** — přepne template v BrowserPage a ověří chování.

### 6.3 Servisní vrstva UI

Soubor: `src/domain/navigationProfileService.ts`

```text
NavigationProfileService
  getOrgProfileLink(orgPackageCode)
  setOrgProfileLink(orgPackageCode, profileId | null)
  createProfileInPackage(packageCode, basedOn?: profileId)
  cloneTemplate(profileId, templateCode, newCode)
  upsertStage / upsertTransition / upsertAddAction
  deleteStage / deleteTransition / deleteAddAction
  validateProfile(profileId): ValidationIssue[]
```

Všechny mutace přes existující `ModelService` + ChangeSet (`pushChangeSet`).

### 6.4 Oprávnění (1. iterace)

- Editace povolena při otevřeném manuálním ChangeSetu (stejný pattern jako zbytek IT Map).
- Později: role `navigation-admin` / KC policy.

### 6.5 UX principy

- Systémové šablony **read-only** (šedé); override = „Fork do org profilu“.
- Destruktivní akce (smazání stage s transitions) s potvrzením.
- Inline validace proti AllowedRelationship při výběru vztahu.

---

## 7. Fáze implementace

### Fáze 1 — Metamodel a seed (knowledge-core)

**Cíl:** KC umí reprezentovat dnešní 3 šablony.

| Krok | Popis | Odhad |
|------|-------|-------|
| 1.1 | Spec `Ui*` v catalog.json | 1–2 dny |
| 1.2 | Seed generator z templates.ts | 0.5 dne |
| 1.3 | Bundle 2.3.0 + load skript | 0.5 dne |
| 1.4 | Review + merge do knowledge-core | — |

**Akceptační kritéria:**

- Po importu bundle existuje `ui-profile-itmap-default` se 3 šablonami.
- KC API vrací stages/transitions/addActions jako entity + statements.

### Fáze 2 — Resolver a engine (IT Map, read-only)

**Cíl:** Browser běží z KC dat, ne z konstant.

| Krok | Popis | Odhad |
|------|-------|-------|
| 2.1 | `navigationProfileMapper.ts` | 1 den |
| 2.2 | `NavigationProfileResolver` + cache | 1 den |
| 2.3 | Napojení AppContext + BrowserPage | 0.5 dne |
| 2.4 | `requireProperty` v TraversalEngine | 0.5 dne |
| 2.5 | Unit testy mapperu (snapshot vs templates.ts) | 1 den |
| 2.6 | seed-demo.sh → 2.3.0 | 0.5 dne |

**Akceptační kritéria:**

- Column browser se chová identicky jako před změnou (3 šablony).
- Test: `mapProfile('itmap-default')` ≡ hardcoded `TEMPLATES`.

### Fáze 3 — Vazba org profilu

**Cíl:** Organizace může přepnout na vlastní profil.

| Krok | Popis | Odhad |
|------|-------|-------|
| 3.1 | Čtení `orgNavigationProfile` z package-root | 0.5 dne |
| 3.2 | Merge logika system + org | 0.5 dne |
| 3.3 | `NavigationProfileService.setOrgProfileLink` | 0.5 dne |
| 3.4 | UI: přehled profilu + připojení / odpojení | 1 den |

**Akceptační kritéria:**

- Org s vlastním profilem vidí upravenou šablonu v Browseru.
- Org bez property používá výchozí.

### Fáze 4 — Editor pravidel

**Cíl:** Plnohodnotná editace bez ručního zápisu do KC.

| Krok | Popis | Odhad |
|------|-------|-------|
| 4.1 | `NavigationConfigPage` — přehled | 1 den |
| 4.2 | Editor stages (CRUD, reorder) | 1.5 dne |
| 4.3 | Editor transitions | 1.5 dne |
| 4.4 | Editor add actions | 1 den |
| 4.5 | Validace + diagnostika | 1 den |
| 4.6 | Styly, i18n labels | 0.5 dne |

**Akceptační kritéria:**

- Uživatel vytvoří novou šablonu, přidá stage a transition, ověří v Browseru.
- Změny jdou přes ChangeSet commit.

### Fáze 5 — Dokončení a úklid

| Krok | Popis |
|------|-------|
| 5.1 | Aktualizovat `koncept-prochazeni-grafem.md` |
| 5.2 | Deprecate hardcoded `TEMPLATES` (ponechat jen fallback) |
| 5.3 | E2E test: seed → browse → edit → browse |
| 5.4 | Volitelně: export/import profilu jako JSON |

**Odhad celkem:** ~12–15 pracovních dní (1 vývojář), Fáze 1 může probíhat paralelně s 2.1–2.2.

---

## 8. Datový příklad: org vlastní profil

```text
Package org-ote (root)
  orgNavigationProfile → https://example.org/org/ote-config/nav-profile-1

Package org-ote-config
  UiNavigationProfile nav-profile-1
    profileCode: org-ote-nav
    parentProfile → ui-profile-itmap-default
    labelCs: OTE — navigace

  UiTraversalTemplate tpl-ote-business
    parentProfile → nav-profile-1
    templateCode: business-exploration    // override systémové šablony
    labelCs: OTE business průchod

  UiStage … (kopie + úpravy sloupců)
  UiTransition …
  UiAddAction …
```

IT Map po merge nabídne `business-exploration` z org profilu, `application-impact` a `infrastructure` ze systémového (dědičnost přes `parentProfile`).

---

## 9. Testování

| Úroveň | Co testovat |
|--------|-------------|
| **Unit** | Mapper: každé pole `Ui*` → `StageDef`/`TransitionDef`/`AddActionDef` |
| **Unit** | Merge: override, dědičnost, prázdný org profil |
| **Unit** | Validátor: neplatný vztah, chybějící stage |
| **Integration** | Resolver proti běžícímu KC s seed bundle |
| **Regression** | Snapshot sloupců pro 3 šablony vs. současný Browser |
| **UI** | CRUD stage → transition → smoke v Browseru |

Testovací data: rozšířit `seed-demo.sh` o volitelný `org-demo-nav` profil s jednou upravenou šablonou.

---

## 10. Rizika a mitigace

| Riziko | Mitigace |
|--------|----------|
| Nekompatibilita verzí IT Map ↔ catalog | `minCatalogVersion`; kontrola při startu |
| Performance (mnoho KC dotazů) | Cache profilu; batch načtení statements podle template ID |
| „Programování v datech“ | Whitelist filtrů; složitá logika v engine |
| Rozbití navigace špatnou konfigurací | Validace + fallback; systémový profil read-only |
| Editace systémového profilu v archimate-lite | UI zakáže editaci `isSystemDefault` |
| Cykly v UI grafu transitions | Povoleny (jako dnes); validátor jen varuje |

---

## 11. Co záměrně není v scope 1. verze

- Lens API (`GET /v1/lenses/itmap-nav/...`) — až po stabilizaci resolveru
- Varianta A (`uiStageGroup` na třídách) — redundantní s plným profilem
- Samostatný package `itmap-ui` — profil zůstává v archimate-lite slovníku
- Grafické drag-and-drop schema editor (místo tabulek)
- Per-user traversal preference (jen per-org)
- Automatický import z `templates.ts` při startu aplikace

---

## 12. Rozhodnutí k potvrzení před startem

| # | Otázka | Doporučení |
|---|--------|------------|
| 1 | Verze archimate-lite | **2.3.0** (UI profil jako additive release) |
| 2 | Název property na Package | **`orgNavigationProfile`** |
| 3 | Merge strategie | **Override dle `templateCode`** + volitelný `parentProfile` |
| 4 | Kde vytvářet org profil | Defaultně **stejný org package**; UI umožní i jiný package |
| 5 | Fallback hardcoded templates | Ponechat do **Fáze 5**, pak jen pro offline dev |
| 6 | `requireProperty` | Implementovat v **Fázi 2** (typ už existuje) |

---

## 13. Stav implementace

| Fáze | Stav |
|------|------|
| 1 — Metamodel + seed (knowledge-core 2.3.0) | ✅ |
| 2 — Resolver + Browser z KC | ✅ |
| 3 — Vazba org profilu | ✅ |
| 4 — Editor pravidel (`/navigation`) | ✅ |
| 5 — Seed, docs, fallback | ✅ |

---

*Dokument navazuje na [`navrh-ui-konfiguracni-vrstvy.md`](navrh-ui-konfiguracni-vrstvy.md) (Varianta B) a rozšiřuje ho o vazbu na org package, merge logiku a konkrétní UI v IT Map.*
