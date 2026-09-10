# Zadání — Výkon načítání hubu Karet (IT Map + KC)

**Status:** implemented (fáze A + B1–B3 + C1–C4)  
**Repo:** `knowledge-itmap` (spotřebitel) + `knowledge-core` (API rozšíření)  
**Kontext:** hub `/cards` dnes generuje velké množství HTTP čtení proti KC (`listEntities` + N× `getStatements` per property).  
**Související:** [component-cards/implementacni-plan-karty-v1.md](./component-cards/implementacni-plan-karty-v1.md), KC `phase-19-graph-api.md`, `phase-22-list-expand-batch-read.md`, `phase-06-lenses.md`

**Není součástí:** přepis Browse / TraversalEngine, zápisové batch API (phase-21), Open Exchange, editace karet.

---

## Implementace (stav)

| Fáze | Stav | Poznámka |
|------|------|----------|
| A1–A6 | hotovo | Cursor stránkování, 0–1 statements / řádek, match-only props, cache invalidate při `reloadSchema`, DEV GET counter |
| B1–B3 | hotovo | KC phase-22: list include, facets, batch-read |
| B4 | odloženo | Lens instances list |
| C1–C2 | hotovo | Hub volá `include=effectiveClasses[,statements]` + fallback na A1 |
| C3 | hotovo | `total` + type chip counts z `GET /v1/entities/facets` |
| C4 | hotovo | `batch-read` pro `resolveEntityLabels`, slot/expert neighbors |

---

## Problém (stav dříve)

`CardsHub` volá `CardsService.listBrowsableEntities` + `listQuickFilterTypes`.

`listBrowsableEntities`:

1. načte všechny presentation profily (`CardsProfileLoader.loadAllProfiles`);
2. **projede celý org package** přes `GET /v1/entities` (limit 200 + cursor), bez ohledu na UI stránku 50;
3. pro **každou** entitu:
   - `resolveClassLocal` → při chybějícím `effectiveClasses` ještě `GET …/statements`;
   - `readInterestingProps` → pro každou match/field property zvlášť `GET …/statements?property=…` (N×M).

UI hubu přitom zobrazuje jen **název, profil, typ**. Profil potřebuje typicky jen `matchProperties` (např. `actorKind`), ne `fieldProperties`.

Stránkování v UI je čistě klientské — **nesnižuje** počet KC volání.

### Odhad nákladů (řádově)

| Entit v package | Match keys / entita | Requesty (hub, bez profilů) |
|-----------------|---------------------|-----------------------------|
| 200 | 2–3 | ~1 list + 400–800 statements |
| 1000 | 2–3 | ~5 list + 2000–3000 statements |

Plus jednorázové načtení profilů/slotů z `archimate-ui-cards`.

---

## Cíl

1. **IT Map (fáze A):** hub načítá stránku s řádově **O(stránky)** requestů, ne O(celý package × properties). Bez čekání na nové KC API, pokud stačí stávající endpointy.
2. **KC (fáze B):** API, které umožní list/facet/batch čtení tak, aby IT Map (a další klienti) nemuseli skládat N+1 statements.
3. Zachovat sémantiku hubu: filtry typu z profilů, vyhledávání podle názvu, stránkování, resolve presentation profilu.

---

## Mimochodem: lenses a shapes

| Mechanismus | Pomůže hubu? | Poznámka |
|-------------|--------------|----------|
| **Shapes** | Ne | Validační profily (required / closed). Nejsou read projection. |
| **Lenses** (dnes) | Spíš ne | Read je per instance `GET /v1/lenses/{code}/instances/{key}` — bez listu by hub dělal opět N requestů. |
| **Lenses list** (návrh B3) | Ano, volitelně | Až existuje list instances s field mapou + package filter. |
| **Search projection** | Jen pro fulltext | Neřeší typ/facet ani match properties pro profily. |

Shapes do tohoto zadání **nevstupují**. Lenses jen jako volitelná KC položka B3.

---

## Fáze A — IT Map (nezávislé na novém KC)

Implementace **může začít ihned**. Preferovat malé, testovatelné změny v `CardsService` + `CardsPage`.

### A1 — Jedno čtení statements na entitu (nebo nula)

**Dnes:** `readStringProp` × počet keys.

**Cíl:**

- Preferovat `entity.effectiveClasses` pro `classLocal` (žádný request).
- Pokud chybí, **jednou** `getStatements(entity.id)` a z toho:
  - `instanceOf` → classLocal,
  - hodnoty `matchProperties` (a jen jich).
- Odstranit per-property smyčku v cestě hubu.

Detail karty (`loadCard`) může zůstat; ideálně sdílet helper „statements → prop map“, ale hub nesmí volat `readInterestingProps` s field properties.

### A2 — Hub načítá jen data potřebná pro resolve profilu

- Do `resolvePresentationProfile` předávat **pouze** `matchProperties` (+ případně vždy `actorKind` / `organizationScope`, pokud jsou v matchech).
- **Nenačítat** `fieldProperties` v hub listu.
- Pokud pro `classLocal` existuje jen kandidát(i) **bez** `matchProperties` (prázdný match), **nevolat** statements vůbec — profil = default podle třídy.

### A3 — Serverové / cursor stránkování místo full scanu

**Dnes:** `CardsPage` bere `result.items` jako celý seznam a slice na 50.

**Cíl:**

- `listBrowsableEntities` respektuje `page` + `pageSize` (nebo `cursor` + `limit`) a **neprochází** celý package, když to není nutné.
- UI: Předchozí / Další volá service s novou stránkou; `total` / pageCount:
  - **A3a (MVP):** `total` unknown nebo `hasMore` z `nextCursor` (UI „Další“ bez „X z Y“), nebo
  - **A3b:** po dodání KC B2 použít facet/count.
- Filtrování browsable typů (vyřadit relace, views, Ui*, …):
  - při aktivním type chipu už jde `instanceOf` na KC (ponechat);
  - bez type filtru: buď přijmout, že stránka může obsahovat i ne-browsable (a přeskočit je s doplněním dalšího list chunku), nebo filtrovat client-side jen v rámci načtené stránky s jasným UX (preferovat doplňování ze stejného cursoru, dokud není `pageSize` browsable řádků).

Klientské řazení celého package (`localeCompare` over all) po A3 **nelze** zachovat beze změny — přijatelné:

- řazení v rámci stránky, nebo
- spoléhat na pořadí KC listu, nebo
- později KC sort param (mimo MVP).

### A4 — Quick filters bez druhého full scanu

`listQuickFilterTypes` už bere typy z presentation profilů (OK) — **nesmí** spouštět scan entit.

Facety s **počty** (`typeFacets` v `CardsHubPage`):

- do A/B2: buď counts vynechat, nebo counts jen z aktuálně načtené stránky (označit jako neúplné), nebo counts nenačítat vůbec (chip = jen typ bez čísla — odpovídá dnešnímu UI chipů bez count).

### A5 — Cache profilů

- `getCardsProfileLoader()` singleton + `profilesCache` ponechat.
- Hub nesmí při každém type-chip kliku znovu invalidate cache.
- Po importu `archimate-ui-cards` / změně schema volat `clearCache()` / `resetCardsProfileLoader()` (pokud už existuje hook — napojit; jinak dokumentovat).

### A6 — Telemetrie / ověření (dev)

Dočasně nebo za flag logovat počet KC GET během jednoho `load()` hubu (list + statements). Acceptance měří pokles.

### Změny v kódu (IT Map)

| Oblast | Úkol |
|--------|------|
| `src/domain/cards/cardsService.ts` | A1–A4: hub path bez N×M; stránkování; hub-only match props |
| `src/pages/CardsPage.tsx` | A3: page state → service; `hasMore` / total UX |
| `src/domain/cards/profileLoader.ts` | A5: invalidate body (pokud chybí) |
| Unit testy | Resolve class + match z jedné statements maps; skip statements když no-match profiles; page size |

### Akceptace (IT Map — fáze A)

| ID | Scénář | Očekávání |
|----|--------|-----------|
| A-I1 | Hub, package ~200 browsable entit, bez type filtru | Počet HTTP read ≪ dnešek; typicky ≤ ~1–N list stránek + ≤ 1 statements / zobrazená entita (nebo 0 při effectiveClasses + no-match) |
| A-I2 | Type chip (např. `ApplicationComponent`) | `listEntities` s `instanceOf`; žádný full package scan |
| A-I3 | Stránkování | Druhá stránka = nový list request; **ne** dočítání celého package napřed |
| A-I4 | Profil s `matchProperties` | Správný `labelCs` profilu jako dnes |
| A-I5 | Třída jen s default profilem (prázdný match) | Žádné statements jen kvůli profilu |
| A-I6 | Detail karty | Chování fields/slotů beze změny sémantiky |

### Odhad (IT Map A)

| Úkol | Odhad |
|------|-------|
| A1+A2 service | 0.5–1 den |
| A3+A4 UI stránkování | 0.5–1 den |
| Testy + docs | 0.5 dne |
| **Celkem A** | **~1.5–2.5 dne** |

---

## Fáze B — Knowledge Core (zadání pro sibling repo)

IT Map dokumentuje **požadavky na API**. Samotná implementace patří do `knowledge-core` (nová phase / rozšíření phase-19). Po hotovém KC se IT Map napojí (fáze C níže).

### B1 — Expand / include na `listEntities`

Rozšířit `GET /v1/entities`:

| Parametr (návrh) | Význam |
|------------------|--------|
| `include=effectiveClasses` | Garantovat `effectiveClasses` v každé položce listu (pokud ještě není vždy) |
| `include=statements` | Volitelně přiložit statements subjektu (limit / whitelist properties) |
| `properties=P1,P2` nebo local names dle schema-config | Omezit statements na vybrané properties (pro hub: match keys) |

**Alternativa menšího rozsahu:** jen spolehlivé `effectiveClasses` + `instanceOf` summary v list item — hub pak často nepotřebuje statements vůbec, pokud match props řeší B1 statements whitelist nebo B2.

Response (návrh položky):

```json
{
  "id": "Q…",
  "labels": { "cs": "…" },
  "effectiveClasses": ["C…"],
  "statements": [
    { "property": "P…", "value": { "type": "String", "string": "person" } }
  ]
}
```

**Akceptace KC B1:** list 50 entit s `include=statements&properties=…` = **1 HTTP**, klient získá typ + match props bez follow-up GET.

### B2 — Facet / count podle `instanceOf`

Endpoint nebo rozšíření listu, např.:

```http
GET /v1/entities/facets?package=org&groupBy=instanceOf&includeSubclasses=true
```

nebo

```http
GET /v1/entities?package=org&facet=instanceOf&limit=0
```

Výstup: `{ "facets": [ { "classId": "C…", "count": 42 }, … ] }`.

Účel: quick filters s počty a `total` pro stránkování **bez** full downloadu.

**Akceptace KC B2:** facet call O(1) HTTP; counts odpovídají `listEntities?instanceOf=` cardinality (shoda na fixture).

### B3 — Batch read entit / statements (volitelné, vysoká hodnota)

```http
POST /v1/entities/batch-read
{ "ids": ["Q1","Q2",…], "include": ["statements"], "properties": ["P…"] }
```

Limit např. 100–200 ids / request. Použití: detail slotů, resolve labelů, Browse — nejen hub.

**Akceptace KC B3:** 100 id → 1 request; chybějící id explicitně v results (ne 404 celé dávky).

### B4 — List lens instances (volitelné, později)

```http
GET /v1/lenses/{code}/instances?package=&cursor=&limit=
```

Vrací domain field mapu pro instance selektoru lens. Hub by mohl mít lens „cardHubRow“ — **není MVP**; až po B1/B2, pokud produkt chce domain API místo Q/P.

Shapes do B **nevstupují**.

### Dokumentace KC (očekávané artefakty)

| Artefakt | Obsah |
|----------|--------|
| `docs/specs/phase-XX-list-expand-batch-read.md` (název dle roadmapy) | Scope B1–B3, acceptance |
| `docs/integration/api-contract.md` | Query parametry + příklady |
| Acceptance testy | Analogie A3 / graph_api_test |

### Odhad (KC B) — hrubý

| Položka | Odhad |
|---------|-------|
| B1 include statements whitelist | 1–2 dny |
| B2 facets | 1–2 dny |
| B3 batch-read | 1–2 dny |
| B4 lens list | 2+ dny (odložit) |

---

## Fáze C — Napojení IT Map na nové KC API

Až B1 (ideálně B2) bude v KC:

| Úkol | Popis |
|------|--------|
| C1 | `KcClient.listEntities` + typy pro `include` / embedded statements |
| C2 | Hub: jedna list page s embedded match props → **0** follow-up statements |
| C3 | `total` + type counts z B2 |
| C4 | Volitelně batch-read pro `resolveEntityLabels` / slot neighbors |

**Závislost:** fáze A má smysl i bez C; C je zjednodušení A a další pokles latency.

---

## Pořadí implementace

```text
1. Fáze A (IT Map)          ← začít zde; bez KC změny
2. Fáze B1 (+ B2) v KC      ← paralelní / následně
3. Fáze C (IT Map napojení)
4. B3 / B4 dle potřeby
```

---

## Rizika

| Riziko | Mitigace |
|--------|----------|
| Bez globálního sortu se změní pořadí hubu | Dokumentovat; případně sort jen aktuální stránky |
| Client-side filter browsable typů „díry“ ve stránce | Doplňovat z cursoru do naplnění `pageSize` |
| `effectiveClasses` nekonzistentní napříč KC verzemi | A1 fallback na statements; B1 garance |
| Embed všech statements v listu = velké payloady | Whitelist `properties=` povinný při `include=statements` |
| Duplicitní logika profilů vs budoucí lens | Lens B4 jen pokud produkt chce domain API; presentation profiles zůstanou source of truth pro Karty v1 |

---

## Mimo scope

- Optimalizace `loadCard` / slot neighbor N+1 (samostatné zadání; může využít B3)
- Optimalizace Browse / TraversalEngine
- Změna datového modelu `PresentationProfile`
- Shapes jako read API
- GraphQL-only řešení hubu

---

## Reference v kódu (výchozí bod)

| Soubor | Role |
|--------|------|
| `src/pages/CardsPage.tsx` | Hub UI, klientské PAGE_SIZE=50 |
| `src/domain/cards/cardsService.ts` | `listBrowsableEntities`, `readInterestingProps`, `resolveClassLocal` |
| `src/domain/cards/profileLoader.ts` | Cache profilů |
| `src/domain/cards/profileResolver.ts` | Match na `matchProperties` |
| `src/kc/client.ts` | `listEntities`, `getStatements` |
