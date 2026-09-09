# Zadání — Open Exchange import přes batch API (IT Map)

**Status:** implemented (IT Map side)  
**Repo:** `knowledge-itmap`  
**Závisí na:** Knowledge Core [`phase-21-unified-batch-writes.md`](../../knowledge-core/docs/specs/phase-21-unified-batch-writes.md) (sibling repo vedle `knowledge-itmap`).

**Není součástí:** export XML, orphan review UI (ponechat; orphan apply může zůstat per-op nebo později batch).

---

## Cíl

Přepsat **Open Exchange import** tak, aby místo tisíců jednotlivých HTTP zápisů používal **davkové** `POST /v1/changesets` do **jednoho open ChangeSetu** (chunky), v souladu s KC fází 21.

Zachovat:

- jeden logický import = jeden open CS (`openExchangeImport`) → commit na konci;
- identity (`iriLocal`, alias `imported`);
- relaxed validation;
- progress UI (po chunkách / po logických objektech);
- orphan review po importu.

---

## Předpoklady (KC must-have)

Implementace IT Map **nesmí začít dřív**, než KC splní:

| Požadavek | KC acceptance |
|-----------|----------------|
| Open CS + `POST /v1/changesets` appenduje overlay | B5 |
| Op `setEntityIRIAliases` | B1/B2 |
| `clientKey` remapping v rámci dávky | B8 |
| Limit ≥ 500 ops / request | B6 |
| Commit ordering entity→statement | B10 |

Do té doby lze připravit typování ops a builder offline, ale ne mergovat produkční import.

---

## Cílové chování importu

```text
openChangeSet
for each chunk of ~200–400 operations:
  POST /v1/changesets  + X-Knowledge-Changeset
    body: { operationType, comment?, operations: [...] }
commitChangeSet
orphan reconciliation (stávající)
```

### Mapování XML → ops (stejná sémantika jako dnešní `sync.ts`)

Pro každý element / relationship / view / node / connection sestavit ops:

1. `createEntity` **nebo** `updateEntity` (podle `existingByLocal`) — `clientKey` = Exchange `identifier` (např. `$id-76f6…` nebo stabilní `$el:{identifier}`)
2. `createStatement` `instanceOf` → class IRI (`upsert: true`)
3. Další `createStatement` (modelingDepth, exchangeXsiType, opaque, relSource/Target, inView, bounds, …) s `upsert: true`
4. `setEntityIRIAliases` na entitu (`entity: "$…"`, aliases včetně `imported`)

Pořadí **uvnitř chunku:** nejdřív všechny `createEntity`/`updateEntity` (+ aliases) pro objekty v chunku, pak statementy, které na ně odkazují. Cross-chunk reference: používat už známé **veřejné IRI** z předchozích chunků (mapa `identifier → publicId` z `results`).

### Chunkování

| Parametr | Doporučení |
|----------|------------|
| Cílová velikost chunku | **250 ops** (konfigurovatelné konstantou) |
| Hard strop | ≤ KC limit (500) — nikdy nepřekročit |
| Progress | `onProgress(chunkIndex, chunkCount)` + volitelně odhad objektů |

Pokud by jeden logický objekt generoval > limit ops (nepravděpodobné), split statements do následujícího chunku se stejným subject IRI.

### Chyby

- Fail chunku → `cancel` open CS (jako dnešní `runLogicalChangeSet` catch) + srozumitelná chyba (`formatAppError`, ideálně `opIndex` z KC).
- Nemíchat committed batch (bez open headeru) pro hlavní import — musí jít do open CS kvůli atomickému cancel.

---

## Změny v kódu (IT Map)

| Oblast | Úkol |
|--------|------|
| `src/kc/client.ts` | `applyChangeSetOps(ops, meta)` → `POST /v1/changesets` s `cs: "write"`; typy pro ops včetně `setEntityIRIAliases` |
| `src/domain/openExchange/sync.ts` | Builder ops + chunk loop; odstranit per-item `createEntity`/`createStatement`/`setEntityIriAliases` smyčku |
| `src/domain/openExchange/*` | Pomocné `buildElementOps`, `buildRelationshipOps`, … (čisté funkce, snadno testovatelné) |
| `src/kc/errors.ts` | Hint pro `batch_limit_exceeded` / `opIndex` |
| Unit testy | Builder: N elementů → očekávaný počet/typ ops; chunk split |
| `docs/open-exchange.md` | Popis batch + chunk; závislost na KC phase-21 |

### Klientské API (návrh)

```ts
kc.applyChangeSetOperations({
  operationType: "openExchangeImport",
  comment?: string,
  operations: ChangeOperation[],
}): Promise<WriteResponse<{ results: OpResult[] }>>
// používá aktivní write CS (runLogicalChangeSet / autoChangeSetId)
```

`runLogicalChangeSet` zůstane: open → fn (uvnitř chunkované batche) → commit.

### Co neměnit bez důvodu

- Orphan review flow
- Export
- Packages UI layout (jen progress text může říkat „chunk 3/12“)

---

## Dokumentace (IT Map)

| Dokument | Úprava |
|----------|--------|
| [docs/open-exchange.md](open-exchange.md) | Import = open CS + batch chunky; předpoklad KC ≥ phase-21 |
| README (pokud zmiňuje import výkon) | Krátká poznámka o batch |

---

## Akceptace (IT Map)

| ID | Scénář | Očekávání |
|----|--------|-----------|
| I1 | Import malého XML (&lt; 50 objektů) | 1 open CS, ≤ pár batch requestů, commit OK, aliasy + instanceOf přítomné |
| I2 | Import ~O(10³) objektů (např. OTE fixture) | Počet HTTP write ≪ počet objektů (řádově #chunků + open/commit); dokončení bez 404 na commit |
| I3 | Fail uprostřed (simulovaný 4xx) | CS cancelled; žádný částečný committed import |
| I4 | Reimport + orphan review | Stávající chování |
| I5 | Unit: builder idempotentních upsert statementů | Stabilní ops shape |
| I6 | Progress | UI ukazuje postup (chunky nebo objekty) |

---

## Odhad

| Úkol | Odhad |
|------|-------|
| KC client + typy | 0.5 dne |
| Ops builder + chunking v `sync.ts` | 1–2 dny |
| Testy + docs | 0.5–1 den |
| **Celkem IT Map** (po hotovém KC) | **~2–3 dny** |

---

## Rizika

- **Cross-chunk `clientKey`:** `$…` platí jen v jedné dávce — nutné mapovat results → publicId před dalším chunkem.
- **Velikost JSON** u opaque properties — hlídat 4 MiB; případně menší chunk.
- **Parita s dnešním importem** — srovnávací test na stejném XML (počty entit, sample aliasů).

---

## Mimo scope

- Paralelní chunky (zachovat sériové chunky kvůli mapě ID a jednoduchosti cancel)
- Přepis celého IT Map na batch-only (jen Open Exchange import + společný `applyChangeSetOperations` helper)
- Server-side XML upload do KC
