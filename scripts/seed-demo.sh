#!/usr/bin/env bash
# Import kc-base + archimate-lite + archimate-ui-traversal
# + archimate-ui-cards 1.1.1 and optional demo seed into local Knowledge Core.
# Bundles live in sibling repo knowledge-models (not knowledge-core).
set -euo pipefail

KC_URL="${KC_BASE_URL:-http://localhost:8080}"
MODELS_ROOT="${KNOWLEDGE_MODELS_PATH:-${MODELS_ROOT:-$(cd "$(dirname "$0")/../../knowledge-models" && pwd)}}"
TOKEN="${KC_TOKEN:?Set KC_TOKEN to bootstrap password or Bearer token}"

auth=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

echo "MODELS_ROOT=$MODELS_ROOT"
echo "KC_URL=$KC_URL"

kc_base="$MODELS_ROOT/kc-base/releases/kc-base-1.1.0.bundle.json"
aml="$MODELS_ROOT/archimate-lite/releases/archimate-lite-3.2.1.bundle.json"
ui_trav="$MODELS_ROOT/archimate-ui-traversal/releases/archimate-ui-traversal-1.0.0.bundle.json"

for f in "$kc_base" "$aml" "$ui_trav"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f"
    echo "Checkout knowledge-models next to knowledge-core (or set KNOWLEDGE_MODELS_PATH)."
    exit 1
  fi
done

echo "Importing kc-base 1.1.0 …"
curl -sf "${auth[@]}" --data-binary @"$kc_base" "$KC_URL/v1/releases/import" | head -c 200
echo ""

echo "Importing archimate-lite 3.1.0 …"
curl -sf "${auth[@]}" --data-binary @"$aml" "$KC_URL/v1/releases/import" | head -c 200
echo ""

echo "Importing archimate-ui-traversal 1.0.0 …"
curl -sf "${auth[@]}" --data-binary @"$ui_trav" "$KC_URL/v1/releases/import" | head -c 200
echo ""

ui_cards="$MODELS_ROOT/archimate-ui-cards/releases/archimate-ui-cards-1.1.1.bundle.json"
if [[ -f "$ui_cards" ]]; then
  echo "Importing archimate-ui-cards 1.1.1 …"
  curl -sf "${auth[@]}" --data-binary @"$ui_cards" "$KC_URL/v1/releases/import" | head -c 200
  echo ""
else
  echo "WARN: missing $ui_cards — Karty mode will have no presentation profiles"
fi

# Ensure instanceOfProperty if empty
cfg=$(curl -sf -H "Authorization: Bearer $TOKEN" "$KC_URL/v1/admin/schema-config")
if echo "$cfg" | grep -q '"instanceOfProperty":\s*""\|"instanceOfProperty":\s*null\|instanceOfProperty": ""'; then
  echo "Setting instanceOfProperty …"
  curl -sf "${auth[@]}" -X PUT "$KC_URL/v1/admin/schema-config" \
    -d '{"instanceOfProperty":"https://knowledge-core.local/kc-base/instanceOf"}'
  echo ""
fi

if [[ "${SEED_DEMO:-1}" == "1" ]] && [[ -f "$MODELS_ROOT/archimate-lite-demo/load.py" ]]; then
  echo "Loading demo instance (archimate-lite-demo) …"
  export KC_BASE_URL="$KC_URL"
  export KC_TOKEN="$TOKEN"
  (cd "$MODELS_ROOT" && python3 archimate-lite-demo/load.py) || {
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
    "dependencies":[
      {"dependsOnCode":"archimate-lite","versionRange":"^3.1.0"}
    ]
  }' "$KC_URL/v1/packages" >/dev/null 2>&1 || true

echo "Done. Open IT Map (npm run dev) → Settings → set token → Browser."
