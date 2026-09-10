# IT Map — Organization Architecture Editor

Doménově specializovaný editor nad **Knowledge Core**, metamodelem **archimate-lite ≥ 3.2.1**
a navigačním package **archimate-ui-traversal ≥ 1.0.0**.
Uživatel prochází a edituje model organizace ve sloupcovém browseru (Organization → … → Network / Location).

Specifikace: [`docs/funkcni-specifikace.md`](docs/funkcni-specifikace.md)  
Open Exchange import/export: [`docs/open-exchange.md`](docs/open-exchange.md)  
MCP pro agenty: [`docs/zadani-mcp-archimate.md`](docs/zadani-mcp-archimate.md), spuštění [`server/README.md`](server/README.md)  
Sdílená doména: `@itmap/archimate-core` · MCP server: `@itmap/mcp-server`

```bash
npm run mcp:build          # server/dist/index.js (bez tsx)
npm run mcp:stdio          # node dist, stdio
npm run mcp:smoke          # live acceptance proti KC
```


## Požadavky

- Node.js 20+
- Běžící Knowledge Core na `http://localhost:8080` (nebo `KC_PROXY_TARGET`)
- Sibling checkout [`knowledge-models`](../knowledge-models) s bundley
- Naimportované packages: `kc-base` 1.1.0 + `archimate-lite` **3.2.1** + `archimate-ui-traversal` 1.0.0 + `archimate-ui-cards` 1.0.0

## Lokální spuštění s Knowledge Core (DEV)

### 1. Spusť Knowledge Core

Dle [knowledge-core/README.md](../knowledge-core/README.md) a [knowledge-models/README.md](../knowledge-models/README.md):

```bash
cd /home/rasekl/src/knowledge-core
docker compose -f deploy/docker-compose.yml up -d postgres
# volitelně: pocket-id

export KC_DATABASE_URL='postgres://kc:kc@localhost:5433/knowledge_core?sslmode=disable'
export KC_AUTH_MODE=bootstrap
make dev
# API:  http://localhost:8080
# KC UI: http://localhost:5173/ui/
```

Bootstrap heslo: výpis při prvním startu / soubor v kontejneru `/data/admin.password`.

### 2. Import metamodelu + demo

```bash
cd /home/rasekl/src/knowledge-itmap
export KC_TOKEN='<bootstrap-heslo>'
export KNOWLEDGE_MODELS_PATH=/home/rasekl/src/knowledge-models   # default: ../knowledge-models
npm run setup:check
npm run setup:seed
```

`setup:seed` importuje:

1. `kc-base-1.1.0.bundle.json`
2. `archimate-lite-3.2.1.bundle.json`
3. `archimate-ui-traversal-1.0.0.bundle.json`
4. `archimate-ui-cards-1.0.0.bundle.json`
5. volitelně demo loader `archimate-lite-demo`
6. package `org-demo` (continuous, závislosti `archimate-lite ^3.1.0` + `archimate-ui-traversal ^1.0.0` + `archimate-ui-cards ^1.0.0`)

Alternativa ručně (KC UI → Packages → Import release bundle) ve stejném pořadí.

> **Migrace z 2.3.1:** UI metadata IRI se přesunula do `archimate-ui-traversal`.
> Klientská mapa: [`knowledge-models/migrations/`](../knowledge-models/migrations/).
> Neimportujte `archimate-lite@3.1.0` přes existující `2.3.1` / `3.0.0` bez migrace statements (`compat_breaking`).

### 3. Spusť IT Map

```bash
cd /home/rasekl/src/knowledge-itmap
cp .env.example .env   # volitelné
npm install
npm run dev
# http://localhost:5174
```

Vite proxy: `/v1` a `/healthz` → `KC_PROXY_TARGET` (default `http://localhost:8080`).

V UI: **Settings** → auth mode `bootstrap` → vlož heslo → **Uložit** → **Browser**.

Org package: vytvoř / vyber v **Packages** (`org-demo`).

## Co aplikace umí (MVP)

| Oblast | Funkce |
|--------|--------|
| Column browser | Traversal templates: Business exploration, Application impact, Infrastructure |
| Karty | Read-only procházení po PresentationProfile kartách (`/cards`) |
| Focus path | Breadcrumb grafem |
| Inspector Basic | Název, popis, actorKind, organizationScope |
| Inspector Extended | Statements, edit property, open-world nová property |
| CRUD | Doménové „+ Přidat“ s odvozenými ArchiMate vztahy |
| Packages | Seznam, import bundle, publish release, org package |
| Changes | ChangeSet historie |
| Search | KC full-text projekce |

## Struktura

```text
src/
  kc/           — HTTP klient, SchemaResolver, IRI migrace UI traversal
  domain/       — templates, TraversalEngine, ModelService, navigation profiles, cards
  pages/        — Browser, Cards, Packages, Changes, Settings, Search, Navigation
  components/   — Inspector, AddDialog, Toast
scripts/        — check-kc.sh, seed-demo.sh
docs/           — funkční specifikace a návrhy
```

## Auth režimy

| Mode | Použití |
|------|---------|
| `bootstrap` | Bearer = KC bootstrap heslo (lokální DEV) |
| `dev` | `X-Subject` + `X-Roles` (KC `KC_AUTH_MODE=dev`) |
| `bearer` | OIDC / JWT |

## Poznámky

- Schema se resolvuje přes `iriLocal` — nikdy hardcoded Q/P z jiné instalace.
- Doménový model: `archimate-lite` **3.1.0+**; UI traversal: `archimate-ui-traversal`; Karty: `archimate-ui-cards`.
- Flow vyžaduje `flowLabel`; Association nabízí `associationKind`.
