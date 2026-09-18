# Zadání — MCP mutace grafu a statements (čištění modelu)

**Status:** implemented  
**Repo:** `knowledge-itmap`  
**Závisí na:** Knowledge Core `/v1` (ChangeSet, statements, deprecate), [`zadani-mcp-archimate.md`](./zadani-mcp-archimate.md), [`adr-mcp-multipackage-session.md`](./adr-mcp-multipackage-session.md), `@itmap/archimate-core` (`modelService` / `graphMutations`: `reclassifyEntity`, `replacePropertyValue`, `saveEntityBasics`, …)  
**Související:** [`../server/README.md`](../server/README.md), OE batch import [`zadani-open-exchange-batch-import.md`](./zadani-open-exchange-batch-import.md)

**Není součástí:** KC admin surface (classes, properties metamodel, shapes authoring, RDF, policies, lenses, GraphQL), hard delete entity/statement, multi-CS paralelismus v jedné MCP session, přepis OE importu / oprava `pushInstanceOf` (oddělené zadání).

---

## Cíl

Umožnit agentům **čistit a opravovat** architektonický model v Knowledge Core **bez Open Exchange** — zejména změnu typu elementu **při zachování identity** (`id` / `iriLocal` / view `elementRef`) a základní mutace entity/statement v jednom open ChangeSetu.

Primární vzor (např. čištění `org-ote` bod 1):

1. `reclassify` entity (např. ApplicationService → ApplicationComponent) se **stejným `id`/`iriLocal`** (views zůstanou napojené).
2. Případně přidat companion entity (behaviorální ApplicationService) + `Realization`.
3. Přepojit / upravit vztahy (`Serving` source/target, případně typ Serving → Flow).
4. Přejmenovat / nastavit labels + description.
5. Deprecate jen entity, které se skutečně nahrazují **novým** id (ne při čistém reclassify).
6. Replace typu vždy přes **deprecate `instanceOf` + create** nového EntityRef (ne OE upsert).
7. Vše v jednom open ChangeSetu (`propose`, bez auto-commit).

Sekundární cíl: tenká vrstva obecných graph primitiv (entity + statement), ne plný KC admin.

---

## Motivace (proč ne OE)

OE import používá `instanceOf` s `upsert: true`, které v praxi **přidává** statement a ne vždy bezpečně nahrazuje — riziko **dual `instanceOf`**, velké ChangeSety, konflikty s manuálním CS a timeouty MCP.

Pro reclassify / cleanup:

- **Nepoužívat** `import_open_exchange` k změně typu.
- Použít `reclassify_entity` / `reclassify_entities` (nebo složené primitiva).
- OE zůstává pro bulk identity-preserving sync modelů, ne pro typové migrace.

---

## Rozhodnutí

| # | Téma | Volba |
|---|------|--------|
| 1 | Replace `instanceOf` | ~~Deprecate + create~~ → **Fáze 5:** preferovat `reviseStatement`; viz [`zadani-mcp-reclassify-shape.md`](./zadani-mcp-reclassify-shape.md) |
| 2 | Hard delete | Ne; jen deprecate entity / statement |
| 3 | Generic vs ArchiMate | Obecná primitiva + tenké ArchiMate helpery; žádný create class/property/RDF/policies |
| 4 | Hodnoty statementů v1 | `String`, `EntityReference`, `Boolean` (props + `instanceOf` + flags) |
| 5 | Batch | Ano — `apply_operations` append do active CS |
| 6 | High-level migrate | Zobecněný `reclassify_entities` (batch, **zachová id/iriLocal**); app-specific „split“ jen jako recept ze skládání primitiv |
| 7 | OE | Mimo scope opravy dual-instanceOf; v dokumentaci: „nepoužívat OE k reclassify“ |
| 8 | Validace | Zachovat `X-Validation-Mode: strict`; u reclassify explicitní projekce na `AllowedRelationship` |

---

## Navrhovaný MCP surface

### A) ChangeSet hygiena

| Tool | Popis |
|------|--------|
| `get_changeset` | Aktivní nebo dle `id`: status, itemCount, comment, package |
| `list_changesets` | Filtr alespoň `status=open` (volitelně package) |

Úpravy stávajícího chování:

- Po `cancel_changeset` **vždy** clear `activeChangeSetId` v MCP session.
- Pokud KC hlásí, že CS je cancelled / neexistuje (stale session id), **auto-clear** session a vrátit srozumitelnou chybu (ne UI reject bez stavu).

### B) Entity

| Tool | Popis |
|------|--------|
| `create_entity` | `packageCode?`, `classLocal`, `name` (labels cs/en), volitelné `description`, `iriLocal`, `props` (string map). |
| `update_entity` | Labels / descriptions přes `saveEntityBasics` / `patchEntity`. |
| `deprecate_entity` | Už existuje — sjednotit dokumentaci s novými tools. |

### C) Statements

| Tool | Popis |
|------|--------|
| `create_statement` | `subjectId`, `propertyLocal`, `value` + `valueType` (`string` \| `entityRef` \| `boolean`), volitelné `upsert` |
| `deprecate_statement` | `statementId` (+ optional expectedRevision) |
| `list_statements` | Read: subject (+ optional `propertyLocal`) — pro agenta před replace |
| `clear_property` | Convenience: deprecate všech aktivních statementů dané property (už existuje) |

`set_property` zůstává convenience pro string replace (`replaceStringProperty`).

### D) Reclassify se zachováním identity (jádro cleanup)

**Invariant:** změna typu **nemění** entity `id` / `iriLocal` / view `elementRef` — mění se jen aktivní `instanceOf` (a případně následně vztahy).

#### `reclassify_entity`

Vstup: `id`, `newClassLocal`, `strictRelations?` (`fail` \| `warn`), `dryRun?`.

Interně:

1. Načíst aktivní `instanceOf` statements subjektu.
2. Projection: incidentní vztahy vs matice `AllowedRelationship` po novém typu.
3. Při `dryRun=true` → jen report, žádný zápis.
4. Jinak: deprecate všechny aktivní `instanceOf` → create jeden nový EntityRef na `newClassLocal`.

#### `reclassify_entities` (zobecněný high-level migrate)

Náhrada app-specific toolu. Pokrývá budoucí migrace typu AS→AC, Collaboration→Actor, Process→Function, …

| Parametr | Význam |
|----------|--------|
| `ids[]` a/nebo filtr | `package`, `fromClassLocal` |
| `newClassLocal` | Cílová třída |
| `dryRun` | Doporučeně true v primeru / agent guidance před execute |
| `strictRelations` | `fail` = nic nezapsat, pokud jakýkoli vztah po změně není v matici; `warn` = zapsat + report |

Výstup per-entity: `{ id, fromClass, toClass, ok, invalidRelationships[], wouldWrite }`.

Execute = N× logika `reclassify_entity` v **jednom** active CS.

#### Recept: app „split“ (dokumentace / primer, ne MCP tool)

Systém zůstane jako ApplicationComponent na **stejném id** + nová behaviorální ApplicationService + Realization + remap Serving:

```text
reclassify_entities (AS → AC, preserve id)
+ create_entity (ApplicationService)
+ create_relationship (Realization AC → AS)
+ update_relationship (Serving ends / type)
+ update_entity (labels)   # volitelně
+ deprecate_entity         # jen pokud vzniká náhradní entita s novým id
```

### E) Další helpery

| Tool | Popis |
|------|--------|
| `update_relationship` | Změna `sourceId` / `targetId` / `typeLocal`. Preferovat zachování `iriLocal` vztahu (revise statements, nebo deprecate+recreate se stejným `iriLocal`). |
| `retarget_view_nodes` | `fromElementId` → `toElementId`. Potřeba jen když se mění id entity / deprecate+nahrazení; po čistém reclassify obvykle netřeba. |

### F) Batch

| Tool | Popis |
|------|--------|
| `apply_operations` | Pole ops (`createEntity`, `updateEntity`, `deprecateEntity`, `createStatement`, `deprecateStatement`, …) append do active CS; soft limit ~200–400 ops / call |

```text
Fáze 1 — primitiva:     get/list changeset, entity CRUD-lite, statements, apply_operations
Fáze 2 — reclassify:    reclassify_entity, reclassify_entities, update_relationship, retarget_view_nodes
Fáze 3 — recepty:       dokumentovaný app-split (a další) bez dedikovaného toolu
Fáze 5 — shape/revise:  viz zadani-mcp-reclassify-shape.md (schema-config instanceOf, revise, props, constraints)
```

---

## Fázování implementace

| Fáze | Obsah | Hotovo když |
|------|--------|-------------|
| **1** | ChangeSet hygiena + `create_entity` / `update_entity` + statement tools + `apply_operations` | Agent vytvoří entity+statement, deprecate statement, batch v open CS; cancel čistí session |
| **2** | `reclassify_entity` + `reclassify_entities` + relation impact | Preserve id; jeden aktivní `instanceOf`; dryRun + strictRelations |
| **3** | `update_relationship` + `retarget_view_nodes` | Remap Serving / změna typu vztahu se stejným iriLocal kde možné |
| **4** | Docs + smoke + primer recept | Acceptance checklist; `mcp:smoke` rozšířen; odkaz z README |
| **5** | Shape-aware reclassify (revise + props + constraints + peer projection) | Samostatné zadání [`zadani-mcp-reclassify-shape.md`](./zadani-mcp-reclassify-shape.md) — **implemented** |

Doménová logika patří do `@itmap/archimate-core` (`modelService`), tool handlery v [`server/src/createMcpServer.ts`](../server/src/createMcpServer.ts) jen orchestrace + session/allowlist. Writes vždy `ensureOpenChangeSet` + write approval.

---

## Acceptance criteria

1. `reclassify_entity` / `reclassify_entities`: **stejné `id` i `iriLocal`** po změně třídy; právě jeden aktivní `instanceOf`; žádný dual typing.
2. `dryRun` u `reclassify_entities` vrátí invalid relationships bez zápisu; `strictRelations=fail` nic nezapíše při konfliktu.
3. Agent bez OE složí recept AS→AC (reclassify in-place) + nová AS + Realization + remap Serving; vše v jednom open CS; `commit` jen s `confirm_commit` (režim `propose`).
4. `create_statement` umí EntityRef (`instanceOf`) i String prop; `deprecate_statement` / `deprecate_entity` fungují.
5. `get_changeset` ukáže itemCount po batchi; `cancel_changeset` vyčistí session (včetně stale CS).
6. Smoke: create entity → create statement → reclassify (preserve id) → deprecate statement.

---

## Testovací plán (stručně)

- **Unit (core):** reclassify deprecate+create `instanceOf`; relation impact projection; update relationship iriLocal.
- **Live smoke:** rozšířit `npm run mcp:smoke` o create → statement → reclassify → deprecate statement (open CS, propose).
- **Manuální recept:** malý balík AS→AC + companion AS (lab package), bez OE.

---

## Rizika

| Riziko | Mitigace |
|--------|----------|
| Dual `instanceOf` po částečném fail | Jedna atomická sekvence v CS; při fail cancel / necommit; nikdy OE upsert pro typ |
| Neplatné vztahy po změně typu | `strictRelations` + dryRun report před execute |
| Velké batch migrate | Chunk přes `reclassify_entities` / `apply_operations` limity; jeden CS |
| Session desync po cancel | Auto-clear `activeChangeSetId`; `get_changeset` pro diagnostiku |
| Záměna reclassify vs deprecate+create nové entity | Primer: preferovat reclassify při zachování identity; deprecate jen při skutečné náhradě |

---

## Mimorozsah (explicitně)

- KC admin: classes, properties metamodel, shapes authoring, RDF, policies, lenses, GraphQL
- Hard delete entity / statement
- Multi-CS paralelismus v jedné MCP session
- Přepis OE importu / oprava `pushInstanceOf` (oddělené zadání — jen zmínka výše)
- Dedikovaný tool `migrate_misclassified_applications` (nahrazeno obecným `reclassify_entities` + recept)

---

## Dokumentace k dodání

- [x] `docs/zadani-mcp-graph-mutations.md` (tento dokument)
- [x] Odkaz z [`zadani-mcp-archimate.md`](./zadani-mcp-archimate.md) (follow-up / planned)
- [x] Krátká zmínka v [`server/README.md`](../server/README.md)
- [x] Po implementaci: rozšířit primer / smoke a označit status **implemented**
- [ ] Follow-up Fáze 5: [`zadani-mcp-reclassify-shape.md`](./zadani-mcp-reclassify-shape.md)
