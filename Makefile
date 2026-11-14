# NutritionDictionary: local test targets. See docs/LOCAL_TESTING.md for the full
# checklist and what each step should print.
#
#   make help          list targets
#   make setup         install deps (web + desktop + CDK example)
#   make dev           next dev on http://127.0.0.1:3000
#   make check         lint + typecheck + test + build (same as CI)
#   make preview       production build, standalone server on :3000
#   make docker        build + run the Docker image on :3000 (Ctrl+C stops it)
#   make docker-test   build, run detached, wait for HEALTHCHECK, smoke test, remove
#   make lambda-local  build + smoke test the Lambda image (arm64) on :9000
#   make cdk-synth     typecheck + synth the AWS CDK example (no AWS account)
#   make desktop       Electron app in dev mode
#   make desktop-pack  package the macOS app into electron-app/dist/
#   make smoke URL=... smoke test any running server

SHELL := /bin/bash
WEB   := food-nutrition-app
DESK  := electron-app
CDK   := docs/aws/infra-example/cdk
SMOKE := node $(WEB)/scripts/smoke.mjs

IMAGE        ?= nutrition-dictionary
LAMBDA_IMAGE ?= nutrition-dictionary-lambda
# linux/arm64 = the Lambda architecture in the CDK example (native on Apple
# silicon). Use LAMBDA_PLATFORM=linux/amd64 to test an x86_64 Lambda image.
LAMBDA_PLATFORM ?= linux/arm64
PORT ?= 3000
URL  ?= http://127.0.0.1:$(PORT)

.DEFAULT_GOAL := help
.PHONY: help setup dev check preview smoke docker docker-test lambda-local cdk-synth desktop desktop-pack clean

help:
	@sed -n 's/^#   make /  make /p' $(MAKEFILE_LIST)

setup:
	./setup.sh --with-electron
	cd $(CDK) && npm ci --no-audit --no-fund

dev:
	cd $(WEB) && npx next dev --hostname 127.0.0.1 --port $(PORT)

check:
	cd $(WEB) && npm run check

preview:
	cd $(WEB) && PORT=$(PORT) npm run preview

smoke:
	$(SMOKE) $(URL) --wait 30

docker:
	docker build -t $(IMAGE) .
	docker run --rm -it -p $(PORT):3000 --name nutrition-dictionary-local $(IMAGE)

docker-test:
	docker build -t $(IMAGE) .
	docker rm -f nutrition-dictionary-test >/dev/null 2>&1 || true
	docker run -d --name nutrition-dictionary-test -p $(PORT):3000 --health-interval 2s $(IMAGE) >/dev/null
	@for i in $$(seq 1 30); do \
	  s=$$(docker inspect -f '{{.State.Health.Status}}' nutrition-dictionary-test); \
	  [ "$$s" = healthy ] && { echo "container health: $$s"; break; }; sleep 2; \
	done; \
	[ "$$(docker inspect -f '{{.State.Health.Status}}' nutrition-dictionary-test)" = healthy ] \
	  || { docker logs nutrition-dictionary-test; docker rm -f nutrition-dictionary-test >/dev/null; exit 1; }
	$(SMOKE) http://127.0.0.1:$(PORT) --wait 30 || { docker rm -f nutrition-dictionary-test >/dev/null; exit 1; }
	docker rm -f nutrition-dictionary-test >/dev/null

# Run like Lambda does: read-only root filesystem with a writable /tmp, a
# non-root user and Lambda-style memory. The adapter stays idle outside Lambda,
# so the container answers HTTP directly on port 3000 (mapped to 9000 here).
lambda-local:
	docker build --platform $(LAMBDA_PLATFORM) -f docs/aws/infra-example/Dockerfile.lambda -t $(LAMBDA_IMAGE) .
	docker rm -f nutrition-dictionary-lambda >/dev/null 2>&1 || true
	docker run -d --name nutrition-dictionary-lambda --platform $(LAMBDA_PLATFORM) -p 9000:3000 \
	  --read-only --tmpfs /tmp --memory 1024m --user 993:990 $(LAMBDA_IMAGE) >/dev/null
	$(SMOKE) http://127.0.0.1:9000 --wait 60 || { docker logs nutrition-dictionary-lambda; docker rm -f nutrition-dictionary-lambda >/dev/null; exit 1; }
	docker rm -f nutrition-dictionary-lambda >/dev/null

cdk-synth:
	cd $(CDK) && npm ci --no-audit --no-fund && npm run typecheck && npx cdk synth --quiet && npx cdk synth --quiet -c stage=prod

desktop:
	cd $(DESK) && npm start

desktop-pack:
	cd $(DESK) && npm run pack

clean:
	rm -rf $(WEB)/.next $(DESK)/staging $(DESK)/dist $(CDK)/cdk.out
