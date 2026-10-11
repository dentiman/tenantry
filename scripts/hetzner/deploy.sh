#!/usr/bin/env bash
# Розкат стеку на Hetzner (single-node Swarm). Викликається з .github/workflows/deploy.yml на
# self-hosted runner-і; те саме можна запустити вручну на сервері:
#   cd <checkout> && GITHUB_SHA=<sha> bash scripts/hetzner/deploy.sh
# Образи `saas/<app>:<sha>` уже зібрані на цьому вузлі (job build), у registry їх немає.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/hetzner/common.sh
. scripts/hetzner/common.sh
load_stack_env

COMPOSE=docker/docker-compose.stack.yml

# Ключі S3 для SeaweedFS беремо з серверного конфігу, а не з комітнутого s3.prod.json (там чужі
# тестові ключі). Файл у робочій теці runner-а перезаписується — наступний checkout його скине.
# Swarm-config незмінний: вміст стабільний, поки не змінено S3_ACCESS_KEY/S3_SECRET_KEY
cat > docker/seaweedfs/s3.prod.json <<JSON
{
  "identities": [
    {
      "name": "saas",
      "credentials": [{ "accessKey": "$S3_ACCESS_KEY", "secretKey": "$S3_SECRET_KEY" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
JSON

first_run=false
docker service inspect "${STACK_NAME}_postgres" >/dev/null 2>&1 || first_run=true

if [ "$first_run" = true ]; then
  # Перший розкат: api не стартує, доки в Postgres немає ролей (saas_migrator для міграцій), а ролі
  # створюються вже на запущеному Postgres. Тому: стек без очікування → ролі → чекаємо на api.
  # (failure_action: rollback стосується лише ОНОВЛЕНЬ, на створенні таски просто перезапускаються)
  echo "Перший розкат стеку $STACK_NAME"
  docker stack deploy --resolve-image never --detach=true -c "$COMPOSE" "$STACK_NAME"
  wait_for "postgres healthy" 300 postgres_healthy
  ensure_tools_image
  db_roles
  api_ready() { [ "$(docker service ls --filter "name=${STACK_NAME}_api" --format '{{.Replicas}}')" = "1/1" ]; }
  wait_for "api 1/1" 600 api_ready
fi

# --detach=false: чекаємо конвергенції (на першому розкаті це миттєво — усе вже піднялось)
echo "Deploy → stack=$STACK_NAME sha=$SHA"
docker stack deploy --resolve-image never --detach=false --prune -c "$COMPOSE" "$STACK_NAME"

# Пост-перевірка: сервіс мусить крутитись САМЕ на щойно зібраному образі. failure_action=rollback
# повертає старий образ, а `stack deploy` при цьому може завершитись успішно — без цієї перевірки
# зелена джоба нічого б не гарантувала (так було на GitLab-стенді, див. docs/deploy-swarm.md §6)
failed=0
check_service() {
  local actual
  actual=$(docker service inspect "${STACK_NAME}_$1" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')
  case "$actual" in
    "$2"|"$2"@*) echo "  ok    $1 → $2" ;;
    *) echo "  FAIL  $1: очікували $2, фактично $actual"; failed=1 ;;
  esac
}
check_service api          "$API_IMAGE"
check_service platform-api "$PLATFORM_API_IMAGE"
check_service worker       "$WORKER_IMAGE"
check_service web          "$WEB_IMAGE"
check_service platform-web "$PLATFORM_WEB_IMAGE"
docker stack ps "$STACK_NAME" --filter desired-state=running
if [ "$failed" -ne 0 ]; then
  echo "Деплой НЕ розкотився: swarm відкотив частину сервісів на попередній образ."
  exit 1
fi

# Наскрізна перевірка: Caddy (TLS) → nginx → api. Тут же ловиться прострочений/відсутній сертифікат
for origin in "$APP_PUBLIC_URL" "$PLATFORM_CORS_ALLOWED_ORIGINS"; do
  echo "→ $origin/api/health"
  curl -fsS --retry 12 --retry-delay 5 --retry-all-errors -m 10 "$origin/api/health"
  echo
done

# Прибирання (лише після успіху): тримаємо 3 найновіші образи кожного сервісу — попередній потрібен
# swarm для автовідкату. Образи, які ще використовуються, docker rmi не видалить.
for app in api platform-api worker web platform-web tools; do
  docker images "$IMAGE_PREFIX/$app" --format '{{.Repository}}:{{.Tag}}' | tail -n +4 | xargs -r docker rmi >/dev/null 2>&1 || true
done
docker image prune -f >/dev/null 2>&1 || true
# Кеш збірки росте з кожним SHA (шари після `COPY . .` не перевикористовуються): без межі диск 38 ГБ
# заповнюється за кілька деплоїв. Найновіші 6 ГБ лишаємо — повторні збірки лишаються швидкими
docker builder prune -f --max-used-space 6GB >/dev/null 2>&1 || true
docker system df --format '{{.Type}}: {{.Size}} ({{.Reclaimable}} reclaimable)' || true
echo "Готово."
