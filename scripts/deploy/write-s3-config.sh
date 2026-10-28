#!/bin/sh
# docker/seaweedfs/s3.prod.json — identity SeaweedFS для стеку (configs.s3_config у
# docker/docker-compose.stack.yml) з S3_ACCESS_KEY/S3_SECRET_KEY секретного env стенда.
# Файл не комітиться (.gitignore): ключі живуть лише в секретному env.
# Swarm-config незмінний (оновити вміст під тим самим іменем не можна), тому імʼя config-обʼєкта
# містить хеш вмісту: скрипт друкує його в stdout, виклик експортує як S3_CONFIG_HASH
# (configs.s3_config.name у стеку). Нові ключі → новий хеш → новий обʼєкт, а не помилка розкату.
set -eu
cd "$(dirname "$0")/../.."
: "${S3_ACCESS_KEY:?}" "${S3_SECRET_KEY:?}"
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
{ sha256sum docker/seaweedfs/s3.prod.json 2>/dev/null || shasum -a 256 docker/seaweedfs/s3.prod.json; } | cut -c1-12
