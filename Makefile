VERSION ?= $(shell sed -n 's/^appVersion: *"\(.*\)"/\1/p' deploy/helm/knowledge-itmap/Chart.yaml)

.PHONY: helm-lint podman-build podman-build-mcp set-chart-version test typecheck build

helm-lint:
	helm lint deploy/helm/knowledge-itmap

# Sync Chart.yaml version + appVersion (default image/mcpImage tag).
# Example: make VERSION=1.2.3 set-chart-version
set-chart-version:
	./deploy/helm/scripts/set-chart-version.sh "$(VERSION)"

# Image tags match Chart appVersion (override with VERSION=…).
podman-build:
	podman build -f deploy/Dockerfile -t ghcr.io/l-ra/knowledge-itmap:$(VERSION) .

podman-build-mcp:
	podman build -f deploy/Dockerfile.mcp -t ghcr.io/l-ra/knowledge-itmap-mcp:$(VERSION) .

test:
	npm test

typecheck:
	npm run typecheck

build:
	npm run build
	npm run mcp:build
