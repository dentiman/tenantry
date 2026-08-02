# Деплой у Docker Swarm через GitLab CI/CD

> **Статус: реалізовано.** Single-node старт (усі сервіси в одному стеку на manager-ноді),
> транспорт — `docker context over SSH` (на target-сервер НЕ копіюються файли).
> Патерни взяті з обкатаного `accounting-multi-tenant`, адаптовані під специфіку
> saas-skeleton (2 API + worker + S3 + трирольова модель БД з RLS, Node 24).

## 1. Огляд

5 застосунків монорепо + інфраструктура їдуть одним `docker stack deploy` на одну
manager-ноду. Раннер GitLab керує деплоєм через docker-context по SSH: `stack deploy`
читає stack-файл **локально**, інтерполює `${...}` з оточення job-а й шле готовий spec на
manager. **Жодного `scp` — ні stack, ні `.env`, ні config.json на сервері немає.**

Топологія стеку (`saas-prod` / `saas-dev`):

| Сервіс | Образ | Порт (mode:host, 127.0.0.1) | Стан |
| ------ | ----- |-----------------------------| ---- |
| `api` | `Dockerfile.node` APP=api | 8501                        | — |
| `platform-api` | `Dockerfile.node` APP=platform-api | 8502                        | — |
| `worker` | `Dockerfile.node` APP=worker | — (без HTTP)                | — |
| `web` | `Dockerfile.web` APP=web (nginx) | 8511                        | — |
| `platform-web` | `Dockerfile.web` APP=platform-web (nginx) | 8512                        | — |
| `postgres` | postgres:17-alpine | — (лише overlay)            | bind-volume |
| `seaweedfs` | chrislusf/seaweedfs:4.39 | 8503                        | bind-volume |

**Режим IP:port БЕЗ проксі** (тестовий прод): браузер ходить напряму на `<node-ip>:порт` по
**http** (без TLS): `web` → `<node-ip>:8511`, `platform-web` → `<node-ip>:8512`, `seaweedfs (S3)`
→ `<node-ip>:8503` (браузер б'є S3 напряму за presigned URL — тому проблема «зберігати Host»
зникає). Ці три — `host_ip: 0.0.0.0`. `api`/`platform-api` (8501/8502) лишаються на `127.0.0.1`:
браузер ходить до них через nginx-проксі `web` по overlay, напряму не треба.

> ⚠️ Усе на **http** — не змішувати зі https (mixed-content блокується браузером). Для справжнього
> проду — повернути `host_ip: 127.0.0.1` + зовнішній reverse-proxy з TLS (для S3 зберігати Host).

> **Наступне доповнення стеку (RT-0):** сервіс `valkey` (Socket.IO Redis Streams adapter +
> presence leases) — порт НЕ публікується, лише overlay; `docker/nginx/default.conf.template`
> отримує `location /socket.io/` з Upgrade-заголовками. Транспорт — websocket-only, тому
> sticky sessions цій топології не потрібні. Деталі — [realtime.md](realtime.md).

## 2. Зафіксовані рішення

| Питання | Рішення |
| ------- | ------- |
| Транспорт | `docker context over SSH`, без файлів на сервері (§6) |
| Registry | GitLab Registry (gitlab.com). Логін скрізь — предефайнені `CI_REGISTRY_USER`/`CI_REGISTRY_PASSWORD` (job-token), як в accounting; нодам роздається через `--with-registry-auth` |
| SSH login | раннер↔manager уже налаштований (ключ на рівні раннера); у CI не інжектимо. Job-и — за runner-тегом (тимчасово `deploy_dev` для всіх) |
| Середовища | **dev** (гілка `dev`→`saas-dev`) + **prod** (`main`→`saas-prod`) |
| Стан | у стеку, прибито до manager (`node.role==manager`, `replicas:1`); volume `local`+`o:bind` у `${SAAS_DATA_DIR}` → бекап = весь сервер |
| Зовнішній доступ | **IP:port без проксі** (тестовий прод): web/platform-web/seaweedfs — `mode:host` на `0.0.0.0`, браузер по http напряму; api/platform-api — на `127.0.0.1`. Прод → `127.0.0.1` + reverse-proxy з TLS |
| Міграції | entrypoint `api`-контейнера: `prisma migrate deploy` під `MIGRATE_DATABASE_URL` (saas_migrator) → старт під `DATABASE_URL` (saas_app) |
| Секрети | **тестовий прод:** прикладні секрети (JWT/S3/SMTP/пароль БД) у КОМІТНУТОМУ `docker/deploy.env` + `docker/seaweedfs/s3.prod.json` (свідомо в репо). Серверний таргет — CI-змінні `DEPLOY_USER/HOST/PORT_*` (ті самі, що в accounting). Для справжнього проду — винести в CI Variables |
| База образу | `node:24-bookworm-slim` (через argon2/sharp; Node 24 — pg-boss/file-type ESM). `nginx:alpine` для фронтів |

**Правки в репо (мінімальні, потрібні для деплою):**
- `libs/database/package.json` — `prisma` перенесено devDependencies→dependencies (CLI потрібен
  у runtime для entrypoint-міграцій);
- `.npmrc` — `shamefully-hoist=true` (плоский node_modules: webpack-бандли тримають npm-депи
  external, у runtime-образ копіюється лише кореневий node_modules — без hoisting isolated-симлінки
  губляться і `require('argon2'/'sharp'/'pg-boss'/'prisma')` падає).
- **Жодних змін бізнес-коду.** (Prisma 7 `prisma-client`-генератор + `@prisma/adapter-pg` —
  engine-free WASM, тож `binaryTargets`/платформа образу нерелевантні.)

## 3. Файли

| Файл | Призначення |
| ---- | ----------- |
| `Dockerfile.node` | multi-stage образ для api/platform-api/worker (`ARG APP`) |
| `docker/entrypoint-api.sh` | entrypoint api: migrate deploy → старт |
| `Dockerfile.web` | Vite build → nginx (`ARG APP`: web/platform-web) |
| `docker/nginx/default.conf.template` | SPA-fallback + `/api`-проксі (`${API_UPSTREAM}` через envsubst) |
| `Dockerfile.tools` | повний-deps образ для one-shot `db:roles`/`db:seed`/`db:migrate:deploy` |
| `docker/docker-compose.stack.yml` | повний стек (anchors: pinning, update, env-групи) |
| `.gitlab-ci.yml` | build (6 образів) → deploy_dev/prod + manual `db_roles`/`seed`/`dump` |
| `.dockerignore` | контекст без node_modules/dist/logs/.env |

## 4. Образи (механіка)

**`Dockerfile.node`** — 3 стадії: `builder` (повний install → `prisma generate` → `nest build`
webpack-бандл `apps/$APP/dist/main.js`) → `prod-deps` (`pnpm install --prod`, лише runtime-депи)
→ `runtime` (тонкий, non-root; копіює кореневий `node_modules` + `dist` + prisma-схему/config).
`api` у стеку override-ить `entrypoint` на `entrypoint-api.sh`; `platform-api`/`worker` —
дефолтний CMD `node apps/$APP/dist/main.js`.

**`Dockerfile.web`** — `builder` (`vite build` → `apps/$APP/dist`) → `nginx:alpine` з шаблоном.
Офіційний nginx-entrypoint робить `envsubst` шаблонів із `/etc/nginx/templates/` при старті →
підставляє `${API_UPSTREAM}` (nginx-змінні `$host`/`$uri` не чіпає). **`config.json`/`API_BASE_URL`
не потрібні:** фронт ходить на відносний `/api` (`baseURL '/'`), nginx проксить його на бекенд
(глобальний префікс роутів — `api`, тож `/api/*` НЕ зрізаємо). Динамічний резолв бекенда — через
Docker embedded-DNS (`resolver 127.0.0.11` + змінна в `proxy_pass`).

**`Dockerfile.tools`** — повний install (tsx, prisma, pg, argon2) для операційних команд БД.

## 5. Stack

- **Anchors** (`x-deploy`, `x-update-*`, `x-db-env`, `x-s3-env`) прибирають дублювання.
- **Pinning:** усі сервіси `replicas:1`, `node.role==manager` (за кількох нод — розкоментувати
  `node.hostname`).
- **Update:** stateless — `order: start-first` + `failure_action: rollback` (zero-downtime);
  stateful (postgres/seaweedfs) — `order: stop-first` (двом інстансам не можна ділити один volume).
- **Стан:** `pgdata`/`seaweedfs-data` — `local`+`o:bind` у `${SAAS_DATA_DIR}/{postgres,seaweedfs}`.
- **DB-URL-и:** паролі ролей фіксовані в `ensure-roles.ts`
  (`saas_app`/`saas_migrator`/`saas_platform`); postgres-порт не публікується.
- **S3-конфіг** — swarm `config` із `file:` (читається на раннері з комітнутого `docker/seaweedfs/s3.prod.json`).

## 6. CI-пайплайн і транспорт

**build** (dind + BuildKit): 6 образів паралельно, тег `$CI_COMMIT_SHA` (+`latest` на `main`),
теги передаються далі dotenv-артефактом `build.env`.

**deploy** (`docker:27` + `openssh-client`, приземляється на раннер за тегом `deploy_dev`/`deploy_prod`):
```
# SSH раннер↔manager УЖЕ налаштований (ключ/known_hosts на рівні раннера) — не інжектимо
docker context create swarm --docker host=ssh://$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PORT
docker login … -u $CI_REGISTRY_USER (job-token) # роздається нодам через --with-registry-auth
set -a; . ./docker/deploy.env; set +a          # прикладні секрети з репо → у оточення job-а
DOCKER_CONTEXT=swarm docker stack deploy --with-registry-auth -c docker/docker-compose.stack.yml $STACK
```
> Job-и деплою прив'язані до раннера runner-тегами (`deploy_dev`/`deploy_prod` — скоригуй під
> імена ваших раннерів). Саме цей раннер має готовий SSH-доступ до manager-а.
Інтерполяція `${...}` (образи, JWT, S3, SMTP) — **на раннері** з оточення job-а. Нічого не лягає
на сервер. Секрети/config-файли на manager (за потреби) створюються через SSH-тунель — теж без ФС.

## 7. Конфіг: що де лежить

**Серверні CI/CD Variables — ті самі, що в accounting** (Settings → CI/CD → Variables; «як є», не в репо):
- `DEPLOY_USER_DEV` / `_PROD` — ssh-юзер manager-а
- `DEPLOY_HOST_DEV` / `_PROD` — хост/IP manager-а
- `DEPLOY_PORT_DEV` / `_PROD` — ssh-порт (дефолт 22)

  → docker-context будується як `host=ssh://$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PORT`.

**Registry** — нічого не заводити: логін предефайненими `CI_REGISTRY_USER`/`CI_REGISTRY_PASSWORD`
(job-token), як в accounting.

**Прикладні секрети/конфіг — у РЕПО (тестовий прод, свідомо комітяться):**
- `docker/deploy.env` — `POSTGRES_PASSWORD`, `JWT_SECRET`, `PLATFORM_JWT_SECRET`, `S3_ENDPOINT`,
  `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_CORS_ALLOWED_ORIGINS`, `SMTP_HOST`, `SMTP_FROM` (+ опційні
  override з дефолтами). deploy-job робить `set -a; . ./docker/deploy.env; set +a`.
- `docker/seaweedfs/s3.prod.json` — ключі сховища (мають збігатися з `S3_ACCESS_KEY`/`S3_SECRET_KEY`).

> **Для СПРАВЖНЬОГО проду:** обидва файли винести в CI Variables (Protected+Masked) і
> розігнорувати назад у `.gitignore`; за потреби мультиноди — Deploy Token (`read_registry`)
> замість job-token.

> **SSH не налаштовуємо** — раннер↔manager уже пов'язані (ключ/known_hosts на рівні раннера).
> У CI лише `docker context create host=ssh://$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PORT`.
> **ТИМЧАСОВО всі job-и (включно з prod) під тегом `deploy_dev`** — ці раннери мають потрібний
> SSH-доступ. Куди саме деплоїти (dev/prod-стек, host, секрети) визначає НЕ тег, а
> `DEPLOY_*` + `variables` job-а; тег лише обирає раннер-виконавець. Розділити на
> `deploy_dev`/`deploy_prod` — коли з'являться окремі prod-раннери.

## 8. Рунбук першого деплою

1. **Сервер:** Swarm-нода (`docker swarm init`); deploy-юзер у групі `docker`;
   `mkdir -p ${SAAS_DATA_DIR}/{postgres,seaweedfs}`. SSH раннер↔manager уже налаштований.
2. **GitLab/репо:** завести CI Variables `DEPLOY_USER/HOST/PORT_*` (§7; ті самі, що в accounting —
   можливо, вже є); заповнити `docker/deploy.env`
   і `docker/seaweedfs/s3.prod.json` реальними значеннями; переконатися, що runner-тег
   (`deploy_dev`) відповідає вашому раннеру з SSH до manager-а.
3. Пуш у гілку → **build** збирає й пушить образи.
4. **`docker stack deploy`** (deploy_prod): postgres/seaweedfs піднімаються з даними;
   api-entrypoint спробує migrate — на порожній БД **впаде на ролях** (це очікувано на самому
   першому запуску).
5. Запустити **manual `db_roles_prod`** (створює `saas_migrator`/`saas_app`/`saas_platform`) →
   api рестартне (restart_policy) і міграції пройдуть. За потреби демо-дані — **manual `seed_prod`**.
6. **Доступ (IP:port без проксі):** у `docker/deploy.env` замінити `CHANGE_ME_NODE_IP` на IP ноди
   (`S3_ENDPOINT=http://<node-ip>:8503`, `S3_CORS_ALLOWED_ORIGINS=http://<node-ip>:8511`). Відкрити
   у браузері `http://<node-ip>:8511` (web) / `:8512` (platform-web). Усе по http (без TLS/проксі).
7. Бекап — `dump_db_prod` (артефакт) та/або снапшот `${SAAS_DATA_DIR}`.

> Порядок «deploy → db_roles» на найпершому запуску має цей нюанс через bootstrap ролей. Далі
> (ролі вже є) деплої безшовні: entrypoint-міграції відпрацьовують до старту.

## 9. Що взято з accounting і чим замінено scp

| accounting | тут |
| ---------- | --- |
| один стек, `x-deploy-pinned`, `mode:host` | ✅ так само |
| міграції в entrypoint | ✅ (адаптовано під saas_migrator/saas_app) |
| runtime config.json через nginx-entrypoint | ✖️ не треба (фронт на відносному `/api`) |
| seeder-образ + manual `pg_dump` | ✅ (`Dockerfile.tools`, `db_roles`/`seed`/`dump`) |
| dev/prod по гілках | ✅ |
| **`scp` stack + `.env` на сервер** | **→ docker context**: stack читається локально, env інтерполюється client-side, S3-config — swarm `config` з локального файлу. Нуль файлів на сервері |

## 10. Масштабування (коли single-node стане тісно)

- stateless (`worker`/`web`) → `replicas: N`; зняти `mode:host`, перейти на ingress + Traefik/edge з TLS.
- `postgres`/`seaweedfs` → винести на окрему storage-ноду / managed Postgres.
- entrypoint-міграції → окрема стадія `migrate` one-shot (при >1 репліки api — щоб уникнути гонки).
- `--with-registry-auth` + Deploy Token уже готові до мультинодовості (ноди самі пулять образи).
