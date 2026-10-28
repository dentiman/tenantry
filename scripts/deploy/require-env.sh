#!/bin/sh
# Перевірка секретного env стенда перед розкатом — спільна для Hetzner (scripts/hetzner/common.sh) і
# GitLab (.gitlab-ci.yml). Викликати ПІСЛЯ `. docker/stack.env; . <секретний файл>`.
# Без неї порожній секрет тихо інтерполювався б у стек як "" і падав би вже всередині сервісу.
# POSIX sh: GitLab-раннер виконує before_script не в bash.
missing=""
for v in POSTGRES_PASSWORD DB_APP_PASSWORD DB_MIGRATOR_PASSWORD DB_PLATFORM_PASSWORD \
  JWT_SECRET PLATFORM_JWT_SECRET ENCRYPTION_KEY REDIS_PASSWORD S3_ACCESS_KEY S3_SECRET_KEY \
  APP_PUBLIC_URL REALTIME_ALLOWED_ORIGINS PLATFORM_CORS_ALLOWED_ORIGINS S3_ENDPOINT S3_CORS_ALLOWED_ORIGINS; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || missing="$missing $v"
done
if [ -n "$missing" ]; then
  echo "Секретний env стенда неповний, бракує:$missing (шаблон — docker/deploy.env.example)" >&2
  exit 1
fi
