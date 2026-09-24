# IT Map — provozní runbook

## Předpoklady

- Cluster s Knowledge Core v namespace `knowledge-core` (Helm release `kc`)
- Volitelně Pocket ID (KC subchart) pro OIDC

## Instalace

```bash
helm upgrade --install itmap oci://ghcr.io/l-ra/charts/knowledge-itmap --version X.Y.Z \
  --namespace knowledge-core \
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
2. Pocket ID client (stejný jako KC): přidejte redirect URIs  
   - `https://<itmap-host>/callback` (ITMap SPA)  
   - `https://<itmap-host>/token/callback` (MCP token UI)
3. IT Map Login → **Přihlásit přes Pocket ID / OIDC**
4. MCP OAuth + token bootstrap:

```bash
--set mcp.authMode=forward \
--set mcp.oauth.enabled=true \
--set mcp.oauth.publicUrl=https://<itmap-host> \
--set mcp.oauth.issuer=https://<pocket-id-host> \
--set mcp.oauth.clientId=knowledge-core
```

Ověření:

```bash
curl -fsS https://<itmap-host>/.well-known/oauth-protected-resource/mcp
curl -i https://<itmap-host>/mcp   # očekávejte 401 + WWW-Authenticate
curl -fsS https://<itmap-host>/token/config
```

MCP klienti s OAuth podporou použijí URL `https://<itmap-host>/mcp`.  
Bez OAuth v klientovi: otevřete `https://<itmap-host>/token`, přihlaste se a zkopírujte Bearer.

## Upgrade

```bash
helm upgrade itmap oci://ghcr.io/l-ra/charts/knowledge-itmap --version X.Y.Z \
  --namespace knowledge-core \
  --reuse-values
```

## Troubleshooting

| Symptom | Check |
|---------|--------|
| UI login „ui/config failed“ | KC Service / `knowledgeCore.url` / nginx `/v1` proxy |
| OIDC redirect mismatch | Pocket ID callback = `/callback` (SPA) a `/token/callback` (MCP token UI) |
| MCP 401 always | Očekávané bez Bearer; token z `https://<host>/token` nebo OAuth v klientovi |
| KC 401 po MCP OAuth | JWT `aud` musí sedět s KC `oidcAudience` / client_id |
