# Zadání — MCP reclassify + shape / schema-config (fáze po graph-mutations)

**Status:** implemented  
**Repo:** `knowledge-itmap`  
**Závisí na:** Knowledge Core `/v1` (statements revise/create/deprecate, `GET /v1/admin/schema-config`, entity validation findings), [`zadani-mcp-graph-mutations.md`](./zadani-mcp-graph-mutations.md) (**implemented**), `@itmap/archimate-core` (`graphMutations`, `schema`, `kcClient`, `classConstraints`)  
**Související:** [`../server/README.md`](../server/README.md), primer AS→AC, remediace org-ote F1–F10 (archi-ai-workspace)

**Není součástí:** auto-deprecate neplatných vztahů (`onInvalidRelations`), KC shape authoring, hard delete, OE `pushInstanceOf`, změna default `X-Validation-Mode` na relaxed/off pro běžné zápisy.

---

## Cíl

Umožnit agentům **čistě přes MCP** (bez curl / workaround skriptů) provádět typed reclassify u shaped tříd — zejména `BusinessFunction` → `BusinessActor` s povinnými `actorKind` + `organizationScope` — při zachování identity a `strict` validaci KC.

Konkrétně:

1. `instanceOf` property IRI brát **výhradně** z KC schema-config.
2. `reclassify_*` měnit typ přes **revise** (ne deprecate+create, pokud už instanceOf existuje).
3. V tomtéž kroku zapsat **required props** cílové třídy.
4. Exponovat shape constraints agentovi (`get_class_constraints` + odkaz z usage).
5. Vracet plné KC `validation.findings`, ne jen `errors: N`.
6. Zlepšit batch dryRun (peer projection); **bez** auto-úprav vztahů.

---

## Motivace (zjištění z běhu org-ote CS01)

| # | Problém | Důsledek |
|---|---------|----------|
| 1 | `reclassify_*` dělá deprecate + create `instanceOf` | KC `strict` padá na `shape_required_missing` (Actor bez props) — typicky `errors: 2` |
| 2 | Chicken-and-egg | `actorKind` nejde nastavit na Function; Actor nejde create bez props |
| 3 | Revise existujícího `kc-base/instanceOf` funguje | Po revise lze props doplnit; MCP tuto cestu nepoužívá |
| 4 | Diagnostika `list_statements(instanceOf)` | Často prázdný výsledek / model property neviditelná — agent tipuje špatně |
| 5 | MCP chyby | Jen summary count, bez `findings[]` (`code`, `propertyId`, `message`) |
| 6 | Batch dryRun | Peer ve stejném batchi ještě jako stará třída → false alarm (Association odbor↔odbor) |

Skutečné IRI typing property v KC: `GET /v1/admin/schema-config` → `instanceOfProperty` (= `https://knowledge-core.local/kc-base/instanceOf`). **Neskládat** `…/archimate-lite/instanceOf`.

---

## Rozhodnutí

| # | Téma | Volba |
|---|------|--------|
| 1 | Zápis `instanceOf` | **Preferovat `reviseStatement`** při právě jednom aktivním; `create` jen když žádný aktivní není; pokud >1 aktivní → deprecate extras + revise/create na jeden |
| 2 | Shape API | Nový tool **`get_class_constraints`** + krátký odkaz / pole v `get_usage_guidance` |
| 3 | Props u reclassify | Param **`props`** (string map); dryRun hlásí chybějící required; execute **fail** bez nich (u shaped cíle) |
| 4 | Vztahy | Jen lepší dryRun report + **peer projection** v batchi; **žádné** `onInvalidRelations` / auto-deprecate (oddělená fáze) |
| 5 | Validace zápisu | Zůstat u `X-Validation-Mode: strict`; neobcházet shape přes `off`/`relaxed` v produkčním reclassify |
| 6 | Dokumentace | Tento soubor + krátká **Fáze 5** v [`zadani-mcp-graph-mutations.md`](./zadani-mcp-graph-mutations.md) |

Supersede (částečně) rozhodnutí #1 a #8 v graph-mutations zadání: replace přes revise (ne jen deprecate+create); shape props jsou součástí reclassify, nejen relation projekce.

---

## Navrhovaný MCP / core surface

### A) Schema — `instanceOfProperty` ze schema-config

Při `ensureSchemaLoaded` / `SchemaResolver.load`:

1. Vždy `GET /v1/admin/schema-config` (už dnes `kc.getSchemaConfig()`).
2. `snapshot.instanceOfProperty = config.instanceOfProperty` — **jediný** zdroj pravdy.
3. Ověřit, že property entita v KC existuje (GET entity / list); při fail hard error s textem config IRI.
4. Logovat při startu/load: `instanceOfProperty=<iri>`.
5. Zakázat fallback na `propertyIri("instanceOf")` z libovolného balíku, pokud by se lišil od config.

Spotřebitelé (musí používat jen `snapshot.instanceOfProperty`):

- `listActiveInstanceOf` / `list_statements` při `propertyLocal=instanceOf`
- `reclassifyEntity` / `updateRelationship` (type change)
- `create_statement` / `createTypedStatement` pro `instanceOf`
- `clear_property` / `deprecate` instanceOf

**`list_statements`:** při filtru `instanceOf` musí vracet aktivní statement(y) z config IRI. Unfiltered list: buď zahrnout model properties, nebo v docs/tool description explicitně říct, že `instanceOf` je jen přes filtr / `get_class` — preferovat **vracet je i v unfiltered**, pokud KC API dovolí; jinak dokumentovat + vždy filtrovat přes config IRI.

### B) `get_class_constraints` (nový read tool)

| Vstup | Význam |
|-------|--------|
| `classLocal` | např. `BusinessActor` |

| Výstup | Význam |
|--------|--------|
| `classLocal`, `classId` | identifikace |
| `requiredProperties[]` | `{ propertyLocal, propertyId, valueKinds?, enums? }` — z KC shape / validation metadata |
| `recommendedProperties[]` | volitelné (pokud KC nerozlišuje, prázdné) |
| `source` | odkud data (např. shape code `aml-business-actor`) |

Zdroj dat (priorita):

1. KC endpoint pro shape/constraints, **pokud existuje** (ověřit při implementaci).
2. Jinak: odvození z známých shape findings / schema snapshot enums + dokumentovaná tabulka v core pro AML shaped classes (`BusinessActor` → `actorKind`, `organizationScope`) s TODO na KC API.
3. Nesmí hardcodovat IRI `instanceOf` — jen class/property locals přes SchemaResolver.

`get_usage_guidance(classLocal)`: doplnit pole `constraintsRef` nebo zkrácený `requiredProperties[]` (stejný zdroj jako constraints tool), aby agent nemusel hádat.

### C) `reclassify_entity` / `reclassify_entities` — úpravy

#### Nové / rozšířené vstupy

| Parametr | Význam |
|----------|--------|
| `props?` | `Record<string,string>` — upsert string props ve **stejném** logical CS jako změna typu |
| stávající | `dryRun`, `strictRelations`, `ids` / `fromClassLocal`, `newClassLocal` |

#### Algoritmus zápisu `instanceOf` (execute)

```text
1. Načíst aktivní statements property = snapshot.instanceOfProperty
2. Pokud 0: createStatement(EntityRef → newClass)
3. Pokud 1: reviseStatement(value → newClass)
4. Pokud >1: deprecate všechny kromě jednoho (nebo všechny) + revise/create tak, aby zůstal právě jeden
5. Upsert props (replaceStringProperty / setProperty) pro klíče z `props`
6. Assert: právě jeden aktivní instanceOf; třída = newClassLocal
```

Vše v `runLogicalChangeSet` (jeden CS z pohledu MCP session).

#### dryRun rozšíření

Per-entity výstup doplnit:

| Pole | Význam |
|------|--------|
| `writeMode` | `revise` \| `create` \| `normalize-multi` |
| `missingRequiredProps[]` | required z `get_class_constraints(newClass)` minus `props` minus už nastavené na entitě |
| `invalidRelationships[]` | stávající + **peer projection** (viz D) |
| `ok` | false pokud `strictRelations=fail` a invalid rels, **nebo** chybí required props |

Execute: pokud `missingRequiredProps.length > 0` → **nezapisovat** tuto entitu (batch: fail celý batch nebo skip s error per entity — **volba: fail celý batch** u `reclassify_entities`, konzistentně se `strictRelations=fail`).

#### `apply_operations` op `reclassifyEntity`

Rozšířit o `props?: Record<string,string>` se stejnou sémantikou.

### D) Relation dryRun — peer projection (bez mutace)

Při `reclassify_entities` dryRun/execute preview:

- Postavit mapu `id → newClassLocal` pro všechny entity v batchi.
- Při projekci incidentního vztahu: pokud druhý konec je v mapě, použít **cílovou** třídu peera, ne aktuální KC class.
- False alarm typu Association Function→Actor mezi dvěma odbory ve stejném batchi zmizí.

**Mimo scope:** `onInvalidRelations: deprecate` — agent dál volá `deprecate_entity` / `update_relationship` sám (CS06/CS07).

### E) Chybové hlášky KC

`KcError` / tool wrapper:

- Při HTTP 422 s tělem `validation.findings` vrátit do MCP result / error message strukturovaně:
  - `validation: { summary, findings: [{ severity, code, message, propertyId?, classId?, shapeCode? }] }`
- Nejen `validation failed: {"errors":2,…}`.

Týká se `reclassify_*`, `create_statement`, `set_property`, `apply_operations`.

---

## Primer / agent guidance (aktualizace)

Po implementaci upravit primer / `get_usage_guidance` text:

```text
1. get_class_constraints(newClassLocal) → required props
2. reclassify_*(…, dryRun=true, props=…) → missingRequiredProps + invalidRelationships (peers projected)
3. Doplnit props / vyřešit vztahy (deprecate / update_relationship) dle reportu
4. reclassify_*(…, dryRun=false, strictRelations=warn|fail, props=…)
5. commit_changeset(confirm_commit=true)
```

BusinessActor příklad props: `actorKind=organizationalUnit|organization|person`, `organizationScope=internal|external`.

---

## Fázování implementace

| Fáze | Obsah | Hotovo když |
|------|--------|-------------|
| **5a** | Schema-config assert + `list_statements`/`listActiveInstanceOf` jen přes config IRI | MCP list instanceOf vidí `kc-base/instanceOf`; log IRI při load — **done** |
| **5b** | reclassify = revise path + `props` + missingRequired v dryRun | Function→Actor s props projde strict bez curl — **done** |
| **5c** | `get_class_constraints` + usage_guidance odkaz | Agent zjistí required bez domněnek — **done** |
| **5d** | Peer projection + plné validation findings | Batch Association false alarm pryč; 422 čitelné — **done** |
| **5e** | Smoke + docs | `mcp:smoke` Actor reclassify s props; README + status **implemented** — **done** |

Doménová logika v `@itmap/archimate-core`; MCP handlery jen orchestrace.

---

## Acceptance criteria

1. `snapshot.instanceOfProperty` === `GET /v1/admin/schema-config`.instanceOfProperty; žádný zápis na jiné IRI.
2. Entity s jedním aktivním instanceOf: reclassify použije **revise**; po zápisu právě jeden aktivní instanceOf; `id`/`iriLocal` beze změny.
3. `reclassify_entity` na BusinessFunction→BusinessActor s `props: { actorKind, organizationScope }` projde při `X-Validation-Mode: strict`.
4. dryRun bez props u Actor cíle: `ok=false`, `missingRequiredProps` obsahuje obě properties; žádný zápis.
5. `get_class_constraints("BusinessActor")` vrací alespoň `actorKind`, `organizationScope`.
6. `get_usage_guidance("BusinessActor")` odkazuje / uvádí required props.
7. Batch dryRun dvou entit spojených Association: po peer projection Association **není** v invalidRelationships (pokud Actor↔Actor allowed).
8. MCP error při shape fail obsahuje `findings[].code` (např. `shape_required_missing`) a `propertyId`.
9. Smoke: create typed element → reclassify na shaped class s props → list instanceOf (1×) → commit/cancel dle režimu.

---

## Testovací plán

- **Unit:** revise vs create větev; multi instanceOf normalize; missingRequiredProps; peer projection mapa.
- **Unit:** schema load fail když config IRI neexistuje.
- **Live smoke:** BusinessService/ApplicationService→Component (bez extra props pokud shape nevyžaduje) + Function→Actor s props (lab/`org-demo`).
- **Regrese:** stávající smoke create→reclassify AS→AC stále pass.

---

## Rizika

| Riziko | Mitigace |
|--------|----------|
| KC nemá public shape API | Dočasná tabulka required props v core + issue na KC; tool kontrakt stabilní |
| Revise nevaliduje shape stejně jako create | Po revise vždy upsert required props ve stejném CS; smoke na Actor |
| Dual instanceOf při partial fail | Assert + cancel CS; normalize-multi větev |
| Agent nepošle props | dryRun fail jasně; usage_guidance |
| Peer projection skryje skutečně neplatný vztah | Projection jen pro id v aktuálním batchi; ostatní peery z KC |

---

## Mimorozsah (explicitně)

- `onInvalidRelations: report \| deprecate`
- Dočasné `validation=off/relaxed` jako default reclassify
- Oprava dat poškozených debug během (C49, Energetické trhy) — provozní cleanup, ne MCP feature
- OE / dual-instanceOf z importu
- Hard delete

---

## Dokumentace k dodání

- [x] `docs/zadani-mcp-reclassify-shape.md` (tento dokument)
- [x] Fáze 5 + odkaz v [`zadani-mcp-graph-mutations.md`](./zadani-mcp-graph-mutations.md)
- [x] Odkaz v [`server/README.md`](../server/README.md)
- [x] Po implementaci: primer, smoke, status → **implemented**
