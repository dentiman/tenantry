# Деплой на Hetzner через GitHub Actions

> **Статус: розгорнуто 2026-10-11.** Паралельний GitLab-пайплайн (`docs/deploy-swarm.md`, стенд
> `saas-dev` на DOCKER-DEV-01) не змінювався — це другий, незалежний таргет. Тут деплоїться
> гілка **`main`** репозиторію `github.com/dentiman/saas-skeleton` (приватний).

## 1. Топологія

```
Ваш Mac:  pnpm release:hetzner  = локальний verify (scripts/ci-verify.sh) → git push github main
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
| Конфіг | `docker/deploy.env` (git, несекретні дефолти) → **`/etc/saas/deploy.env`** (лише сервер, `root:github-runner 640`, перекриває перший) |
| Дані | `/srv/saas-prod/data/{postgres,seaweedfs}` (bind), бекапи — `/srv/saas-prod/backups` |
| Caddy | `/etc/caddy/Caddyfile` |

## 2. Чому саме так

- **Runner на тому ж вузлі.** Runner лише виходить назовні по 443 — вхідних портів, SSH-ключів у
  GitHub і `docker context` не потрібно: `docker` дивиться на локальний демон. Мінус: хто може
  запушити workflow у репо, має фактично root на сервері (`docker.sock`). Репо лишається
  приватним, колаборантів мінімум; запуск від fork-PR не вмикати.
- **verify — локально, не в пайплайні** (рішення власника 2026-10-11: стенд ще не прод). Повний
  прогін (e2e з Postgres/Valkey, lint, typecheck) на самому вузлі не вміщається у 4 ГБ поруч із
  живим стеком — OOM-killer міг би зачепити Postgres, а на GitHub-hosted він з'їдає безкоштовні
  хвилини приватного репо (2000/міс, ~9 хв на прогін). Тому шлюзом є `pnpm release:hetzner`
  (§4). Без шлюзу в CI зламаний коміт доїде до сервера: його зупинять лише пост-перевірки
  `deploy.sh` (образ сервісу, `/api/health`) і автовідкат Swarm. Повернути verify шлюзом —
  шапка `.github/workflows/verify.yml`.
- **Без registry.** Приватні образи на GitHub Free впираються в квоти Packages; а при одному вузлі
  registry нічого не дає. Деплой — `docker stack deploy --resolve-image never`. Коли з'явиться
  друга нода, потрібен registry (GHCR із classic PAT `read:packages` — fine-grained PAT для ghcr.io
  не підтримуються) і `--with-registry-auth`; запобіжники з `docs/deploy-swarm.md` §6 (довговічні
  креди, синхронний передпул, пост-перевірка образу) тоді актуальні знову.
- **Секрети — на сервері, не в git.** Комітнутий `docker/deploy.env` — «тестовий прод» зі свідомо
  відомими значеннями. Для публічного IP його значення (JWT, пароль БД, ключі S3) не годяться:
  `/etc/saas/deploy.env` згенеровано `openssl rand` на сервері й перекриває їх. Ключі S3 для
  SeaweedFS `deploy.sh` кладе в `docker/seaweedfs/s3.prod.json` у робочій теці runner-а (комітнутий
  файл із чужими ключами не використовується).

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
  `CHANNEL_WEBHOOK_SIGNATURE=record` — вебхуки Meta лише захоплюються, підпис записується, але не вимагається. Перед
  тим, як вебхук почне щось робити, повернути `enforce` у `/etc/saas/deploy.env`. Підписка номера — кнопкою в
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

**Як розкотити:** `pnpm release:hetzner` (`scripts/hetzner/release.sh`) — на поточній гілці з чистим
деревом: `scripts/ci-verify.sh` локально (потрібен Docker, dev-стек не зачіпається) → `git push github
HEAD:main` (лише fast-forward) → підтягує локальний `main`. `SKIP_VERIFY=1 pnpm release:hetzner` —
без перевірки (правка CI/доків, термінове виправлення). Перерозкат без нового коміту: Actions →
CI/CD → Run workflow.

`deploy.sh` на **першому** розкаті (стека ще нема): `stack deploy` без очікування → чекає Postgres →
збирає tools-образ → `db:roles` → чекає `api 1/1` → звичайний розкат. Далі: `stack deploy
--detach=false`, перевірка що кожен сервіс на образі саме цього SHA, `curl …/api/health` крізь Caddy,
прибирання старих образів.

Після першого розкату один раз запустіть **Ops → `seed`** (тенант `default` і оператор платформи).

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
- **SMTP не налаштовано** (`smtp.example.com` із `docker/deploy.env`): листи (відновлення пароля,
  зміна email) не ходять. Задати `SMTP_HOST/SMTP_PORT/SMTP_FROM` (+ креди, якщо воркер їх підтримує)
  у `/etc/saas/deploy.env`.
- **AI вимкнено** (`AI_ENABLED=false`, провайдер `fake`): без `AI_API_KEY` worker не стартує.
  Увімкнення — `docs/deploy-swarm.md` §7; ключ додавати в `/etc/saas/deploy.env`.
- **Бекапи вручну:** `Ops → backup_db` (дамп у `/srv/saas-prod/backups`, 15 останніх). Розкладу
  й копії поза сервером немає.
- **`main` на GitLab** лишається дзеркалом `dev` без деплою (`docs/deploy-swarm.md`). Пуш у `github`
  remote не запускає GitLab-пайплайн і навпаки.
