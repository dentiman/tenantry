#!/bin/sh
# docker/seaweedfs/s3.prod.json — identity SeaweedFS для стеку (configs.s3_config у
# docker/docker-compose.stack.yml) з S3_ACCESS_KEY/S3_SECRET_KEY секретного env стенда.
# Файл не комітиться (.gitignore): ключі живуть лише в секретному env.
# Swarm-config незмінний: вміст стабільний, поки не змінено ключі; їхня зміна потребує нового
# імені config-обʼєкта (docs/deploy-hetzner.md).
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
