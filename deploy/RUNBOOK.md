# IT Map — provozní runbook

## Předpoklady

- Cluster s Knowledge Core v namespace `knowledge-core` (Helm release `kc`)
- Volitelně Pocket ID (KC subchart) pro OIDC

## Instalace

```bash
helm upgrade --install itmap oci://ghcr.io/l-ra/charts/knowledge-itmap --version X.Y.Z \
  --namespace knowledge-core \
  --set image.tag=X.Y.Z \
  --set mcpImage.tag=X.Y.Z \
  --set knowledgeCore.url=http://kc-knowledge-core:8080 \
  --set mcp.writePackages=org-demo \
  --set mcp.defaultPackage=org-demo
```

## Bootstrap (bez OIDC)

1. KC v `bootstrap` — heslo z `kubectl logs -n knowledge-core deploy/kc-knowledge-core | grep bootstrap`
2. Otevřete IT Map → Login → zadejte bootstrap heslo
3. Nebo Settings → auth mode bootstrap + token

## Pocket ID (OIDC)

1. KC: `pocketId.enabled=true`, Admin → OIDC / IdP (nebo auto-register Job)
2. Pocket ID client (stejný jako KC): přidejte redirect  
   `https://<itmap-host>/callback`
3. IT Map Login → **Přihlásit přes Pocket ID / OIDC**
4. MCP OAuth:

```bash
--set mcp.authMode=forward \
--set mcp.oauth.enabled=true \
--set mcp.oauth.publicUrl=https://<itmap-host> \
--set mcp.oauth.issuer=https://<pocket-id-host>
```

Ověření:

```bash
curl -fsS https://<itmap-host>/.well-known/oauth-protected-resource/mcp
curl -i https://<itmap-host>/mcp   # očekávejte 401 + WWW-Authenticate
```

MCP klienti s OAuth podporou použijí URL `https://<itmap-host>/mcp`.

## Upgrade

```bash
helm upgrade itmap oci://ghcr.io/l-ra/charts/knowledge-itmap --version X.Y.Z \
  --namespace knowledge-core \
  --reuse-values \
  --set image.tag=X.Y.Z \
  --set mcpImage.tag=X.Y.Z
```

## Troubleshooting

| Symptom | Check |
|---------|--------|
| UI login „ui/config failed“ | KC Service / `knowledgeCore.url` / nginx `/v1` proxy |
| OIDC redirect mismatch | Pocket ID callback = `https://<host>/callback` |
| MCP 401 always | Očekávané bez Bearer; pošlete JWT z Pocket ID |
| KC 401 po MCP OAuth | JWT `aud` musí sedět s KC `oidcAudience` / client_id |
