#!/bin/sh
set -eu
: "${KC_UPSTREAM:=http://kc-knowledge-core:8080}"
: "${MCP_UPSTREAM:=http://127.0.0.1:3100}"
mkdir -p /tmp/nginx/client_temp /tmp/nginx/proxy_temp \
  /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp
envsubst '${KC_UPSTREAM} ${MCP_UPSTREAM}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf
exec nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
