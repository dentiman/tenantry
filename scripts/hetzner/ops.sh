#!/usr/bin/env bash
# Разові операції над стеком на Hetzner. Викликається з .github/workflows/ops.yml
# (кнопка «Run workflow»); вручну: `bash scripts/hetzner/ops.sh <action>`.
#   db_roles    ролі Postgres (ідемпотентно; сам розкат уже робить це на першому запуску)
#   seed        базові ідентичності: тенант `default`, адмін, оператор платформи
#   seed_demo   демо-датасет трьох галузевих тенантів (docs/demo.md), без індексації знань AI
#   demo_reset  скинути демо-тенанти до чистого стану
#   backup_db   pg_dump у /srv/saas-prod/backups (15 останніх)
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/hetzner/common.sh
. scripts/hetzner/common.sh
load_stack_env

action="${1:?usage: ops.sh <db_roles|seed|seed_demo|demo_reset|backup_db>}"

DB="${POSTGRES_DB:-saas_skeleton}"
PLATFORM_DB_URL="postgresql://saas_platform:${DB_PLATFORM_PASSWORD:?}@postgres:5432/$DB"
APP_DB_URL="postgresql://saas_app:${DB_APP_PASSWORD:?}@postgres:5432/$DB"

case "$action" in
  db_roles)
    ensure_tools_image
    db_roles
    ;;
  seed)
    ensure_tools_image
    run_tools -e PLATFORM_DATABASE_URL="$PLATFORM_DB_URL" \
      -e SEED_ADMIN_PASSWORD -e SEED_PLATFORM_PASSWORD \
      "$TOOLS_IMAGE" pnpm db:seed
    ;;
  seed_demo)
    ensure_tools_image
    run_tools -e PLATFORM_DATABASE_URL="$PLATFORM_DB_URL" -e DATABASE_URL="$APP_DB_URL" \
      -e SEED_ADMIN_PASSWORD -e SEED_PLATFORM_PASSWORD \
      "$TOOLS_IMAGE" sh -c 'pnpm db:seed && pnpm db:seed:demo'
    ;;
  demo_reset)
    ensure_tools_image
    run_tools -e PLATFORM_DATABASE_URL="$PLATFORM_DB_URL" -e DATABASE_URL="$APP_DB_URL" \
      -e SEED_ADMIN_PASSWORD -e SEED_PLATFORM_PASSWORD \
      "$TOOLS_IMAGE" sh -c 'pnpm db:seed && pnpm db:seed:demo:reset'
    ;;
  backup_db)
    dir=/srv/saas-prod/backups
    mkdir -p "$dir"
    cid=$(docker ps --filter "name=${STACK_NAME}_postgres" --format '{{.ID}}' | head -1)
    [ -n "$cid" ] || { echo "Контейнер postgres не знайдено"; exit 1; }
    out="$dir/saas_$(date +%Y%m%d_%H%M%S).sql.gz"
    docker exec "$cid" pg_dump -U "${POSTGRES_USER:-saas}" -d "$DB" | gzip > "$out"
    ls -lh "$out"
    ls -1t "$dir"/saas_*.sql.gz | tail -n +16 | xargs -r rm -f
    ;;
  *)
    echo "Невідома дія: $action"
    exit 2
    ;;
esac
