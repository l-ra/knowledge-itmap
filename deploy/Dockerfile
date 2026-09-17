# Multi-stage: build Vite SPA on BUILDPLATFORM, serve via nginx for TARGETPLATFORM.
FROM --platform=$BUILDPLATFORM node:22-bookworm AS ui
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY server/package.json ./server/package.json
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY src ./src
RUN npm ci && npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache gettext
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/docker-entrypoint-ui.sh /docker-entrypoint-ui.sh
RUN chmod +x /docker-entrypoint-ui.sh
COPY --from=ui /app/dist /usr/share/nginx/html
ENV KC_UPSTREAM=http://kc-knowledge-core:8080
ENV MCP_UPSTREAM=http://itmap-knowledge-itmap-mcp:3100
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint-ui.sh"]
