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
# .bin/prisma — це shell-шим (pnpm+shamefully-hoist), запускаємо НАПРЯМУ (не через node)
/usr/src/app/node_modules/.bin/prisma migrate deploy
cd /usr/src/app

echo "[entrypoint-api] starting api…"
exec node apps/api/dist/main.js
