#!/usr/bin/env bash
# Import kc-base + archimate-lite 2.3.0 and optional demo seed into local Knowledge Core.
set -euo pipefail

KC_URL="${KC_BASE_URL:-http://localhost:8080}"
KC_ROOT="${KC_ROOT:-$(cd "$(dirname "$0")/../../knowledge-core" && pwd)}"
TOKEN="${KC_TOKEN:?Set KC_TOKEN to bootstrap password or Bearer token}"

auth=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

echo "KC_ROOT=$KC_ROOT"
echo "KC_URL=$KC_URL"

kc_base="$KC_ROOT/models/kc-base/releases/kc-base-1.0.0.bundle.json"
aml="$KC_ROOT/models/archimate-lite/releases/archimate-lite-2.3.0.bundle.json"

if [[ ! -f "$kc_base" ]]; then
  echo "Missing $kc_base"
  exit 1
fi
if [[ ! -f "$aml" ]]; then
  echo "Missing $aml"
  exit 1
fi

echo "Importing kc-base 1.0.0 …"
curl -sf "${auth[@]}" --data-binary @"$kc_base" "$KC_URL/v1/releases/import" | head -c 200
echo ""

echo "Importing archimate-lite 2.3.0 …"
curl -sf "${auth[@]}" --data-binary @"$aml" "$KC_URL/v1/releases/import" | head -c 200
echo ""

# Ensure instanceOfProperty if empty
cfg=$(curl -sf -H "Authorization: Bearer $TOKEN" "$KC_URL/v1/admin/schema-config")
if echo "$cfg" | grep -q '"instanceOfProperty":\s*""\|"instanceOfProperty":\s*null\|instanceOfProperty": ""'; then
  echo "Setting instanceOfProperty …"
  curl -sf "${auth[@]}" -X PUT "$KC_URL/v1/admin/schema-config" \
    -d '{"instanceOfProperty":"https://knowledge-core.local/kc-base/instanceOf"}'
  echo ""
fi

if [[ "${SEED_DEMO:-1}" == "1" ]] && [[ -f "$KC_ROOT/models/archimate-lite-demo/load.py" ]]; then
  echo "Loading demo instance (archimate-lite-demo) …"
  export KC_BASE_URL="$KC_URL"
  export KC_TOKEN="$TOKEN"
  (cd "$KC_ROOT" && python3 models/archimate-lite-demo/load.py) || {
    echo "Demo loader failed — metamodel is imported; create org package in IT Map UI."
  }
fi

# Ensure org-demo package exists
echo "Ensuring org-demo package …"
curl -sf "${auth[@]}" -H "Idempotency-Key: itmap-org-demo" \
  -d '{
    "code":"org-demo",
    "lifecycle":"continuous",
    "iriBase":"https://example.org/org-demo/",
    "labels":{"en":"Org Demo","cs":"Org Demo"},
    "descriptions":{"en":"IT Map demo organization package","cs":"Demo package organizace IT Map"},
    "dependencies":[{"dependsOnCode":"archimate-lite","versionRange":"^2.3.0"}]
  }' "$KC_URL/v1/packages" >/dev/null 2>&1 || true

echo "Done. Open IT Map (npm run dev) → Settings → set token → Browser."
