# Helm — knowledge-itmap

Chart deploys:

- **UI** — nginx serving the SPA; reverse-proxies `/v1` + `/healthz` to Knowledge Core and `/mcp` + OAuth well-known to MCP
- **MCP** — HTTP MCP server (`@itmap/mcp-server`) with optional OAuth (RFC 9728)

Install into the same namespace as Knowledge Core (release name `kc`).

## Quick install

```bash
# Images from GHCR — tags default to Chart.appVersion (UI + MCP)
helm upgrade --install itmap deploy/helm/knowledge-itmap \
  --namespace knowledge-core \
  --set knowledgeCore.url=http://kc-knowledge-core:8080 \
  --set mcp.writePackages=org-demo \
  --set mcp.defaultPackage=org-demo
```

```bash
kubectl -n knowledge-core port-forward svc/itmap-knowledge-itmap 8081:80
# open http://127.0.0.1:8081
```

## Pocket ID / OIDC

1. Ensure Knowledge Core runs with `authMode=oidc` and Pocket ID (KC Helm `pocketId.enabled=true`).
2. On the **same** public PKCE OIDC client used by KC, add redirect URI:
   - `https://<itmap-host>/callback`
3. Enable MCP OAuth for clients that support OAuth/OIDC:

```bash
helm upgrade --install itmap deploy/helm/knowledge-itmap \
  --namespace knowledge-core \
  --set mcp.authMode=forward \
  --set mcp.oauth.enabled=true \
  --set mcp.oauth.publicUrl=https://itmap.example.com \
  --set mcp.oauth.issuer=https://id.example.com \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=itmap.example.com
```

JWT `aud` must match KC’s OIDC audience/client_id so KC accepts forwarded tokens.

## Values (key)

| Key | Default | Notes |
|-----|---------|-------|
| `knowledgeCore.url` | `http://kc-knowledge-core:8080` | In-cluster KC |
| `mcp.authMode` | `forward` | Use `service` + secret for automation |
| `mcp.oauth.enabled` | `false` | PRM + 401 WWW-Authenticate |
| `image.repository` | `ghcr.io/l-ra/knowledge-itmap` | UI |
| `image.tag` | `""` → Chart.appVersion | UI image tag |
| `mcpImage.repository` | `ghcr.io/l-ra/knowledge-itmap-mcp` | MCP |
| `mcpImage.tag` | `""` → Chart.appVersion | MCP image tag |

## CI / release

Same pattern as knowledge-core — one build version shared by images, chart `version`, and `appVersion`:

- Push `main` → UI + MCP images and chart all `0.0.0-dev.<run>` (+ `latest` alias on images)
- Tag `vX.Y.Z` → SemVer images + chart OCI `oci://ghcr.io/l-ra/charts/knowledge-itmap`
