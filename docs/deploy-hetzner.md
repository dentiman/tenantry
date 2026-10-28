# Деплой на Hetzner через GitHub Actions

> **Статус: розгорнуто 2026-10-11.** Паралельний GitLab-пайплайн (`docs/deploy-swarm.md`, стенд
> `saas-dev` на DOCKER-DEV-01) не змінювався — це другий, незалежний таргет. Тут деплоїться
> гілка **`main`** репозиторію [`github.com/dentiman/tenantry`](https://github.com/dentiman/tenantry)
> (публічний, MIT; джерело правди коду). GitLab `origin` несе ту саму історію з тими самими SHA.
> Попередній приватний `dentiman/saas-skeleton` виведено з обігу (архівується) і більше не деплоїть.
> 2026-10-28 історію переписано (`git filter-repo`), щоб прибрати секрети й клієнтські дані; секретів
> у git відтоді немає взагалі (§2).

## 1. Топологія

```
Ваш Mac:  pnpm release:hetzner  = локальний verify (scripts/ci-verify.sh) → dev і main → HEAD
                                   на github і origin (scripts/git-sync.sh)
  │
GitHub (push у main) ── Actions CI/CD: build → deploy (verify у пайплайні ВІДКЛЮЧЕНО)
  ▼
Hetzner VPS (Ubuntu 26.04, 2 vCPU / 4 ГБ + 4 ГБ swap, Helsinki)
  ├─ self-hosted runner `hetzner-hel1` (user github-runner, systemd) ── build, deploy, ops
  ├─ Docker Swarm, один вузол, стек `saas-prod` (той самий docker/docker-compose.stack.yml)
  └─ Caddy :80/:443 ── TLS (Let's Encrypt) ─► 127.0.0.1:8511 web | :8512 platform-web | :8503 S3
```

| Що | Де |
| --- | --- |
| Публічні URL | `https://web.2-29-1-13.sslip.io` (tenant), `https://platform.…` (control plane), `https://s3.…` (presigned URL браузера) |
| Домен | `sslip.io` — безкоштовний wildcard-DNS: `<будь-що>.2-29-1-13.sslip.io` → `2.29.1.13`. Сертифікат справжній, Caddy отримує його сам. GitHub домену й HTTPS для застосунків **не дає** (лише Pages для статики) |
| Образи | `saas/<app>:<sha>` у локальному Docker вузла; **registry немає** (single-node). 2 найновіші (поточний + попередній) тримаються для автовідкату |
| Конфіг | `docker/stack.env` (git, несекретний, спільний із GitLab) → **`/etc/saas/deploy.env`** (усі секрети й публічні URL; лише сервер, `root:github-runner 640`, перекриває перший; шаблон — `docker/deploy.env.example`) |
| Дані | `/srv/saas-prod/data/{postgres,seaweedfs}` (bind), бекапи — `/srv/saas-prod/backups` |
| Caddy | `/etc/caddy/Caddyfile` |

## 2. Чому саме так

- **Runner на тому ж вузлі.** Runner лише виходить назовні по 443 — вхідних портів, SSH-ключів у
  GitHub і `docker context` не потрібно: `docker` дивиться на локальний демон. Мінус: хто може
  запушити workflow у репо, має фактично root на сервері (`docker.sock`). Репо публічне, тому
  запуск чужого коду закрито кількома запобіжниками — §4.1.
- **verify — локально, не в пайплайні** (рішення власника 2026-10-11: стенд ще не прод). Повний
  прогін (e2e з Postgres/Valkey, lint, typecheck) на самому вузлі не вміщається у 4 ГБ поруч із
  живим стеком — OOM-killer міг би зачепити Postgres, а на GitHub-hosted (~9 хв на прогін) не
  вмикався, поки репо був приватним і хвилини лімітовані; для публічного `tenantry` ліміту хвилин
  немає, але рішення не переглядалося. Тому шлюзом є `pnpm release:hetzner`
  (§4). Без шлюзу в CI зламаний коміт доїде до сервера: його зупинять лише пост-перевірки
  `deploy.sh` (образ сервісу, `/api/health`) і автовідкат Swarm. Повернути verify шлюзом —
  шапка `.github/workflows/verify.yml`.
- **Без registry.** Приватні образи на GitHub Free впираються в квоти Packages; а при одному вузлі
  registry нічого не дає. Деплой — `docker stack deploy --resolve-image never`. Коли з'явиться
  друга нода, потрібен registry (GHCR із classic PAT `read:packages` — fine-grained PAT для ghcr.io
  не підтримуються) і `--with-registry-auth`; запобіжники з `docs/deploy-swarm.md` §6 (довговічні
  креди, синхронний передпул, пост-перевірка образу) тоді актуальні знову.
- **Секрети — лише на сервері.** У git є тільки несекретний `docker/stack.env` (SMTP-заглушки,
  AI-провайдер/модель/квота, бекенд знань). Усі секрети (JWT, паролі БД і робочих ролей, Redis,
  ключі S3, AI-ключі) і публічні URL — у **`/etc/saas/deploy.env`**, згенерованому `openssl rand` на
  сервері; це єдине місце: у GitHub Secrets нічого немає, runner читає файл на тому ж вузлі
  (`scripts/hetzner/common.sh`). Порожнє обовʼязкове значення валить розкат до того, як стек чіпали
  (`scripts/deploy/require-env.sh`). `docker/seaweedfs/s3.prod.json` у git немає: його на кожен
  розкат генерує `scripts/deploy/write-s3-config.sh` з `S3_ACCESS_KEY`/`S3_SECRET_KEY`. Копія файлу —
  у менеджері паролів власника: втрата = неможливо розшифрувати збережені AI-ключі
  (`AI_SECRETS_KEY`) і токени (`ENCRYPTION_KEY`). Зміна паролів ролей БД — `docs/deploy-swarm.md` §7,
  «Ролі БД і паролі».

## 3. Мережа й безпека

- **UFW:** 22, 80, 443 (+ 51820/udp — приватний WireGuard-VPN власника, до проєкту не належить).
- **Docker обходить UFW** для опублікованих портів (DNAT → FORWARD). Порти стеку (`8501/8502/8503/
  8511/8512`) слухають на `0.0.0.0` (Swarm не вміє `host_ip`), тому `saas-docker-firewall.service`
  (`/usr/local/sbin/saas-docker-firewall.sh`) додає у `DOCKER-USER` DROP для них із публічного
  інтерфейсу. Caddy ходить на `127.0.0.1` — його це не зачіпає. Перевірка після змін:
  `curl -m5 http://2.29.1.13:8511/` має зависнути/відмовити, а `https://web.…` — відповісти.
- **Порти Swarm** (2377, 7946, 4789) UFW закриває; Swarm ініціалізовано з пулом `10.200.0.0/16`,
  щоб overlay-мережі не перетиналися з `wg0` (`10.8.0.0/24`).
- **Скільки проксі довіряти:** перед api стоять два — Caddy і nginx у `web`, тож у
  `/etc/saas/deploy.env` `TRUST_PROXY_HOPS="2"` (дефолт стеку 1 — лише nginx). З одиницею `req.ip` =
  шлюз Docker `172.18.0.1` для всіх: ліміти по IP (`loginIp`, `refresh`, скидання пароля) спільні на
  всіх користувачів, а адреса в журналі сесій хибна. Перевірка: в логу api поле `req.ip` має бути
  реальною адресою клієнта (`X-Forwarded-For` зліва), а не `172.18.0.1`.
- **Cookie:** `COOKIE_SECURE=true` (HTTPS). Origin-и (`REALTIME_ALLOWED_ORIGINS`, CORS, S3 CORS,
  `APP_PUBLIC_URL`) — `https://…sslip.io` у `/etc/saas/deploy.env`.
- **Вебхуки каналів (CHAT-3b1):** `scripts/hetzner/common.sh` типово ставить `CHANNEL_WEBHOOK_BASE_URL` = `APP_PUBLIC_URL`
  (публічна адреса вебхука = `<base>/api/public/channels/<provider>/<ключ>`; Caddy і nginx пропускають шлях) і
  `CHANNEL_WEBHOOK_SIGNATURE` лишається типовим `enforce` (від CHAT-3b2 вебхук створює розмови й квитанції, тож запит без
  чинного підпису відхиляється; на час налагодження можна поставити `record` у `/etc/saas/deploy.env`). Підписка номера — кнопкою в
  Налаштування → Messaging; вона перевизначає адресу **номера**, а не WABA (на спільному тестовому WABA події цього
  номера перестануть іти в інший проєкт, доки не натиснути «Unsubscribe»).
- Початкові паролі адміна й оператора платформи — `SEED_ADMIN_PASSWORD` / `SEED_PLATFORM_PASSWORD`
  там же (сід бере їх з env; у коді лишаються лише дефолти для локальної розробки/CI). **Змініть їх
  у UI після першого входу.** Логіни: `admin@example.com` (tenant `default`) і
  `platform@example.com` (control plane).

## 4. Workflow'и

| Файл | Коли | Що |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | push у `main`, вручну | `build` ×5 образів (self-hosted, по одному) → `deploy` (`scripts/hetzner/deploy.sh`) |
| `.github/workflows/verify.yml` | лише вручну / `workflow_call` | повна перевірка на GitHub-hosted (`scripts/ci-verify.sh`); не шлюз деплою |
| `.github/workflows/ops.yml` | вручну («Run workflow») | `seed`, `db_roles`, `seed_demo`, `demo_reset`, `backup_db` (`scripts/hetzner/ops.sh`) |

**Як розкотити:** `pnpm release:hetzner` (`scripts/hetzner/release.sh`) — на гілці `dev` з чистим
деревом: `scripts/ci-verify.sh` локально (потрібен Docker, dev-стек не зачіпається) → `dev` і `main`
на обох remote-ах ставляться на HEAD (`scripts/git-sync.sh`, лише fast-forward, без force-push) →
пуш у `github/main` запускає розкат, пуш `dev` у GitLab — розкат `saas-dev`. Після релізу `main` ==
`dev`. GitLab доступний лише з робочої мережі: недоступний → попередження, GitHub оновлюється, а
GitLab наздоганяє наступним запуском. `SKIP_VERIFY=1 pnpm release:hetzner` — без перевірки (правка
CI/доків, термінове виправлення). Перерозкат без нового коміту: Actions → CI/CD → Run workflow.

Звичайна синхронізація без деплою Hetzner — `pnpm git:sync`: поточний `dev` → `dev` на обох remote-ах.

`deploy.sh` на **першому** розкаті (стека ще нема): `stack deploy` без очікування → чекає Postgres →
збирає tools-образ → `db:roles` → чекає `api 1/1` → звичайний розкат. Далі: `stack deploy
--detach=false`, перевірка що кожен сервіс на образі саме цього SHA, `curl …/api/health` крізь Caddy,
прибирання старих образів.

Після першого розкату один раз запустіть **Ops → `seed`** (тенант `default` і оператор платформи).

### 4.1. Runner і публічний репозиторій

Self-hosted runner `hetzner-hel1` (label `hetzner`) зареєстровано на `dentiman/tenantry`. Публічний
репо + runner із `docker.sock` — тому запобіжники:

- **Тригери** лише `push` у `main` і `workflow_dispatch`; `pull_request` немає ніде — PR із форка не
  виконується на сервері.
- **Job-и прив'язані до репо** (`if: github.repository == 'dentiman/tenantry' && …`): форк із тими
  самими workflow-ами не ставить job-и в чергу на наш runner.
- **Налаштування репо:** Actions → схвалення workflow-ів для **всіх** зовнішніх контриб'юторів.
- **Секретів у GitHub немає** — лише `/etc/saas/deploy.env` на сервері (§2).

Перереєстрація (новий репо, зміна імені, втрачений токен) — на сервері від `github-runner` у теці
runner-а:

```bash
# на Mac: одноразовий токен реєстрації (живе 1 год)
gh api -X POST repos/dentiman/tenantry/actions/runners/registration-token --jq .token
# на сервері: зняти стару службу й реєстрацію (стару — `config.sh remove --token <remove-token
# старого репо>` або, якщо репо вже недоступний, видалити .runner/.credentials*)
sudo ./svc.sh stop && sudo ./svc.sh uninstall
./config.sh --url https://github.com/dentiman/tenantry --token <токен> \
  --name hetzner-hel1 --labels hetzner --unattended
sudo ./svc.sh install github-runner && sudo ./svc.sh start
```

Після перереєстрації перевірити: Settings → Actions → Runners показує `hetzner-hel1` Idle, а
Settings → Actions → General → «Require approval for all external contributors» увімкнено.

## 5. Домен замість sslip.io

1. A-запис домену (і `web.`/`platform.`/`s3.` піддомени) → `2.29.1.13`.
2. `/etc/caddy/Caddyfile`: замінити три імені сайтів; `systemctl reload caddy`.
3. `/etc/saas/deploy.env`: `S3_ENDPOINT`, `S3_CORS_ALLOWED_ORIGINS`, `REALTIME_ALLOWED_ORIGINS`,
   `PLATFORM_CORS_ALLOWED_ORIGINS`, `APP_PUBLIC_URL`.
4. Перерозкатити (`Run workflow` на `deploy.yml`).

## 6. Обмеження й борги

- **Диск 38 ГБ.** Кеш збірки росте з кожним SHA, тому `deploy.sh` після успіху тримає лише 6 ГБ кешу
  (`docker builder prune --max-used-space 6GB`) і 2 найновіші образи кожного сервісу. Образи Docker 29
  лежать у `/var/lib/containerd`, а не `/var/lib/docker` — дивитись `docker system df` і `df -h /`.
- **4 ГБ RAM.** Збірки йдуть по одній, є 4 ГБ swap. Якщо збірки впиратимуться в OOM — збільшити
  вузол у консолі Hetzner (rescale) або додати `--memory` у `docker build`. Перевірка:
  `journalctl -k | grep -i oom`.
- **SMTP не налаштовано** (`smtp.example.com` із `docker/stack.env`): листи (відновлення пароля,
  зміна email) не ходять. Задати `SMTP_HOST/SMTP_PORT/SMTP_FROM` (+ креди, якщо воркер їх підтримує)
  у `/etc/saas/deploy.env`.
- **AI:** провайдер, модель, денна квота й бекенд знань — у `docker/stack.env` (`AI_ENABLED=true`,
  OpenRouter). Ключ — `AI_API_KEY` в `/etc/saas/deploy.env` або через control plane (тоді потрібен
  `AI_SECRETS_KEY` там же); без ключа worker не стартує. Порядок і стеля витрат —
  `docs/deploy-swarm.md` §7.
- **Бекапи вручну:** `Ops → backup_db` (дамп у `/srv/saas-prod/backups`, 15 останніх). Розкладу
  й копії поза сервером немає.
- **`main` на GitLab** — дзеркало `dev` без деплою (`docs/deploy-swarm.md`). Обидва remote-и несуть
  ті самі SHA, але пайплайни незалежні: пуш у `github` не запускає GitLab-пайплайн і навпаки. Гілки
  синхронізує `scripts/git-sync.sh` (`pnpm git:sync` / `pnpm release:hetzner`), а не ручний `git push`.
