#!/usr/bin/env bash
# Drift-перевірка конвейера Zod → OpenAPI → orval (AGENTS.md «Type pipeline»): перегенеровує обидві
# площини і падає, якщо закомічені артефакти розійшлись із тим, що видає генератор.
#
#   pnpm codegen:check
#
# Порядок: openapi:generate → web:codegen, platform:openapi:generate → platform:web:codegen.
# БД, Valkey і workspace-слот НЕ потрібні (Nest піднімає лише DI-граф без з'єднань); потрібен
# згенерований Prisma-клієнт (`pnpm db:generate`, офлайн) і node_modules.
#
# Порівнюється стан робочої теки ДО генерації зі станом ПІСЛЯ (а не `git diff`): так перевірка
# не залежить від того, закомічені вже правки, і ловить нові/зайві файли. Дрейф лишається на
# диску перегенерованим — перегляньте `git diff` і закомітьте разом із контрактом.
#
# Оточення зафіксоване (`env -i` + dummy-секрети), щоб результат не залежав від локальних
# `.env`/`.env.local`: схема env валідується на старті, але OpenAPI від значень не залежить.
set -euo pipefail
cd "$(dirname "$0")/.."

PATHS=(
  apps/api/openapi.json
  apps/platform-api/openapi.json
  apps/web/src/api/generated
  apps/platform-web/src/api/generated
)

snapshot="$(mktemp -d)"
trap 'rm -rf "$snapshot"' EXIT
for p in "${PATHS[@]}"; do
  if [ -e "$p" ]; then mkdir -p "$snapshot/$(dirname "$p")" && cp -R "$p" "$snapshot/$p"; fi
done

run() {
  env -i PATH="$PATH" HOME="$HOME" CI="${CI:-}" \
    JWT_SECRET=codegen-check-secret-not-for-production-32chars \
    PLATFORM_JWT_SECRET=codegen-check-platform-secret-not-for-production-32 \
    ENCRYPTION_KEY=SsjVoRkl29TwYnoLd9opr2TfJ4aNMeC7bax8ZBkFg80= \
    "$@"
}

echo "codegen:check → tenant API"
run pnpm openapi:generate >/dev/null
run pnpm web:codegen >/dev/null
echo "codegen:check → platform API"
run pnpm platform:openapi:generate >/dev/null
run pnpm platform:web:codegen >/dev/null

drift=0
for p in "${PATHS[@]}"; do
  if [ -e "$snapshot/$p" ]; then
    diff -rq "$snapshot/$p" "$p" >&2 || drift=1
  else
    echo "новий артефакт: $p" >&2
    drift=1
  fi
done

if [ "$drift" != 0 ]; then
  cat >&2 <<'MSG'

codegen:check: закомічені артефакти застаріли (відрізняються від результату генерації).
Файли вже перегенеровано на диску: перегляньте `git diff` і закомітьте їх разом зі зміною
контракту/контролера (AGENTS.md — «Generated OpenAPI/orval artifacts are committed»).
MSG
  exit 1
fi
echo "codegen:check: артефакти актуальні"
