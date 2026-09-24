# Zadání — MCP pro ArchiMate Lite (IT Map backend)

**Status:** implemented (F0–F7 + follow-ups: live smoke, dist bundle, OE file paths)  
**Repo:** `knowledge-itmap`  
**Závisí na:** Knowledge Core `/v1` (ChangeSet, shapes, graph API), packages `kc-base`, `archimate-lite` (≥ 3.2.1), `archimate-ui-cards` (≥ 1.1.0)  
**Související:** [`../knowledge-models/docs/archimate-lite-kc.md`](../../knowledge-models/docs/archimate-lite-kc.md), [`../knowledge-models/docs/archimate-lite.md`](../../knowledge-models/docs/archimate-lite.md), [`funkcni-specifikace.md`](./funkcni-specifikace.md) (§6 BFF / ValidationService), Open Exchange v `packages/archimate-core` / `src/domain/openExchange/`, [`../server/README.md`](../server/README.md)

**Není součástí:** KC Lens API (`lens_definition`), přepis TraversalEngine / column browseru, multi-tenant SaaS, schvalovací workflow nad ChangeSety (jen open/commit/cancel), vynucení `AllowedRelationship` uvnitř Go jádra KC.

---

## Cíl

Zpřístupnit agentům (Cursor a další MCP klienti) architektonický model v Knowledge Core s omezeními **ArchiMate Lite**, stejnou doménovou sémantikou jako IT Map, a business jazykem karet.

Výsledek:

1. Sdílená TS knihovna **`packages/archimate-core`** (`@itmap/archimate-core`) — schema, validace matice, model commands, card view-model, Open Exchange jádro.
2. **IT Map web** importuje `archimate-core` (včetně `isAllowed` na write path).
3. **IT Map server** (`@itmap/mcp-server`) hostí MCP (stdio + HTTP/SSE) nad stejnou knihovnou.
4. Agent čte/píše model s metodickým primerem, card projekcí, views CRUD a OE import/export.

---

## Rozhodnutí (z diskuse)

| # | Téma | Volba |
|---|------|--------|
| 1 | Write politika | **C** — open ChangeSet vždy; `commit` / auto-commit konfigurovatelné (lab vs propose-only) |
| 2 | Rozsah v1 | **C plné** — elementy + vztahy + properties + schema/guidance + card read + **views CRUD** + **Open Exchange** |
| 3 | Transport | **C** — stdio i HTTP+SSE |
| 4 | Auth | **C** — service account do KC i forward uživatelského OIDC tokenu (konfigurovatelné) |
| 5 | Session / package | **Superseded by ADR** — multipackage; write allowlist + session approve; read unrestricted |
| 6 | Jazyk | **C** — CS i EN; preferovaný lang v session |
| 7 | Shared lib + IT Map gating | **A** — součást tohoto zadání: extrakce `archimate-core` + `isAllowed` na IT Map write path |

Další kotvy z diskuse (neměnit bez ADR):

- MCP **ne** jako povinná proxy pro celé UI — SPA dál volá KC `/v1` přímo (responsivita).
- Karty = **projekce** z `archimate-ui-cards` pro agenta, **ne** KC Lens.
- Matice `AllowedRelationship` a `X-Validation-Mode: strict` u agent writes; matice se vynucuje ve shared lib (KC ji nevynucuje).
- Metamodelu (`archimate-lite`, `kc-base`, UI packages) agent **nezapisuje**.
- Open Exchange: **reuse** `openExchange/*` po extrakci — ne psát nový XML mapper; MCP obal + Node-safe úpravy ano.
- Views CRUD: dedicated commands nad `DiagramView` / `ViewNode` / `ViewConnection` (nová doménová vrstva nad stávajícím create entity/statements).

### Vyřešené otevřené drobnosti

| # | Téma | Rozhodnutí |
|---|------|------------|
| 1 | npm package names | **`@itmap/archimate-core`** + **`@itmap/mcp-server`**. Scope `@itmap/` = produkt IT Map (ne generické KC); private workspace packages. Delší `@knowledge-itmap/…` by jen kopírovalo git repo name. |
| 2 | Elevate flag pro commit v `propose` | **Ano** — `commit_changeset` vyžaduje `confirm_commit: true`. V `writeMode=commit` flag není potřeba. |
| 3 | OE I/O | XML **string** i **file path** (`path` pod `ITMAP_MCP_FILE_ROOTS`); limit `ITMAP_MCP_OE_MAX_BYTES` |
| 4 | `configure_session` + package | **Superseded** — viz [`adr-mcp-multipackage-session.md`](./adr-mcp-multipackage-session.md): multipackage session, write allowlist + per-session `approve_write_package` |

---

## Architektura

```text
knowledge-itmap/
  packages/
    archimate-core/     # pure TS domain (bez React / localStorage / IndexedDB)
  src/                  # React SPA — importuje archimate-core
  server/               # @itmap/mcp-server — MCP host (+ později volitelné BFF)
```

```text
Browser (IT Map)  ──/v1──►  Knowledge Core
                      ▲
MCP clients  ──►  server/ ──/v1──┘
                   └── @itmap/archimate-core
```

### `archimate-core` — obsah

| Modul | Zdroj dnes | Odpovědnost |
|-------|------------|-------------|
| `KcClient` interface + Node/browser adaptéry | `src/kc/client.ts` (rozřezat) | HTTP `/v1`, open CS headery |
| Schema snapshot + load + `isAllowed` | `src/kc/schema.ts` | třídy, props, enumy, matice |
| Schema cache port | `schemaCache` | serializovatelný snapshot; persistenci (IDB/memory) nechá adaptér |
| Model commands | `modelService.ts`, `propertyEdit.ts` | create element/rel, set property, deprecate; **gated `isAllowed`** |
| Validation | nové + shapes strict | matice + metodické warnings (minimálně: empty recommended slots, flowLabel, …) |
| Cards projection | `domain/cards/*` | load profiles/slots, `CardViewModel` / `getCard` |
| Views commands | nové | CRUD DiagramView, nodes, connections |
| Open Exchange | `domain/openExchange/*` | parse/serialize/sync import/export/orphans |
| Modeling primer | nové (zdroj z docs) | krátký CS/EN text + odkazy na on-demand guidance |

**Nesmí záviset na:** React, Vite `import.meta.env` (config DI), `window` / IndexedDB.

**Smí záviset na:** `fetch`/undici za `KcClient`, čisté TS typy.

### `server/` — MCP host

- Spouštění: CLI (`itmap-mcp` / `npm run mcp`) / process vedle SPA.
- Transports: **stdio** (local Cursor) + **HTTP+SSE** (sdílený server).
- Session state: `workingPackage`, `writePackagesAllowlist`, `approvedWritePackages`, `lang` (`cs`\|`en`), `writeMode` (`propose`\|`commit`), auth binding, aktivní open ChangeSet id. Read unrestricted; write = allowlist ∩ session approval.
- Tools volají výhradně `archimate-core` (ne duplicitní HTTP skládání v tool handleru).
- Docs: [`server/README.md`](../server/README.md), ADR multipackage.

---

## MCP surface

### Session / meta

| Tool / resource | Popis |
|-----------------|--------|
| Resource `modeling://primer` (+ `/cs`, `/en`) | Stručný koncept Lite (L0–L4, co patří do modelu, ChangeSet, karty ↔ ArchiMate) — CS i EN |
| `get_session` / `configure_session` | lang, writeMode, workingPackage (must be approved) |
| `get_access_token` | export Bearer token for KC (`confirm: true`; service / forward) — prefer `/token` UI when you have no MCP Bearer yet |
| `approve_write_package` / `revoke_write_package` | per-session write approval (`confirm: true`) |
| `open_changeset` / `commit_changeset` / `cancel_changeset` | v `propose` vyžaduje `confirm_commit: true`; v `commit` bez elevate |
| `health` | KC reachability, schema, allowlist, session |

### Schema / guidance

| Tool | Popis |
|------|--------|
| `list_element_types` / `list_relationship_types` | konkrétní AML typy (ne abstraktní kořeny) |
| `get_allowed_relationships` | filtr source/target type |
| `get_property_schema` | props, enumy, shapes hints |
| `get_usage_guidance` | `usageGuidance` / `usageExamples` z KC |
| `list_card_profiles` / `get_card_profile` | labely + sloty (business jazyk) |

### Read / explore

| Tool | Popis |
|------|--------|
| `search_entities` / `list_entities` | optional `package` (default workingPackage); typed filters + optional properties |
| `list_entity_facets` / `inventory_report` | package inventory |
| `list_relationships` | by type + optional source/target; labels resolved |
| `batch_get_entities` | batch read (max 200) |
| `get_entity` | entity + klíčové statements (read any package) |
| `get_neighborhood` | resolved links by default; `raw: true` for KC statements |
| `get_card` | card projekce: profil, fields, sloty + sousedé, empty recommended |
| `validate_entity` | KC validation (pokud endpoint existuje) + methodology findings z empty recommended slots |

### Write (do open CS; strict)

| Tool | Popis |
|------|--------|
| `create_entity` | labels/descriptions + `instanceOf` + props |
| `create_relationship` | typ + source + target; **reject pokud `!isAllowed`** |
| `set_property` / `clear_property` | dle property rules |
| `deprecate_entity` | s ohledem na inbound refs |

### Views (v1)

| Tool | Popis |
|------|--------|
| `list_views` / `get_view` | DiagramView + nodes/connections |
| `create_view` | `DiagramView` (+ volitelný viewpoint) |
| `add_view_node` / `update_view_node` | elementRef, bounds, parentNode, style |
| `add_view_connection` / `update_view_connection` | relationshipRef, source/target node, bendpoints |
| `remove_view_*` | deprecate dle KC pravidel |

View tools nemění architektonické prvky/vztahy — jen prezentaci. Agent má nejdřív zajistit existenci element/rel v grafu.

### Open Exchange (v1)

| Tool | Popis |
|------|--------|
| `import_open_exchange` | `xml` **nebo** `path` (pod `ITMAP_MCP_FILE_ROOTS`); limit bytů; open CS; commit jen v `writeMode=commit` |
| `export_open_exchange` | bez path → XML string; s `path` → zápis na disk + counts |
| `apply_open_exchange_orphans` | stávající orphan actions |

Reuse: logika z `importOpenExchange` / `exportOpenExchange` / sync. Nové je MCP I/O, limity, auth session, Node adaptér.

---

## Auth a bezpečnost

| Režim | Chování |
|-------|---------|
| Service account | server má KC credentials; ChangeSet actor = agent subject (`X-Actor` / konfigurace) |
| Forwarded user token | klient předá Bearer; server ho použije na `/v1`; actor = uživatel |

Povinné:

- Least privilege policies v KC: write jen do org package session; deny write na metamodel packages.
- Agent writes: `X-Validation-Mode: strict`.
- Rate / size limity na OE XML a batch ops.
- Audit: ChangeSet comment prefix např. `mcp:` + tool name.

---

## IT Map dopady (fáze 0–1)

1. Extrahovat kód do `packages/archimate-core` bez změny chování UI (kromě bodu 2).
2. **`createRelationship*` / odvozené relace:** volat `schema.isAllowed(...)`; při fail srozumitelná chyba (stejná jako MCP).
3. SPA dál přímý `/v1` (Vite proxy); **ne** routovat UI přes MCP server.
4. Volitelně později: UI může importovat stejný primer/help text — mimo must-have v1 MCP.

---

## Metodický primer

- Krátký dokument (řádově 1–2 stránky CS + EN) odvozený z `archimate-lite.md` (granularita, inclusion rules) + vztah karet.
- Exponovaný jako MCP resource; detaily přes `get_usage_guidance` / card profiles.
- **Ne** celý metodický dokument do každé tool response.
- UI traversal (`archimate-ui-traversal`) do primeru **nepatří**.

---

## Fázování implementace

| Fáze | Obsah | Hotovo když |
|------|--------|-------------|
| **0** | Workspace (`packages/archimate-core`), přesun schema + KcClient interface, SPA build/test zelené | `npm test` / typecheck; schema load z web i Node smoke |
| **1** | Model commands + `isAllowed` gating (core + IT Map write path) | Neplatný vztah odmítnut v UI i v unit testu core |
| **2** | `server/` MCP: session, schema/read tools, primer resource, stdio | Cursor (nebo MCP inspector) načte typy a entitu z demo package |
| **3** | Write tools + ChangeSet + writeMode propose/commit | Agent vytvoří element+vztah do open CS; propose neumí commit bez elevate |
| **4** | Card projection tools | `get_card` vrací slot labely a recommended empty |
| **5** | Views CRUD tools | Vytvoření view s node/connection nad existujícími el/rel |
| **6** | Open Exchange tools + HTTP/SSE transport + auth modes | Import/export XML přes MCP; oba transporty a oba auth módy zdokumentované |
| **7** | Docs + seed/runbook | README serveru, env config, acceptance checklist |

Fáze 0–7 + follow-upy jsou v kódu. Live smoke: `npm run mcp:smoke` (vyžaduje běžící KC + org package). Bundle: `npm run mcp:build` → `server/dist/index.js`.

---

## Konfigurace (návrh)

```text
ITMAP_KC_BASE_URL=
ITMAP_MCP_WRITE_PACKAGES=       # required CSV allowlist for write (e.g. org-ote,org-demo)
ITMAP_MCP_DEFAULT_PACKAGE=      # optional; must be ⊆ WRITE_PACKAGES
ITMAP_MCP_ORG_PACKAGE=          # deprecated alias → single-item allowlist + default
ITMAP_MCP_LANG=cs               # cs | en
ITMAP_MCP_WRITE_MODE=propose    # propose | commit
ITMAP_MCP_AUTH_MODE=service     # service | forward
ITMAP_KC_TOKEN=                 # service account
ITMAP_MCP_TRANSPORT=stdio       # stdio | http
ITMAP_MCP_HTTP_PORT=3100
ITMAP_MCP_OE_MAX_BYTES=5000000
ITMAP_MCP_FILE_ROOTS=           # optional; colon/comma dirs for OE path tools
```

Session overlay: `lang`, `writeMode`, `workingPackage` (among approved). Write requires `approve_write_package` first. See [`adr-mcp-multipackage-session.md`](./adr-mcp-multipackage-session.md).

---

## Acceptance criteria

1. Shared package importují web i server; žádná duplicitní matice/create logika v MCP handlerech.
2. `isAllowed` blokuje neplatný vztah v IT Map i přes MCP (stejná chybová sémantika).
3. MCP write vyžaduje package ∈ config allowlist **a** session `approve_write_package`; read není omezený na package. Metamodel packages nejsou zapisovatelné.
4. Režim `propose`: změny v open CS, `commit_changeset` jen s `confirm_commit: true`; režim `commit`: agent může commitnout bez elevate.
5. `get_card` vrací business labely slotů (CS/EN dle session) a recommended prázdné sloty.
6. Views: agent vytvoří `DiagramView` + node na element + connection na vztah bez změny architektonických statements elementu.
7. OE: import/export XML string **nebo** path pod `ITMAP_MCP_FILE_ROOTS` (reuse sync sémantiky).
8. Stdio i HTTP+SSE fungují proti témuž tool setu.
9. Service account i forwarded token jsou popsané; smoke pokrývá service/bootstrap.
10. Primer resource je dostupný; neobsahuje UI-traversal specifiká.
11. Agent nemůže měnit metamodel packages.
12. Unit testy core + `npm run mcp:smoke` (live KC) + `npm run mcp:build` (dist bez tsx).

---

## Testovací plán (stručně)

- **Unit:** `isAllowed`, card resolve, path sandbox (`server/src/paths.test.ts`), OE parse round-trip.
- **Live smoke:** `npm run mcp:smoke` — open CS → create ApplicationComponent + Realization → get_card → commit; OE path export/import.
- **Bundle:** `npm run mcp:build` → `node server/dist/index.js` (stdio/http).
- **Regrese IT Map:** AddDialog / create relationship, Open Exchange UI import/export.

---

## Rizika

| Riziko | Mitigace |
|--------|----------|
| Extrakce rozbije SPA | Fáze 0 bez behavior change; pak gating |
| OE v Node (DOMParser) | `@xmldom/xmldom` fallback v parseXml |
| Velké OE XML v tool args | limit bytů + **path** tools pod FILE_ROOTS |
| Card package chybí v KC | Tool vrátí jasnou chybu „import archimate-ui-cards“ |
| Forwarded token + browser CORS | HTTP MCP je server-side; neprohánět token přes SPA zbytečně |
| Strict validation mid-create rel | create relationship přes batch ops v jednom requestu |

---

## Dokumentace k dodání

- [x] `docs/zadani-mcp-archimate.md`
- [x] `server/README.md` — spuštění, env, Cursor `mcp.json`, smoke, path OE
- [x] root `README.md` — odkaz na MCP

---

## Follow-upy (hotovo)

| # | Položka | Stav |
|---|---------|------|
| 1 | Live acceptance smoke | `npm run mcp:smoke` (`server/src/smoke.ts`) |
| 2 | Bundlovaný `dist`/`bin` bez tsx | `npm run mcp:build` → `server/dist/index.js`, bin `itmap-mcp` |
| 3 | OE file-path tools | `path` na import/export + `ITMAP_MCP_FILE_ROOTS` sandbox |
| 4 | Mutace grafu / statements / reclassify se zachováním id | **Implemented** — [`zadani-mcp-graph-mutations.md`](./zadani-mcp-graph-mutations.md) |

## Follow-upy (planned)

| # | Položka | Stav |
|---|---------|------|
| 5 | Shape-aware reclassify (revise, props, constraints, peer projection) | **Planned** — [`zadani-mcp-reclassify-shape.md`](./zadani-mcp-reclassify-shape.md) |
