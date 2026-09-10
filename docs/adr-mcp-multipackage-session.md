# ADR: MCP multipackage session + write approval

**Status:** Accepted  
**Date:** 2026-09-10  
**Repo:** `knowledge-itmap` / `@itmap/mcp-server`

## Context

MCP v1 bound each process to a single immutable `orgPackage`. Agents reviewing large org models (`org-ote`) had to restart MCP to switch package, and read/write shared the same scope. Inventory work also lacked facets / typed list ergonomics, forcing KC API bypass.

## Decision

1. **Read is unrestricted** across packages (including metamodel).
2. **Write allowlist** comes from config: `ITMAP_MCP_WRITE_PACKAGES` (CSV).
3. **Per-session write approval** via `approve_write_package({ packageCode, confirm: true })` before any write tool may target that package.
4. **Working package** (`workingPackage`) is mutable among approved packages; used as default for write and as default filter for list/search/facets when `package` is omitted.
5. Legacy `ITMAP_MCP_ORG_PACKAGE` maps to allowlist+[default] for compatibility.
6. Metamodel packages remain hard-deny for write even if listed.

Supersedes decision **5A** in `zadani-mcp-archimate.md` (orgPackage immutable).

## Consequences

- Agents can switch `org-ote` / `org-demo` without MCP restart after approval.
- Accidental writes require explicit `confirm: true` approval (in addition to ChangeSet / `confirm_commit` in propose mode).
- Explore tools (`list_entity_facets`, enriched `list_entities`, `list_relationships`, resolved `get_neighborhood`, `batch_get_entities`, `inventory_report`, `health`) support catalog reviews without direct KC access.
