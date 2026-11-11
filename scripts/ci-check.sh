#!/usr/bin/env bash
# Дешева серверна перевірка коміту: `pnpm lint` + `pnpm typecheck` + `pnpm codegen:check` в одноразовому контейнері —
# без Postgres/Valkey і без e2e (їх робить повний scripts/ci-verify.sh, ручний). Це той самий
# офлайн-набір, що локальний pre-push (scripts/pre-push-gate.sh), тільки на чистому checkout-і.
# Використовує .github/workflows/check.yml; локально — `bash scripts/ci-check.sh` (потрібен лише Docker).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_IMAGE='node:24-bookworm-slim'
PNPM_STORE_VOLUME='saas-verify-pnpm-store'

docker run --rm \
  -v "$REPO_DIR:/src:ro" \
  -v "$PNPM_STORE_VOLUME:/root/.local/share/pnpm/store" \
  -e CI=true \
  -e HUSKY=0 \
  -e DATABASE_URL=postgresql://saas_app:saas_app@postgres:5432/saas_skeleton \
  -e MIGRATE_DATABASE_URL=postgresql://saas_migrator:saas_migrator@postgres:5432/saas_skeleton \
  "$NODE_IMAGE" bash -euo pipefail -c '
    mkdir -p /work
    tar -C /src --exclude=./node_modules --exclude="*/node_modules" --exclude=./.turbo \
      --exclude=./.env --exclude=./.env.local --exclude="./apps/*/logs" -cf - . | tar -C /work -xf -
    cd /work
    corepack enable
    npm pkg delete scripts.prepare
    pnpm install --frozen-lockfile
    pnpm db:generate
    pnpm lint
    pnpm typecheck
    pnpm codegen:check
  '
