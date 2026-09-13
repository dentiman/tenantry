# Ізольовані робочі простори (слоти) — ІДЕЯ

**Статус**: ідея, не реалізовано (записано 2026-09-13). Реалізувати окремим workspace.

## Проблема

Кожен git worktree (фіча, агент) потребує повного стеку: Postgres, Valkey, SeaweedFS, Mailpit,
api, platform-api, worker і обидва фронти, а ще e2e і браузерну перевірку. Зараз це неможливо
робити паралельно:

- `docker/docker-compose.yml` має зашиті `name: saas-skeleton` і `container_name`. Тому всі
  checkout-и ділять ОДНІ контейнери й volume-и, тобто одну БД: міграції гілки A одразу
  опиняються в dev-даних гілки B.
- Порти процесів фіксовані (3001/3002/5173/5174), тож dev-стек може працювати лише в одному
  checkout.
- e2e з піднятим dev-стеком впираються в `max_connections` спільного Postgres.
- Порти в `.env` доводиться міняти парами (`REDIS_PORT` + `REDIS_URL`), і тести колись
  мовчки ходили не туди (див. `docs/commands.md` § `pnpm api:test:e2e`).

## Ідея

Кожен workspace отримує номер **слота N**. З нього виводяться всі імена й порти: зсув +100·N.
Слот 0 — основний checkout без `.env.local`, у ньому все як зараз (дефолти).

| Ресурс                                         | Слот 0      | Слот 1        | Формула    |
| ---------------------------------------------- | ----------- | ------------- | ---------- |
| Docker project                                 | `saas-skeleton` | `saas-skeleton-1` | `-${N}` |
| Postgres                                       | 5432        | 5532          | +100·N     |
| Valkey                                         | 6379        | 6479          | +100·N     |
| SeaweedFS S3                                   | 8333        | 8433          | +100·N     |
| Mailpit UI / SMTP                              | 8025 / 1025 | 8125 / 1125   | +100·N     |
| api / platform-api                             | 3001 / 3002 | 3101 / 3102   | +100·N     |
| web / platform-web                             | 5173 / 5174 | 5273 / 5274   | +100·N     |

Результат: окремі контейнери й volume-и (своя БД), свої процеси, свої e2e. Два workspace-и
працюють одночасно, не зачіпаючи один одного.

## Що з цього стандартне, а що custom

Слово «слот» — наша назва; готового пакета немає. Механіка — штатні можливості інструментів:

- **Docker Compose project name** (`COMPOSE_PROJECT_NAME` / `-p` / `name:`) — неймспейс для
  контейнерів, мережі й volume-ів. `container_name` цю ізоляцію ламає, тому його прибрати.
- **Інтерполяція в compose** (`'${POSTGRES_PORT:-5432}:5432'`) зі значеннями з оточення або
  `--env-file`. Для `REDIS_PORT` так уже зроблено.
- **`.env.local` у Nest**: `ConfigModule` уже читає його раніше за `.env`; e2e — теж
  (`apps/api/test/load-env.ts`).
- **Vite**: `server.port` і `proxy.target` можна брати з `process.env`.

Custom — лише скрипт ініціалізації (нижче) і параметризація конфігів.

Розглянуті альтернативи:

- **Ефемерні порти Docker** (`'5432'` без хостового): вільний порт обирає Docker, але адресу
  треба щоразу витягати через `docker compose port` і підставляти в env. Складніше за
  детерміновані зсуви.
- **Dev Containers / весь стек у Docker**: повна ізоляція, але повільний hot-reload на macOS і
  складніший доступ браузера.
- **Спільна інфра + окрема БД і префікс Valkey на worktree**: порти процесів однаково
  розносити, а Postgres лишається спільним вузьким місцем. Половинчасто.
- **direnv / mise**: могли б вмикати env при `cd`, але `.env.local` уже досить.
- Якщо інструмент worktree (напр. orca) має хук setup-скрипта при створенні workspace — туди
  можна повісити `ws:init`. Перевірити.

## Скрипт ініціалізації

`scripts/workspace-init.ts` → `pnpm ws:init [N]`:

1. Визначити N: з аргументу або перший вільний (порти `base + 100·N` не зайняті).
2. Згенерувати `.env.local` (gitignored). Похідні URL будуються з портів, щоб не правити
   дві змінні руками:

   ```env
   COMPOSE_PROJECT_NAME=saas-skeleton-1
   POSTGRES_PORT=5532
   REDIS_PORT=6479
   S3_PORT=8433
   MAILPIT_UI_PORT=8125
   MAILPIT_SMTP_PORT=1125
   PORT=3101
   PLATFORM_PORT=3102
   WEB_PORT=5273
   PLATFORM_WEB_PORT=5274
   DATABASE_URL=postgresql://saas_app:saas_app@localhost:5532/saas_skeleton
   MIGRATE_DATABASE_URL=postgresql://saas_migrator:saas_migrator@localhost:5532/saas_skeleton
   PLATFORM_DATABASE_URL=postgresql://saas_platform:saas_platform@localhost:5532/saas_skeleton
   POSTGRES_ADMIN_URL=postgresql://saas:saas@localhost:5532/postgres
   REDIS_URL=redis://:saas-realtime@localhost:6479
   S3_ENDPOINT=http://localhost:8433
   SMTP_PORT=1125
   CORS_ALLOWED_ORIGINS=http://localhost:5273
   PLATFORM_CORS_ALLOWED_ORIGINS=http://localhost:5274
   S3_CORS_ALLOWED_ORIGINS=http://localhost:5273
   APP_PUBLIC_URL=http://localhost:5273
   ```

3. `docker compose --env-file .env.local -f docker/docker-compose.yml up -d`.
4. `pnpm db:reset`: чиста БД, ролі, міграції, сід.
5. Надрукувати адреси: web, platform-web, api Swagger, Mailpit.

`pnpm ws:down` → `docker compose -p saas-skeleton-N down -v` (контейнери і дані слота).

## Що змінити в репо

- `docker/docker-compose.yml` — прибрати `name:` і `container_name`, винести всі хостові
  порти в змінні з дефолтами слота 0.
- `apps/web/vite.config.ts`, `apps/platform-web/vite.config.ts` — `server.port` і
  `proxy.target` (включно з `ws: true` для `/socket.io`) з env.
- `package.json` — `docker:up/down` передають `--env-file .env.local`, якщо файл існує
  (compose сам читає лише `.env`).
- Перевірити всі дефолти `localhost:<port>` у коді й скриптах (`libs/database/scripts/*`,
  `apps/api/test/test-database.ts`, `redis.config.ts`, `worker-realtime.emitter.ts`): вони мусять
  перебиватись env.
- `docs/commands.md` і `CLAUDE.md` — розділ про слоти.

## Відкриті питання

- Чи потрібен `db:reset` при кожному `ws:init`, чи лише при створенні слота.
- Чи копіювати секрети (`JWT_SECRET` тощо) з `.env` основного checkout-а, чи генерувати свої.
- Спільний кеш образів Docker — ок, але Valkey/Postgres на кожен слот — це пам'ять:
  прикинути ліміт одночасних слотів на машині.
