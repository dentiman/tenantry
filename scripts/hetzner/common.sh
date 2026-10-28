#!/usr/bin/env bash
# Спільне для scripts/hetzner/*.sh: оточення стеку, імена образів, очікування.
# Виконується self-hosted runner-ом, що живе на ТІЙ САМІЙ машині, що й Swarm-manager
# (docs/deploy-hetzner.md): `docker` дивиться на локальний демон, docker context і SSH не потрібні.
# shellcheck shell=bash

STACK_NAME="${STACK_NAME:-saas-prod}"
SERVER_ENV="${SAAS_SERVER_ENV:-/etc/saas/deploy.env}"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
IMAGE_PREFIX="${IMAGE_PREFIX:-saas}"

# Образи збираються на цьому ж вузлі й у registry НЕ пушаться (single-node): тег = SHA коміту.
export API_IMAGE="$IMAGE_PREFIX/api:$SHA"
export PLATFORM_API_IMAGE="$IMAGE_PREFIX/platform-api:$SHA"
export WORKER_IMAGE="$IMAGE_PREFIX/worker:$SHA"
export WEB_IMAGE="$IMAGE_PREFIX/web:$SHA"
export PLATFORM_WEB_IMAGE="$IMAGE_PREFIX/platform-web:$SHA"
export TOOLS_IMAGE="$IMAGE_PREFIX/tools:$SHA"
export STACK_NAME

# Конфіг стеку: спершу комітнутий docker/stack.env (несекретний, спільний з GitLab), потім
# серверний файл — усі секрети й публічні URL цього сервера (шаблон — docker/deploy.env.example).
# Серверний файл — ЄДИНЕ місце секретів Hetzner-стенда: у git і в GitHub Secrets їх немає.
load_stack_env() {
  [ -r "$SERVER_ENV" ] || { echo "Немає $SERVER_ENV — спершу налаштуй сервер (docs/deploy-hetzner.md)"; exit 1; }
  set -a
  # shellcheck disable=SC1091
  . ./docker/stack.env
  # shellcheck disable=SC1090
  . "$SERVER_ENV"
  set +a
  sh scripts/deploy/require-env.sh
  # CHAT-3b1: публічна адреса вебхуків каналів — адреса самого стенду (nginx web проксить /api, шлях
  # /api/public/channels відкритий). Серверний файл перекриває.
  export CHANNEL_WEBHOOK_BASE_URL="${CHANNEL_WEBHOOK_BASE_URL:-${APP_PUBLIC_URL:-}}"
  # Підпис вебхука ВИМАГАЄТЬСЯ (типове `enforce` зі стеку): від CHAT-3b2 вебхук Meta створює розмови й квитанції.
  # `record` (приймати й лише записувати результат) — тимчасовий режим налагодження в серверному файлі.
}

# wait_for <опис> <таймаут_с> <команда…> — повторює команду раз на 5 с, доки вона не вдасться
wait_for() {
  local what="$1" timeout="$2"; shift 2
  local waited=0
  until "$@" >/dev/null 2>&1; do
    if [ "$waited" -ge "$timeout" ]; then
      echo "ТАЙМАУТ ($timeout с): $what"
      return 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  echo "ok: $what (${waited} с)"
}

postgres_healthy() {
  docker ps --filter "name=${STACK_NAME}_postgres" --filter health=healthy -q | grep -q .
}

# Образ one-shot-інструментів (db:roles / db:seed / …). Шари кешуються на вузлі — повторна збірка швидка
ensure_tools_image() {
  echo "→ образ tools ($TOOLS_IMAGE)"
  DOCKER_BUILDKIT=1 docker build -f Dockerfile.tools -t "$TOOLS_IMAGE" .
}

# run_tools <docker run аргументи…> -- команда у контейнері tools, в overlay-мережі стеку
run_tools() {
  docker run --rm --network "${STACK_NAME}_saas_net" "$@"
}

# db:roles — одноразово, ДО першого старту api (saas_migrator мусить існувати для міграцій).
# Ідемпотентний. Паролі ролей — DB_*_PASSWORD із load_stack_env (застосовуються й до наявних ролей).
# Postgres може ще ініціалізуватись — повторюємо
db_roles() {
  local i
  for i in $(seq 1 30); do
    if run_tools \
      -e POSTGRES_ADMIN_URL="postgresql://${POSTGRES_USER:-saas}:${POSTGRES_PASSWORD}@postgres:5432/postgres" \
      -e DATABASE_URL="postgresql://saas_app:${DB_APP_PASSWORD}@postgres:5432/${POSTGRES_DB:-saas_skeleton}" \
      -e DB_APP_PASSWORD -e DB_MIGRATOR_PASSWORD -e DB_PLATFORM_PASSWORD \
      "$TOOLS_IMAGE" pnpm db:roles; then
      return 0
    fi
    echo "[db_roles] postgres ще не готовий (спроба $i/30) — чекаю 5 с…"
    sleep 5
  done
  echo "[db_roles] не вдалося за 30 спроб"
  return 1
}
