# @itmap/mcp-server

MCP host for ArchiMate Lite / IT Map over Knowledge Core. Tools call `@itmap/archimate-core` only (no duplicated create/matrix logic).

## Multipackage session

| Concern | Behavior |
|---------|----------|
| **Read** | Unrestricted (any package, including metamodel) |
| **Write allowlist** | `ITMAP_MCP_WRITE_PACKAGES` (CSV) |
| **Session approval** | `approve_write_package({ packageCode, confirm: true })` before writes |
| **Working package** | Default for write + default `package` filter on list/search/facets |

See [`docs/adr-mcp-multipackage-session.md`](../docs/adr-mcp-multipackage-session.md).

### Typical agent flow

1. `get_session` / `health` — see allowlist  
2. Read freely (`list_entity_facets`, `list_entities`, `get_entity`, …) with `package=org-ote`  
3. `approve_write_package({ packageCode: "org-ote", confirm: true })`  
4. Optional `configure_session({ workingPackage: "org-ote" })`  
5. Write tools / ChangeSet / `commit_changeset`  

## Run

### Production binary (no tsx)

```bash
# from repo root
npm run mcp:build

export ITMAP_KC_BASE_URL=http://localhost:8080
export ITMAP_MCP_WRITE_PACKAGES=org-ote,org-demo
export ITMAP_MCP_DEFAULT_PACKAGE=org-ote
export ITMAP_MCP_WRITE_MODE=propose
export ITMAP_MCP_AUTH_MODE=service
export ITMAP_KC_AUTH_MODE=bootstrap
export ITMAP_KC_TOKEN='…'          # or ITMAP_KC_AUTH_MODE=dev
export ITMAP_MCP_TRANSPORT=stdio
# optional file-path OE:
export ITMAP_MCP_FILE_ROOTS=/data/oe:/tmp/itmap-oe

npm run mcp:stdio
# or: node server/dist/index.js
# or: npx itmap-mcp   (bin → server/dist/index.js)
```

HTTP:

```bash
export ITMAP_MCP_TRANSPORT=http
export ITMAP_MCP_HTTP_PORT=3100
npm run mcp
# → POST/GET/DELETE http://localhost:3100/mcp
```

### Dev (tsx, no build)

```bash
npm run mcp:dev
```

## Live acceptance smoke

Against a running Knowledge Core (seeded metamodel + org package):

```bash
export ITMAP_KC_BASE_URL=http://localhost:8080
export ITMAP_MCP_WRITE_PACKAGES=org-demo
export ITMAP_MCP_DEFAULT_PACKAGE=org-demo
export ITMAP_MCP_AUTH_MODE=service
export ITMAP_KC_AUTH_MODE=bootstrap
export ITMAP_KC_TOKEN='…'
export ITMAP_MCP_WRITE_MODE=propose

# ensure org package exists
KC_TOKEN="$ITMAP_KC_TOKEN" npm run setup:seed   # or create org-demo in UI

npm run mcp:smoke
```

Smoke covers: healthz, schema, primer, write-gate without approval, approve, list entities, typed BusinessActor list when present, AllowedRelationship reject, open CS, create entity/relationship, create statement → reclassify AS→AC (preserve id) → Function→Actor with props → deprecate statement, get_card, commit, OE export/import via **file path**, cross-package read.

## Environment

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `ITMAP_KC_BASE_URL` | yes | — | KC `/v1` base |
| `ITMAP_MCP_WRITE_PACKAGES` | yes* | — | CSV write allowlist |
| `ITMAP_MCP_DEFAULT_PACKAGE` | | first allowlist / legacy | Must be ⊆ allowlist |
| `ITMAP_MCP_ORG_PACKAGE` | legacy* | — | If `WRITE_PACKAGES` unset → single-item allowlist + default |
| `ITMAP_MCP_LANG` | | `cs` | `cs` \| `en` |
| `ITMAP_MCP_WRITE_MODE` | | `propose` | `propose` \| `commit` |
| `ITMAP_MCP_AUTH_MODE` | | `service` | `service` \| `forward` |
| `ITMAP_KC_TOKEN` | service* | | Bearer for service account |
| `ITMAP_KC_AUTH_MODE` | | `bearer` | `bootstrap` \| `dev` \| `oidc` \| `bearer` |
| `ITMAP_KC_SUBJECT` / `ITMAP_KC_ROLES` | | mcp subject / `admin,editor` | Dev / actor headers |
| `ITMAP_MCP_ACTOR` | | — | Prefix in ChangeSet comments |
| `ITMAP_MCP_TRANSPORT` | | `stdio` | `stdio` \| `http` |
| `ITMAP_MCP_HTTP_PORT` | | `3100` | |
| `ITMAP_MCP_OE_MAX_BYTES` | | `5000000` | Open Exchange XML size limit |
| `ITMAP_MCP_FILE_ROOTS` | for path OE | empty | Colon- or comma-separated absolute dirs; required for `path=` on import/export |
| `ITMAP_MCP_OAUTH_ENABLED` | | `false` | HTTP: RFC 9728 PRM + `401` `WWW-Authenticate` |
| `ITMAP_MCP_PUBLIC_URL` | oauth* | — | Public base (e.g. `https://itmap.example.com`) |
| `ITMAP_MCP_OIDC_ISSUER` | oauth* | — | Pocket ID issuer (same as KC) |
| `ITMAP_MCP_OAUTH_SCOPES` | | `openid,profile,email,groups` | CSV scopes in PRM |

\* Provide `WRITE_PACKAGES` **or** legacy `ORG_PACKAGE`. With `ITMAP_KC_AUTH_MODE=dev`, token may be empty. OAuth\* required when `ITMAP_MCP_OAUTH_ENABLED=true`.

## HTTP OAuth (MCP clients with OIDC)

When `ITMAP_MCP_TRANSPORT=http` and `ITMAP_MCP_OAUTH_ENABLED=true`:

1. Client hits `/mcp` without Bearer → `401` + `WWW-Authenticate` pointing at Protected Resource Metadata.
2. `GET /.well-known/oauth-protected-resource/mcp` returns RFC 9728 document with `authorization_servers` = Pocket ID issuer.
3. Client completes OAuth Authorization Code + PKCE at Pocket ID (same client/audience as Knowledge Core so JWT `aud` validates at KC).
4. Client retries `/mcp` with `Authorization: Bearer <token>`; MCP uses `ITMAP_MCP_AUTH_MODE=forward` to Knowledge Core.

Example env for cluster:

```bash
export ITMAP_MCP_TRANSPORT=http
export ITMAP_MCP_AUTH_MODE=forward
export ITMAP_MCP_OAUTH_ENABLED=true
export ITMAP_MCP_PUBLIC_URL=https://itmap.example.com
export ITMAP_MCP_OIDC_ISSUER=https://id.example.com
```

Stdio mode does not use OAuth — keep `ITMAP_MCP_AUTH_MODE=service` with a token.

## Cursor `mcp.json` (bundled binary)

```json
{
  "mcpServers": {
    "itmap": {
      "command": "node",
      "args": ["/absolute/path/to/knowledge-itmap/server/dist/index.js"],
      "env": {
        "ITMAP_KC_BASE_URL": "http://localhost:8080",
        "ITMAP_MCP_WRITE_PACKAGES": "org-ote,org-demo",
        "ITMAP_MCP_DEFAULT_PACKAGE": "org-ote",
        "ITMAP_MCP_TRANSPORT": "stdio",
        "ITMAP_MCP_WRITE_MODE": "propose",
        "ITMAP_MCP_AUTH_MODE": "service",
        "ITMAP_KC_AUTH_MODE": "bootstrap",
        "ITMAP_KC_TOKEN": "…",
        "ITMAP_MCP_FILE_ROOTS": "/absolute/path/to/oe-files"
      }
    }
  }
}
```

Prefer a **single** MCP server process. After changing env, reload the MCP server in Cursor.

## Session rules

- **Read:** no package gate.
- **Write:** package ∈ `writePackagesAllowlist` ∧ session-approved ∧ not metamodel.
- Metamodel packages never writable: `archimate-lite`, `kc-base`, `archimate-ui-traversal`, `archimate-ui-cards`, `architecture-migration`.
- Writes use `X-Validation-Mode: strict` and always bind an open ChangeSet.
- Deprecated `orgPackage` on `get_session` / `configure_session` aliases `workingPackage`.

## Explore tools (catalog reviews)

| Tool | Use |
|------|-----|
| `list_entity_facets` | Counts by `instanceOf` |
| `list_entities` | `instanceOfLocal`, `includeProperties`, `package` |
| `list_relationships` | By relationship type + optional ends |
| `get_neighborhood` | Resolved `{relType, direction, other}` (optional `raw`) |
| `batch_get_entities` | Up to 200 ids |
| `inventory_report` | Facets + sample labels |
| `health` | KC + schema + allowlist |

## Write / graph mutation tools

| Tool | Use |
|------|-----|
| `get_changeset` / `list_changesets` | Active or listed CS; cancel clears session (incl. stale) |
| `create_entity` / `update_entity` / `deprecate_entity` | Entity CRUD-lite (preserve id on reclassify — do not deprecate for type-only fixes) |
| `create_statement` / `deprecate_statement` / `list_statements` | String / EntityRef / Boolean statements |
| `set_property` / `clear_property` | String property convenience |
| `create_relationship` / `update_relationship` | Matrix-gated; update preserves relationship `iriLocal` |
| `reclassify_entity` / `reclassify_entities` | Change class in-place (`dryRun`, `strictRelations`, `props`) — revise `instanceOf`; peer projection in batch |
| `get_class_constraints` | Required properties for a class (KC shapes + fallback) |
| `retarget_view_nodes` | Remap `elementRef` when entity id changes |
| `apply_operations` | Batch append into active CS (soft limit 300) |

Spec: [`docs/zadani-mcp-graph-mutations.md`](../docs/zadani-mcp-graph-mutations.md), shape/revise: [`docs/zadani-mcp-reclassify-shape.md`](../docs/zadani-mcp-reclassify-shape.md).

## Elevate / commit

| `writeMode` | `commit_changeset` |
|-------------|--------------------|
| `propose` | Requires `confirm_commit: true` (explicit user confirmation) |
| `commit` | Commits without that flag |

Open Exchange import always opens a ChangeSet; it auto-commits only when `writeMode=commit`. Target package must be write-approved.

## Open Exchange I/O

| Mode | How |
|------|-----|
| XML string | `import_open_exchange({ xml, packageCode? })` / `export_open_exchange({ packageCode? })` |
| File path | `path` under `ITMAP_MCP_FILE_ROOTS` |

Provide **exactly one** of `xml` or `path` on import. Large exports should use `path`.

## Package names

- Server: **`@itmap/mcp-server`**
- Shared domain: **`@itmap/archimate-core`**

## Resources

- `modeling://primer` — primer in session language
- `modeling://primer/cs`, `modeling://primer/en`
