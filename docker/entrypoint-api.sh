#!/bin/sh
# Entrypoint ЛИШЕ для сервісу api: застосувати міграції ДО старту, потім віддати процес апці.
#
# Міграції йдуть під saas_migrator (MIGRATE_DATABASE_URL), рантайм апки — під saas_app
# (DATABASE_URL). prisma.config.ts читає саме MIGRATE_DATABASE_URL (див. libs/database).
#
# ВАЖЛИВО: ролі saas_migrator/saas_app/saas_platform мусять уже існувати (одноразовий
# `pnpm db:roles` через tools-образ — див. .gitlab-ci.yml job `db_roles`), інакше
# migrate впаде на правах. На single-node з replicas:1 гонки міграцій немає.
set -eu

echo "[entrypoint-api] prisma migrate deploy (saas_migrator)…"
cd /usr/src/app/libs/database
# Postgres може перезапускатися в тому самому `stack deploy` (новий образ, stop-first) —
# тоді migrate отримує P1001, таск падає, і `failure_action: rollback` відкочує api.
# Спіймано 2026-10-05 (postgres:17-alpine → pgvector). Тому P1001 («сервер недоступний»)
# ретраїмо, а будь-яку іншу помилку міграції — ні: вона має валити таск одразу.
# Бюджет 24×5с = 120с вкладається в healthcheck api (start_period 40s + 3×30s).
attempt=1
while :; do
  # .bin/prisma — це shell-шим (pnpm+shamefully-hoist), запускаємо НАПРЯМУ (не через node)
  if out=$(/usr/src/app/node_modules/.bin/prisma migrate deploy 2>&1); then
    echo "$out"
    break
  fi
  echo "$out"
  case "$out" in
    *P1001*) ;;
    *) exit 1 ;;
  esac
  if [ "$attempt" -ge 24 ]; then
    echo "[entrypoint-api] postgres недоступний 120с — здаюсь"
    exit 1
  fi
  echo "[entrypoint-api] postgres недоступний (спроба $attempt/24) — чекаю 5с…"
  attempt=$((attempt + 1))
  sleep 5
done
cd /usr/src/app

echo "[entrypoint-api] starting api…"
exec node apps/api/dist/main.js
