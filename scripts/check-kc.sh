#!/usr/bin/env bash
# Check that local Knowledge Core is reachable.
set -euo pipefail

KC_URL="${KC_BASE_URL:-http://localhost:8080}"

echo "Checking Knowledge Core at $KC_URL …"
code=$(curl -s -o /tmp/kc-health.json -w "%{http_code}" "$KC_URL/healthz" || true)
if [[ "$code" != "200" ]]; then
  echo "FAIL: /healthz returned HTTP $code"
  echo ""
  echo "Start Knowledge Core (from knowledge-core repo):"
  echo "  docker compose -f deploy/docker-compose.yml up -d postgres"
  echo "  export KC_DATABASE_URL='postgres://kc:kc@localhost:5433/knowledge_core?sslmode=disable'"
  echo "  export KC_AUTH_MODE=bootstrap"
  echo "  make dev   # API http://localhost:8080"
  echo ""
  echo "See: knowledge-core/README.md and ../knowledge-models/README.md"
  exit 1
fi
echo "OK: healthz"
cat /tmp/kc-health.json
echo ""

if [[ -z "${KC_TOKEN:-}" ]]; then
  echo "Tip: export KC_TOKEN='<bootstrap password>' for authenticated checks / seed."
  echo "Password is logged on first KC start or in container /data/admin.password"
  exit 0
fi

code=$(curl -s -o /tmp/kc-me.json -w "%{http_code}" \
  -H "Authorization: Bearer $KC_TOKEN" \
  "$KC_URL/v1/me" || true)
if [[ "$code" != "200" ]]; then
  echo "WARN: /v1/me returned HTTP $code — check KC_TOKEN"
  cat /tmp/kc-me.json || true
  exit 1
fi
echo "OK: authenticated as:"
cat /tmp/kc-me.json
echo ""
