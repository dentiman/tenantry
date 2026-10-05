#!/usr/bin/env bash
# Повна перевірка коміту перед збіркою образів: lint (з ai:knowledge:check) → typecheck →
# unit → e2e обох API. Це джоба `verify` стадії check у .gitlab-ci.yml; локально той самий
# прогін — `bash scripts/ci-verify.sh` (потрібен лише Docker, dev-стек не чіпає).
#
# Усе живе в одноразових контейнерах на власній docker-мережі: Postgres (той самий
# pgvector-образ і digest, що в dev/prod/Swarm) і Valkey. Checkout монтується read-only і
# копіюється всередину node-контейнера: shell-executor тримає робочу теку між джобами, а
# root-овий node_modules, створений контейнером, раннер потім не зміг би прибрати.
# `pnpm build` тут не повторюємо — збірку роблять образи стадії build, яка стартує лише
# після зеленої стадії check.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_ID="saas-verify-${CI_JOB_ID:-local-$$}"
PG_IMAGE='pgvector/pgvector:0.8.6-pg17-bookworm@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f'
VALKEY_IMAGE='valkey/valkey:8-alpine'
NODE_IMAGE='node:24-bookworm-slim'
# Іменований том — кеш pnpm store між прогонами (раннер персистентний)
PNPM_STORE_VOLUME='saas-verify-pnpm-store'

cleanup() {
  docker rm -f "$RUN_ID-pg" "$RUN_ID-valkey" >/dev/null 2>&1 || true
  docker network rm "$RUN_ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$RUN_ID" >/dev/null
docker run -d --name "$RUN_ID-pg" --network "$RUN_ID" --network-alias postgres \
  -e POSTGRES_USER=saas -e POSTGRES_PASSWORD=saas -e POSTGRES_DB=saas_skeleton \
  "$PG_IMAGE" >/dev/null
docker run -d --name "$RUN_ID-valkey" --network "$RUN_ID" --network-alias valkey \
  "$VALKEY_IMAGE" >/dev/null

for i in $(seq 1 30); do
  if docker exec "$RUN_ID-pg" pg_isready -U saas -d saas_skeleton >/dev/null 2>&1; then break; fi
  if [ "$i" -eq 30 ]; then echo "Postgres не піднявся за 60с"; exit 1; fi
  sleep 2
done

docker run --rm --network "$RUN_ID" \
  -v "$REPO_DIR:/src:ro" \
  -v "$PNPM_STORE_VOLUME:/root/.local/share/pnpm/store" \
  -e CI=true \
  -e HUSKY=0 \
  -e DATABASE_URL=postgresql://saas_app:saas_app@postgres:5432/saas_skeleton \
  -e MIGRATE_DATABASE_URL=postgresql://saas_migrator:saas_migrator@postgres:5432/saas_skeleton \
  -e PLATFORM_DATABASE_URL=postgresql://saas_platform:saas_platform@postgres:5432/saas_skeleton \
  -e POSTGRES_ADMIN_URL=postgresql://saas:saas@postgres:5432/postgres \
  -e REDIS_URL=redis://valkey:6379 \
  -e JWT_SECRET=ci-only-secret-not-for-production-min-32-chars \
  -e PLATFORM_JWT_SECRET=ci-only-platform-secret-not-for-production-32chars \
  "$NODE_IMAGE" bash -euo pipefail -c '
    mkdir -p /work
    tar -C /src --exclude=./node_modules --exclude="*/node_modules" --exclude=./.turbo \
      --exclude=./.env --exclude=./.env.local -cf - . | tar -C /work -xf -
    cd /work
    echo "verify: $(nproc) CPU, $(awk "/MemTotal/ {print int(\$2/1024)}" /proc/meminfo) MB RAM, node heap limit $(node -p "Math.round(require(\"v8\").getHeapStatistics().heap_size_limit/1048576)") MB"
    corepack enable
    npm pkg delete scripts.prepare
    pnpm install --frozen-lockfile
    pnpm db:generate
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm api:test:e2e
    pnpm platform:test:e2e
  '
