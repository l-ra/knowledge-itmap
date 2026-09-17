.PHONY: helm-lint podman-build podman-build-mcp test typecheck build

helm-lint:
	helm lint deploy/helm/knowledge-itmap

podman-build:
	podman build -f deploy/Dockerfile -t ghcr.io/l-ra/knowledge-itmap:dev .

podman-build-mcp:
	podman build -f deploy/Dockerfile.mcp -t ghcr.io/l-ra/knowledge-itmap-mcp:dev .

test:
	npm test

typecheck:
	npm run typecheck

build:
	npm run build
	npm run mcp:build
