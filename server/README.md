# @itmap/mcp-server

MCP host for ArchiMate Lite / IT Map over Knowledge Core. Tools call `@itmap/archimate-core` only (no duplicated create/matrix logic).

## Run

### Production binary (no tsx)

```bash
# from repo root
npm run mcp:build

export ITMAP_KC_BASE_URL=http://localhost:8080
export ITMAP_MCP_ORG_PACKAGE=org-demo
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
export ITMAP_MCP_ORG_PACKAGE=org-demo
export ITMAP_MCP_AUTH_MODE=service
export ITMAP_KC_AUTH_MODE=bootstrap
export ITMAP_KC_TOKEN='…'
export ITMAP_MCP_WRITE_MODE=propose

# ensure org package exists
KC_TOKEN="$ITMAP_KC_TOKEN" npm run setup:seed   # or create org-demo in UI

npm run mcp:smoke
```

Smoke covers: healthz, schema, primer, list entities, AllowedRelationship reject, open CS, create element/relationship, get_card, commit, OE export/import via **file path**.

## Environment

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `ITMAP_KC_BASE_URL` | yes | — | KC `/v1` base |
| `ITMAP_MCP_ORG_PACKAGE` | yes | — | Fixed for the session |
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

\* With `ITMAP_KC_AUTH_MODE=dev`, token may be empty (X-Subject / X-Roles) if KC allows it.

## Cursor `mcp.json` (bundled binary)

```json
{
  "mcpServers": {
    "itmap": {
      "command": "node",
      "args": ["/absolute/path/to/knowledge-itmap/server/dist/index.js"],
      "env": {
        "ITMAP_KC_BASE_URL": "http://localhost:8080",
        "ITMAP_MCP_ORG_PACKAGE": "org-demo",
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

## Session rules

- **orgPackage** is set from env and cannot be changed via `configure_session` (rejected if attempted).
- Metamodel packages are never writable: `archimate-lite`, `kc-base`, `archimate-ui-traversal`, `archimate-ui-cards`, `architecture-migration`.
- Writes use `X-Validation-Mode: strict` and always bind an open ChangeSet.

## Elevate / commit

| `writeMode` | `commit_changeset` |
|-------------|--------------------|
| `propose` | Requires `confirm_commit: true` (explicit user confirmation) |
| `commit` | Commits without that flag |

Open Exchange import always opens a ChangeSet; it auto-commits only when `writeMode=commit`.

## Open Exchange I/O

| Mode | How |
|------|-----|
| XML string | `import_open_exchange({ xml })` / `export_open_exchange({})` |
| File path | `import_open_exchange({ path })` / `export_open_exchange({ path })` — path must be under `ITMAP_MCP_FILE_ROOTS` (realpath sandbox) |

Provide **exactly one** of `xml` or `path` on import. Large exports should use `path`.

## Package names

- Server: **`@itmap/mcp-server`**
- Shared domain: **`@itmap/archimate-core`**

## Resources

- `modeling://primer` — primer in session language
- `modeling://primer/cs`, `modeling://primer/en`
