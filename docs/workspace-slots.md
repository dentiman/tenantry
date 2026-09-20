# Ізольовані робочі простори (слоти)

**Статус**: реалізовано і перевірено живим прогоном (2026-09-13). `pnpm ws:init [N]`
(`scripts/workspace-init.ts`) і `pnpm ws:down` — готові команди, не план.

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

| Ресурс             | Слот 0          | Слот 1            | Формула |
| ------------------ | --------------- | ----------------- | ------- |
| Docker project     | `saas-skeleton` | `saas-skeleton-1` | `-${N}` |
| Postgres           | 5432            | 5532              | +100·N  |
| Valkey             | 6379            | 6479              | +100·N  |
| SeaweedFS S3       | 8333            | 8433              | +100·N  |
| Mailpit UI / SMTP  | 8025 / 1025     | 8125 / 1125       | +100·N  |
| api / platform-api | 3001 / 3002     | 3101 / 3102       | +100·N  |
| web / platform-web | 5173 / 5174     | 5273 / 5274       | +100·N  |

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

1. Визначити N: з аргументу; якщо не задано — з `WORKSPACE_SLOT` уже наявного `.env.local`
   (ідемпотентно, той самий workspace лишається на тому самому слоті); інакше перший
   `N=1..50`, який не закріплений у `.env.local` іншого checkout-а з
   `git worktree list` і в якого всі 9 портів слота вільні (перевірка через `net`, спроба
   `listen`/`EADDRINUSE`). Це резервує слот навіть тоді, коли його контейнери й dev-процеси
   зараз вимкнені. `N=0` і всі його базові порти зарезервовані за основним checkout-ом
   завжди; їхня фактична зайнятість під час `ws:init` не має значення. Явний `pnpm ws:init N`
   теж відхиляється, якщо N уже належить іншому worktree.
2. Згенерувати `.env.local` (gitignored, перезаписується щоразу). Лише ПЕРЕВИЗНАЧЕНІ ключі —
   решта (`S3_ACCESS_KEY`, `SMTP_*` тощо) і так приходить із базового `.env`, бо
   `@nestjs/config`/Vite мерджать `.env.local` поверх `.env`, а не замінюють:

   ```env
   WORKSPACE_SLOT=1
   COMPOSE_PROJECT_NAME=saas-skeleton-1
   POSTGRES_PORT=5532
   REDIS_PORT=6479
   S3_PORT=8433
   MAILPIT_SMTP_PORT=1125
   MAILPIT_UI_PORT=8125
   SMTP_PORT=1125
   API_PORT=3101
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
   CORS_ALLOWED_ORIGINS=http://localhost:5273
   PLATFORM_CORS_ALLOWED_ORIGINS=http://localhost:5274
   S3_CORS_ALLOWED_ORIGINS=http://localhost:5273
   JWT_SECRET=<згенеровано, 64 hex>
   PLATFORM_JWT_SECRET=<згенеровано, 64 hex>
   ```

   Секрети (`JWT_SECRET`/`PLATFORM_JWT_SECRET`) генеруються СВОЇ на кожен слот
   (`randomBytes(32).toString('hex')`) — не копіюються з базового `.env`, щоб токени різних
   слотів ніколи не були крос-валідні.

3. `docker compose --env-file .env.local -f docker/docker-compose.yml up -d`.
4. Дочекатись, поки Postgres слота почне приймати TCP (ретрай-цикл, до 15с) — і потім
   `pnpm db:reset` (ЗАВЖДИ, і на новому, і на вже ініціалізованому слоті — рішення
   користувача: детермінований чистий стан важливіший за швидкість повторного `ws:init`).
   `db:reset` теж ретраїться (до 5 спроб, 2с) — образ Postgres на ПЕРШОМУ старті з
   `docker-entrypoint-initdb.d` піднімає тимчасовий сервер, ганяє init-скрипти й
   перезапускається вже фінальним; у це вікно порт коротко приймає TCP і одразу рве
   з'єднання, чого голий wait-for-port не бачить. Сама команда ідемпотентна
   (`DROP IF EXISTS` → `CREATE` → roles → migrate → seed), тому ретрай безпечний.
5. Надрукувати адреси (web, platform-web, api/platform Swagger, Mailpit UI) і нагадати
   команди `*:dev` — вони підхоплять `.env.local` автоматично.

Vite запускається зі `strictPort: true`: якщо призначений порт слота зайнятий, процес падає
з явною помилкою, а не перескакує на наступний порт (який може належати іншому процесу або
слоту). Tenant API і web-проксі віддають перевагу slot-specific `API_PORT` над generic
`PORT`: Claude preview інжектить `PORT` зі свого launch config, але через це більше не може
перемістити API non-zero слота на зарезервований `3001` або направити web-проксі на Vite.

### Prisma і DB-команди у worktree

`libs/database/load-root-env.ts` завантажується Prisma config-ом і всіма DB-скриптами. Він
читає кореневі `.env`, потім `.env.local` (явні змінні shell/CI мають найвищий пріоритет),
тому і кореневий `pnpm db:migrate:dev`, і прямий
`cd libs/database && pnpm exec prisma migrate dev --name X` використовують
`MIGRATE_DATABASE_URL` поточного слота, а `db:reset`/`db:roles`/`db:seed` — відповідні URL
того самого слота.

Для non-zero слота loader звіряє `POSTGRES_PORT` та всі локальні DB URL з формулою
`5432 + 100·N` і завершує команду до підключення, якщо бачить інший порт. У linked git
worktree без `.env.local` DB-команди також відхиляються з вимогою спершу виконати
`pnpm ws:init`, замість небезпечного fallback на slot 0. Офлайнові `prisma generate`,
`prisma validate` і `prisma format` цього обмеження не мають.

`pnpm ws:down` → `docker compose --env-file .env.local -f docker/docker-compose.yml down -v`
(контейнери і volume-и слота; `.env.local` не видаляється — наступний `ws:init` без
аргументу повертається на той самий слот).

## Що змінено в репо

- `docker/docker-compose.yml` — `name: saas-skeleton` → `name: ${COMPOSE_PROJECT_NAME:-saas-skeleton}`,
  прибрано 4× `container_name`. Хостові порти вже й так були параметризовані
  (`${VAR:-default}`) — окремо чіпати не довелось.
- `scripts/workspace-init.ts` (новий) + `pnpm ws:init`/`ws:down` у корені `package.json`;
  `tsx` заведений явною root-залежністю (раніше працював лише через
  `shamefully-hoist=true`).
- `docker:up`/`docker:down` — умовно передають `--env-file .env.local`, якщо файл є.
- `apps/web/vite.config.ts`, `apps/platform-web/vite.config.ts` — `server.port` і
  `proxy.target` (включно з `ws: true` для `/socket.io` у web) тепер через
  `loadEnv(mode, <корінь репо>, '')`, а не хардкод. Це ЄДИНЕ місце, де справді бракувало
  читання кореневого `.env.local` — `apps/api`, `apps/platform-api`, `apps/worker` вже мали
  `envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env']` і підхоплюють слот
  без жодних змін коду. Для обох Vite-серверів увімкнено `strictPort: true`.
- `libs/database/load-root-env.ts` — єдина точка завантаження root `.env`/`.env.local` для
  Prisma CLI та DB-скриптів, із перевіркою порту non-zero слота й fail-closed поведінкою у
  неініціалізованому linked worktree.
- `apps/api/src/main.ts`, `apps/platform-api/src/main.ts`, `apps/worker/src/main.ts` — один
  рядок логу при старті (`workspace slot: N`), щоб не плутати, який процес який слот
  обслуговує.
- Перевірено: дефолти `localhost:<port>` у `libs/database/scripts/*`,
  `apps/api/test/test-database.ts`, `redis.config.ts`, `worker-realtime.emitter.ts` вже й так
  повністю перебиваються env (`??`) — коду там міняти не довелось.
- `.env.example`, `docs/commands.md`, `CLAUDE.md` — коротка документація команд.

## Живий прогін (2026-09-13)

`pnpm ws:init` (без аргументу, слот 0 уже піднятий) → знайшов слот 1, підняв
`saas-skeleton-1-{postgres,valkey,mailpit,seaweedfs}-1` на портах 5532/6479/1125/8125/8433,
`db:reset` пройшов усі 16 міграцій + сід. Повторний `pnpm ws:init` (без аргументу) на тому
самому checkout — переюзав слот 1 (`WORKSPACE_SLOT` з `.env.local`), `db:reset` знову
відпрацював дочиста. `pnpm api:dev` — лог `workspace slot: 1`, слухає :3101, `StorageService`
підхопив CORS-origin `http://localhost:5273` (порт слота). `pnpm web:dev` — Vite на :5273,
`GET /api/health` через dev-проксі → `200 {"status":"ok"}` з API слота 1. Слот 0
(`saas-skeleton-db` тощо, порти 5432/6380/8025/1025/8333) увесь час лишався незайманим.
`pnpm ws:down` прибрав контейнери й volume-и `saas-skeleton-1_*`, слот 0 не зачепив.
`pnpm lint`/`pnpm typecheck` — чисті.

## Відкрите питання

- Спільний кеш образів Docker — ок, але Valkey/Postgres на кожен слот — це пам'ять:
  прикинути ліміт одночасних слотів на машині (не блокер, просто не виміряно).
- ~~Знайдено під час живого прогону AUTH-3 (2026-09-15): `.env.local` генерував лише
  `MAILPIT_SMTP_PORT`/`MAILPIT_UI_PORT`, а `apps/worker/src/mail/mailer.service.ts`
  читає `SMTP_PORT` — без мапінгу `worker:dev` у слоті N ≠ 0 мовчки слав пошту на
  Mailpit СЛОТА 0.~~ **Виправлено (2026-09-15)**: `workspace-init.ts` тепер генерує і
  `SMTP_PORT` (див. приклад `.env.local` вище). `SMTP_HOST` мапити не треба —
  `mailer.service.ts` вже й так дефолтить на `localhost`, що коректно для будь-якого
  слота. Докладніше — `docs/auth-hardening-plan.md` §8, запис 2026-09-15.
