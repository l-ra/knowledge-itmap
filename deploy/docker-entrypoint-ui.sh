#!/bin/sh
set -eu
: "${KC_UPSTREAM:=http://kc-knowledge-core:8080}"
: "${MCP_UPSTREAM:=http://127.0.0.1:3100}"
envsubst '${KC_UPSTREAM} ${MCP_UPSTREAM}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
