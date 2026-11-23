# Варианты деплоймента Tenantry / saas-skeleton

Практическое руководство по размещению именно этой инфраструктуры. Документ отвечает на вопросы:
что уже есть в проекте, какие процессы должны быть отдельными, где хранить базу и файлы, как
работает realtime, нужен ли registry и какой вариант выбрать — от одного дешёвого VPS до
production-архитектуры с managed-сервисами.

## 1. Что фактически нужно развернуть

Это не один Node.js-сервис. В репозитории есть две плоскости продукта и пять deployable-приложений:

```text
Tenant plane
  web              React/Vite SPA, nginx runtime, проксирует /api
  api              NestJS HTTP API + Socket.IO realtime gateway

Control plane
  platform-web     React/Vite SPA для операторов
  platform-api     отдельный NestJS API с отдельной auth/JWT-конфигурацией

Background plane
  worker           NestJS worker без HTTP-порта: pg-boss, email, AI, интеграции, cron/subscribers

Stateful infrastructure
  PostgreSQL 17 + pgvector
  pg-boss в той же PostgreSQL
  Valkey/Redis-compatible broker для Socket.IO Redis Streams adapter, presence и throttling
  S3-compatible object storage для файлов
  SMTP-провайдер для email
```

Текущие Docker-образы уже разделены следующим образом:

| Составляющая | Образ / роль | Публичный трафик |
|---|---|---|
| `api` | `Dockerfile.node`, `APP=api` | HTTP `/api` и WebSocket `/socket.io/` через web nginx |
| `platform-api` | `Dockerfile.node`, `APP=platform-api` | HTTP `/api` через platform-web nginx |
| `worker` | `Dockerfile.node`, `APP=worker` | HTTP-порта нет |
| `web` | `Dockerfile.web`, `APP=web` | SPA tenant plane |
| `platform-web` | `Dockerfile.web`, `APP=platform-web` | SPA control plane |
| `tools` | `Dockerfile.tools` | one-shot: роли БД, миграции, seed, ops |
| PostgreSQL | `pgvector/pgvector:...pg17...` | только внутренняя сеть |
| Realtime broker | `valkey/valkey:8-alpine` | только внутренняя сеть |
| Files | `SeaweedFS` в S3-режиме | браузер получает presigned URL |

### Главные особенности, которые влияют на выбор инфраструктуры

1. **PostgreSQL — источник правды.** Здесь не только бизнес-данные: pg-boss хранит очереди,
   transactional outbox, inbox/idempotency и DLQ. Простая замена Postgres на «любую SQL-базу»
   не подходит.
2. **Нужен pgvector.** AI-поиск использует PostgreSQL extension `vector` и одновременно Postgres
   full-text search. Обычный PostgreSQL без pgvector не является эквивалентным вариантом.
3. **RLS — граница tenant-изоляции.** Приложение использует разные database roles:
   `saas_app`, `saas_migrator`, `saas_platform`. Нельзя давать API owner/BYPASSRLS-права.
4. **Worker — отдельный процесс.** Его нельзя прятать внутрь HTTP API: у него собственный lifecycle,
   polling pg-boss, email/AI/integration jobs и отдельные scaling/rollback-сценарии.
5. **Realtime — не основная очередь.** Socket.IO + Redis Streams/Valkey доставляют live-сигнал;
   состояние и REST-resync находятся в PostgreSQL. Потеря socket-события не должна означать
   потерю бизнес-данных.
6. **S3 — часть контракта файлов.** Backend выдаёт presigned URL, браузер грузит файл напрямую,
   а база хранит metadata и object key. Хранилище должно поддерживать S3 API и стабильный endpoint.
7. **Миграции должны идти отдельно от обычного старта.** `tools`/migration job использует роль
   `saas_migrator`; runtime API работает под `saas_app`.

## 2. Базовая схема потоков

```text
Browser
  ├─ tenant.example.com     -> web -> api:3001
  ├─ platform.example.com   -> platform-web -> platform-api:3002
  └─ files.example.com      -> S3-compatible storage (presigned URL)

api / platform-api / worker
  ├─ PostgreSQL + pgvector
  ├─ pg-boss в PostgreSQL (jobs, retry, DLQ, outbox)
  ├─ Valkey (Socket.IO Redis Streams, presence, throttling)
  ├─ SMTP (worker)
  └─ external AI / WhatsApp provider (worker или соответствующий API-flow)
```

Для production желательно сохранить эти смысловые границы даже если физически часть контейнеров
находится на одном сервере.

## 3. Вариант 0 — локальная разработка

**Цель:** быстро запустить весь проект на ноутбуке и не имитировать production сложнее, чем нужно.

```text
Host machine
  ├─ pnpm api:dev
  ├─ pnpm worker:dev
  ├─ pnpm web:dev
  ├─ pnpm platform:dev
  └─ pnpm platform:web:dev

Docker Compose
  ├─ PostgreSQL 17 + pgvector
  ├─ Valkey
  ├─ Mailpit
  └─ SeaweedFS S3
```

Команды уже есть в `README.md` и `package.json`:

```bash
cp .env.example .env
pnpm install
pnpm docker:up
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed
pnpm api:dev
pnpm worker:dev
pnpm web:dev
pnpm platform:dev
pnpm platform:web:dev
```

**Registry не нужен.** Локальные приложения запускаются из исходников. Docker используется только
для stateful-зависимостей. Mailpit и SeaweedFS — dev-инструменты, в production их роли заменяются
SMTP-провайдером и managed S3 либо надёжным S3-compatible storage.

## 4. Вариант 1 — один VPS, Docker Compose, минимальная стоимость

**Для:** demo, MVP, небольшой внутренней системы, стабильной нагрузки и понятного downtime при
обновлении.

```text
Internet
  -> Caddy/Nginx :443
      ├─ web container -> api container
      ├─ platform-web  -> platform-api container
      └─ files endpoint -> SeaweedFS

Docker Compose на одном VPS
  ├─ web
  ├─ platform-web
  ├─ api
  ├─ platform-api
  ├─ worker
  ├─ PostgreSQL + pgvector
  ├─ Valkey
  └─ SeaweedFS
```

### Как деплоить

1. Создать VPS с Ubuntu, Docker и отдельным пользователем deploy.
2. Ограничить firewall: наружу только `22` из allowlist/VPN, `80`, `443`.
3. Подготовить `.env.production`: DB passwords, JWT secrets, S3 credentials, public origins,
   SMTP и `SAAS_DATA_DIR`.
4. Запустить `docker/docker-compose.prod.yml`.
5. Выполнить database roles/migrations/seed через `Dockerfile.tools` или безопасный one-shot.
6. Поставить Caddy/Nginx перед `web`, `platform-web` и S3. Не публиковать Postgres и Valkey.
7. Настроить ежедневный PostgreSQL dump и backup каталога SeaweedFS на другой storage.

В этом режиме можно использовать уже существующий `docs/deploy-hetzner.md`, но важно понимать
его компромиссы: один failure domain, stateful storage на локальном диске, ручная стратегия
бэкапа и отсутствие автоматического failover.

### Registry: нужен или нет

**Без registry — допустимо**, если build выполняется на том же VPS и deploy запускает локальные
образы. Это проще для одного узла, но:

- сервер хранит build toolchain и registry не является источником артефактов;
- rollback возможен только пока старый image остался на диске;
- после потери сервера образы придётся собрать снова;
- нельзя надёжно и быстро развести build и runtime.

**С registry — лучше**, если build идёт в CI. Подойдут GitLab Container Registry, GitHub Container
Registry, Amazon ECR, Docker Hub или self-hosted registry. CI пушит immutable image по SHA, сервер
только pull-ит конкретную версию.

### База и realtime

- PostgreSQL держать отдельно от приложений логически, но физически можно на том же VPS.
- Для этой системы нужен образ с pgvector; обычный `postgres:17` без extension не подходит.
- Valkey можно оставить контейнером без AOF: presence и realtime stream — восстановимые данные.
- Если Redis/Valkey станет cache/session source of truth, тогда нужны persistence, backup и более
  строгая HA-политика.

**Рекомендация:** хороший дешевый старт для demo/early MVP, но не обещать high availability.

## 5. Вариант 2 — текущий single-node Docker Swarm

Это наиболее близкий к уже существующему deployment target вариант.

```text
GitLab CI / GitHub Actions
  -> build 5 application images
  -> docker stack deploy

Одна manager-нода Docker Swarm
  ├─ web
  ├─ platform-web
  ├─ api
  ├─ platform-api
  ├─ worker
  ├─ PostgreSQL + pgvector (bind volume)
  ├─ Valkey (ephemeral)
  └─ SeaweedFS (bind volume)

Caddy/Nginx на хосте -> web, platform-web, S3
```

Фактический stack уже содержит:

- rolling update/rollback для stateless-сервисов;
- `stop-first` для Postgres и SeaweedFS, потому что один volume нельзя безопасно делить;
- health checks для API;
- отдельные DB roles и migration entrypoint;
- overlay network `saas_net`;
- attachable network для one-shot `tools`-операций;
- `start-first` для API, чтобы во время rollout сосуществовали две версии;
- Socket.IO transport `websocket-only`, поэтому sticky sessions не требуются в текущей схеме.

### Registry в Swarm

#### Single-node без registry

Работает, если build выполняется на той же ноде и `docker stack deploy` использует локальные images.
Это текущий простой Hetzner-подход.

Плюсы: меньше credentials и инфраструктуры, нет отдельного сервиса.

Минусы: build конкурирует с production за CPU/RAM/disk; образа не переживают потерю ноды; второй
узел добавить без смены процесса нельзя.

#### Registry с одним или несколькими узлами

Правильная схема для Swarm из двух и более nodes:

```text
CI -> build -> registry (immutable image: git SHA)
                    ├─ manager pull
                    └─ worker pull
Swarm -> deploy exact SHA -> health check -> rollback if needed
```

Нужны `--with-registry-auth`, read-only pull credentials, retention старых образов и проверка, что
каждый сервис действительно работает на новом SHA. Не использовать `latest`: rollback и аудит
становятся неочевидными.

### Что масштабируется, а что пока нет

Можно без изменения бизнес-кода масштабировать `api`, `platform-api` и `worker`, если:

- все HTTP instances используют один Valkey adapter;
- worker jobs остаются идемпотентными;
- ALB/reverse proxy распределяет трафик;
- Postgres connections ограничены и пул рассчитан на replicas.

Нельзя просто добавить вторую ноду и оставить Postgres/SeaweedFS на local bind volume. Для этого
нужны replicated/managed stateful systems или явная storage-нода с планом failover.

**Рекомендация:** лучший промежуточный вариант для уже имеющейся схемы Docker Swarm и GitLab CI.
Он даёт повторяемый deploy и rollback без немедленного перехода на Kubernetes.

## 6. Вариант 3 — managed AWS без Kubernetes

**Рекомендуемый production-вектор для этого проекта**, если требуется надёжнее VPS, но не нужен
EKS.

```text
Route 53 / DNS
  -> Application Load Balancer
      ├─ target group -> Amazon ECS service: web или отдельный static hosting
      ├─ target group -> Amazon ECS service: api (Socket.IO)
      └─ target group -> Amazon ECS service: platform-api

Amazon ECS on AWS Fargate
  ├─ api service
  ├─ platform-api service
  └─ worker service

Private subnets
  ├─ Amazon RDS for PostgreSQL + pgvector-compatible setup
  ├─ Amazon ElastiCache for Valkey/Redis-compatible realtime
  └─ optional VPC endpoints

Amazon S3 -> files/presigned uploads
Amazon CloudFront -> web assets and optionally API edge
Amazon CloudWatch -> logs, metrics, alarms
Amazon ECR -> container images
AWS Secrets Manager / SSM Parameter Store -> secrets
```

### Важный вопрос: RDS и pgvector

Проект требует PostgreSQL 17 и `pgvector`. Перед выбором инстанса необходимо проверить, что нужная
версия `pgvector` доступна в выбранной версии Amazon RDS for PostgreSQL или Amazon Aurora PostgreSQL
и что миграции проекта поддерживаются именно этой комбинацией.

Варианты:

1. **Amazon RDS for PostgreSQL с pgvector** — default choice, если доступная extension/version
   покрывает текущую схему.
2. **Amazon Aurora PostgreSQL-Compatible** — если нужен более быстрый failover/read scaling и
   проверена совместимость pgvector и Prisma-миграций.
3. **Amazon RDS Custom/EC2 PostgreSQL** — только если managed RDS не даёт нужной версии или
   расширения; эксплуатационная ответственность резко возрастает.
4. **Database on EC2** — крайний compatibility/lift-and-shift вариант, а не default production.

На момент подготовки документа официальная документация Amazon RDS перечисляет `pgvector` среди
поддерживаемых расширений PostgreSQL, а Amazon ElastiCache поддерживает Valkey, Redis OSS и
Memcached. Но перед миграцией всё равно нужно сверить конкретные engine version/extension version
в выбранном регионе: проект зафиксирован на PostgreSQL 17 и требует pgvector не ниже версии,
совместимой с его миграциями.

Нельзя автоматически заменять pgvector на `Amazon OpenSearch Service`: это другой search engine,
другая модель индексов и отдельная синхронизация данных. OpenSearch можно добавить позже для
полнотекстового поиска/логов, но он не заменяет RLS-границу и транзакции PostgreSQL.

### Realtime в AWS

Для текущего Socket.IO-кода есть два пути:

#### ElastiCache + ECS Socket.IO

- `api` tasks подключаются к одному Redis-compatible endpoint;
- Redis Streams adapter продолжает работать;
- presence остаётся эфемерной;
- ALB держит WebSocket-соединения;
- включить health checks, connection limits и graceful shutdown;
- проверить idle timeout ALB и TLS/origin configuration.

Это минимальная миграция: меняется в основном `REDIS_URL`.

#### AWS-native realtime

Можно рассматривать Amazon API Gateway WebSocket API, AWS AppSync или AppSync Events, но это не
drop-in замена Socket.IO. Потребуются новый protocol/client adapter, auth mapping, connection
management и иной способ presence. Для этого репозитория не рекомендуется как первый migration step.

### Storage и email

- SeaweedFS заменить на **Amazon S3**; оставить тот же S3-compatible adapter, но убрать
  `S3_FORCE_PATH_STYLE=true`, если конкретная конфигурация использует virtual-hosted style.
- CORS bucket и CloudFront/OAC настроить отдельно от API CORS.
- SMTP заменить на **Amazon SES** или внешний transactional email provider. Worker по-прежнему
  остаётся владельцем отправки.

### Registry и CI

```text
GitLab CI
  -> OIDC federation
  -> IAM role без постоянного AWS access key
  -> Amazon ECR
  -> ECS task definition revision
  -> ECS service rolling deployment
```

Для проекта с GitLab не обязательно переносить CI в AWS CodePipeline. GitLab CI + ECR + ECS —
нормальная комбинация. Infrastructure as Code: Terraform или AWS CDK.

### Где выполнять миграции

Не запускать `prisma migrate deploy` одновременно из каждой API replica. Надёжные варианты:

- отдельный ECS one-shot task из `tools`-образа перед deployment;
- CI job, запускающая migration task в private network;
- отдельная migration stage с lock/guard и понятным failure gate.

Порядок:

```text
build tools image -> push ECR -> run migration task as saas_migrator
                  -> wait success
                  -> update api/platform-api/worker services
                  -> smoke checks
```

## 7. Вариант 4 — managed Kubernetes / advanced

**Amazon EKS** оправдан, если организация уже стандартизировала Kubernetes, нужны shared platform
services, много команд/приложений или единый multi-cloud deployment model.

```text
Route 53 -> CloudFront/WAF -> ALB Controller -> Amazon EKS
                                      ├─ api Deployment + Service
                                      ├─ platform-api Deployment + Service
                                      ├─ worker Deployment
                                      ├─ web/static hosting
                                      └─ migration Job

RDS/Aurora PostgreSQL + pgvector
ElastiCache/Valkey
S3
ECR
CloudWatch + Prometheus/Grafana
Secrets Manager + External Secrets / CSI driver
```

### Что получает EKS

- Deployments, Jobs, HPA, PodDisruptionBudget, namespaces, operators;
- более развитую модель scheduling и platform ownership;
- возможность стандартизировать API/worker/cron и другие продукты;
- нормальный путь к multi-node и multi-AZ compute.

### Какую цену платит проект

- сложнее networking, ingress, IAM и secret delivery;
- больше ресурсов и operational overhead;
- отдельная проблема connection pool к RDS;
- realtime требует всё того же общего Redis-compatible adapter;
- Kubernetes не делает PostgreSQL и object storage автоматически надёжными.

**Рекомендация:** не мигрировать на EKS только для того, чтобы «использовать Kubernetes». Для
текущих пяти приложений ECS/Fargate обычно даёт тот же deployment value заметно меньшей ценой.

## 8. Сравнение вариантов

| Вариант | Стоимость/сложность | Registry | База | Realtime | Надёжность | Рекомендация |
|---|---:|---|---|---|---|---|
| Local Compose | минимальная | нет | local pgvector | local Valkey | dev-only | разработка и тесты |
| Один VPS + Compose | низкая | optional | PostgreSQL на VPS | Valkey на VPS | один failure domain | demo/MVP |
| Один VPS + Swarm | низкая/средняя | без registry или local | PostgreSQL на bind volume | Valkey на node | лучше повторяемость, не HA | текущий практичный путь |
| Swarm 2+ nodes | средняя | нужен | managed/replicated DB желательно | managed/shared Valkey | хорошая, но сложнее state | переходный self-hosted вариант |
| ECS + Fargate | средняя/высокая | ECR | RDS/Aurora | ElastiCache | managed compute/data | рекомендуемый production без K8s |
| EKS | высокая | ECR | RDS/Aurora | ElastiCache | platform-scale | только при реальной K8s-потребности |

## 9. Рекомендованный путь именно для этого проекта

### Этап 1 — сохранить текущий self-hosted deploy

Оставить текущую схему для demo и развития:

- один Hetzner/VPS;
- Docker Swarm или Compose;
- текущие пять приложений отдельными сервисами;
- Postgres/pgvector и SeaweedFS на bind volumes;
- Valkey без persistence для realtime;
- Caddy/Nginx с TLS;
- backup Postgres и файлового storage вне VPS;
- images по commit SHA, даже если registry пока отсутствует.

Минимально необходимое усиление:

1. автоматический backup в другой location;
2. restore drill, а не только создание dump;
3. disk/RAM/health alerts;
4. SMTP с production credentials;
5. публичные порты только через reverse proxy;
6. зафиксированные image tags/digests и retention старых версий.

### Этап 2 — добавить registry без смены runtime

```text
GitLab CI -> GitLab Container Registry или GHCR
          -> один текущий Swarm/VPS pull-ит SHA
```

Это самый полезный промежуточный шаг: build больше не конкурирует с runtime, rollback становится
воспроизводимым, а миграция на ECS/EKS позже использует те же образы.

### Этап 3 — вынести stateful-сервисы

Первым обычно выносится PostgreSQL:

```text
ECS/Swarm apps -> managed PostgreSQL + pgvector
```

Затем files:

```text
SeaweedFS -> Amazon S3 или другой managed S3
```

Valkey выносить, когда появляются несколько runtime nodes, частые deploys или требования к
realtime availability. До этого single-node Valkey без persistence соответствует текущей модели,
потому что presence восстанавливается heartbeat-ами, а source of truth — PostgreSQL.

### Этап 4 — перейти на ECS/Fargate при реальной потребности

Переход имеет смысл, когда нужны хотя бы два из следующих пунктов:

- несколько AZ и автоматический failover;
- независимое масштабирование API и worker;
- managed backups/patching для БД;
- несколько окружений без ручного ухода за серверами;
- команда не хочет владеть Swarm/host security;
- нужен audit/IAM/CloudWatch и standard AWS platform.

## 10. Отдельные решения по каждому компоненту

### API и frontend

| Компонент | Простой путь | Средний | Advanced |
|---|---|---|---|
| `api` | Docker Compose/Swarm | ECS/Fargate service за ALB | EKS Deployment или ECS multi-AZ |
| `platform-api` | отдельный контейнер/порт | отдельный ECS service | отдельный namespace/service policy |
| `worker` | отдельный container с restart | отдельный ECS service с queue-aware scaling | ECS/EKS workers + scheduled jobs |
| `web` | nginx container | S3 + CloudFront или ECS nginx | CloudFront + versioned assets/edge policies |
| `platform-web` | отдельный nginx container | отдельный S3/CloudFront origin | отдельный protected distribution/policy |

Не объединять `api` и `worker` в один container: это разные процессы, health model, scaling и deploy.
Два web можно держать одним nginx image family, но tenant и control plane должны иметь разные
конфигурации и домены.

### PostgreSQL

| Вариант | Когда |
|---|---|
| PostgreSQL container на VPS | dev, demo, ранний MVP |
| PostgreSQL на отдельном VPS/VM | нужно отделить DB failure/load от app, но принимается self-managed ops |
| Amazon RDS PostgreSQL + pgvector | рекомендуемый managed вариант после проверки extension/version |
| Aurora PostgreSQL-Compatible | scale/HA оправдывают цену и проверена pgvector-совместимость |
| PostgreSQL operator в EKS | только если Kubernetes platform — осознанное решение |

Разделять API и control plane database roles обязательно во всех вариантах. Разделять физические
database instances между tenant и control plane не обязательно: текущая модель специально использует
один PostgreSQL cluster/database с логическими roles и RLS.

### pg-boss и очереди

Текущая очередь должна остаться рядом с PostgreSQL, потому что publish выполняется в той же
транзакции, что и domain change. Не заменять её на SQS/RabbitMQ без отдельного изменения
transactional-outbox semantics.

Возможные пути:

- local/Postgres container: текущий dev;
- managed PostgreSQL: pg-boss продолжает работать без отдельного queue service;
- отдельный SQS/RabbitMQ/Kafka: только после доказанной потребности в throughput, retention или
  независимом event platform. Потребуется переосмыслить атомарность publish и обработку DLQ.

### Realtime

| Вариант | Изменения |
|---|---|
| Socket.IO + один Valkey | текущий и рекомендуемый старт |
| Socket.IO + managed Redis/Valkey | тот же код, меняется endpoint и эксплуатация |
| Socket.IO + несколько API instances | общий Redis Streams adapter обязателен, websocket-only сохраняется |
| API Gateway/AppSync realtime | новый transport/client contract, не простой infra swap |

Не использовать pg-boss как realtime transport. Не хранить критическое состояние только в socket
connection. Клиент должен уметь REST resync после disconnect.

### Object storage

| Вариант | Когда |
|---|---|
| SeaweedFS container | self-hosted и dev/prototype |
| S3-compatible provider | self-hosted VPS без желания обслуживать storage |
| Amazon S3 | AWS production, durability/lifecycle/versioning/presigned URLs |

Файлы и PostgreSQL нужно backup-ить согласованно: metadata в БД не должна ссылаться на object key,
которого нет. Для S3 добавить lifecycle, versioning, encryption, bucket policy и CORS.

## 11. Registry: короткое правило

```text
Только laptop/local dev       -> registry не нужен
Один VPS, build на сервере    -> registry optional
CI build + runtime на VPS     -> registry рекомендуется
Swarm с 2+ nodes              -> registry обязателен практически
ECS/Fargate/EKS                -> registry обязателен (обычно Amazon ECR)
```

Что публиковать:

- `api:<git-sha>`;
- `platform-api:<git-sha>`;
- `worker:<git-sha>`;
- `web:<git-sha>`;
- `platform-web:<git-sha>`;
- `tools:<git-sha>`.

Нельзя считать tag `latest` release identifier. Release — это immutable SHA/digest, который можно
сопоставить с commit, migration version и pipeline.

## 12. Security и эксплуатационный минимум

- Postgres, Valkey и migration endpoints не публиковать в интернет.
- API containers запускать non-root, как уже предусмотрено runtime Dockerfile.
- Секреты не класть в image, git и обычные CI variables без masking/protection.
- Для AWS использовать IAM role/OIDC, а не long-lived access keys в GitLab.
- Разделять app runtime role и migration/admin role.
- Ограничить S3 bucket: browser получает только presigned URL с коротким TTL.
- Проверить WebSocket proxy: `Upgrade`, `Connection`, idle timeout, TLS и allowed origins.
- Для логов разделять application logs, audit trail и traces.
- Настроить retention и alerts: 5xx, latency, worker backlog, DLQ, DB connections, disk, memory,
  failed deploy и backup age.
- Перед destructive migration делать backup и проверять restore.

## 13. Итоговая рекомендация

Для текущего состояния проекта оптимальна последовательность:

```text
Сейчас:
  single-node Swarm/VPS + Postgres/pgvector + Valkey + SeaweedFS

Следующий полезный шаг:
  immutable images в registry + external backups + restore drill

Когда появится production-нагрузка:
  ECS/Fargate + ECR + RDS/Aurora с pgvector + ElastiCache + S3 + CloudWatch

Только при platform/Kubernetes-требованиях:
  EKS + RDS/Aurora + ElastiCache + S3
```

Главный принцип: сначала выносить state и улучшать backup/rollback, а не добавлять Kubernetes
или отдельные микросервисы ради названий. Для этой архитектуры надёжная PostgreSQL с RLS,
идемпотентный worker, общий realtime broker и восстановимые файлы важнее количества кластеров.

## Связанные документы

- [README](../README.md)
- [Docker Swarm deployment](deploy-swarm.md)
- [Hetzner deployment](deploy-hetzner.md)
- [Multi-tenancy architecture](multi-tenancy-architecture.md)
- [Realtime](realtime.md)
- [Event-driven architecture](event-driven-architecture.md)
- [AWS service cheatsheet](../../cv/interview-prep/cloud/aws-services-cheatsheet.md)
- [Amazon RDS: PostgreSQL extensions](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html)
- [Amazon ElastiCache: supported engines](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html)
