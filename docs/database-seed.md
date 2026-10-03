# База даних — seed-дані та повний ресет

> Стосується проєкту в цілому (БД одна на весь монорепо — і `apps/api`, і `apps/platform-api`,
> і `apps/worker` ходять у неї), тому винесено з мультитенантних доків окремо. Механіка ролей
> Postgres і RLS, від яких залежить сам факт, чому seed іде під певною роллю, а не будь-якою —
> [multi-tenancy-architecture.md](multi-tenancy-architecture.md) (§4 «Ролі Postgres»).

Джерело: [libs/database/prisma/seed.ts](../libs/database/prisma/seed.ts),
[libs/database/scripts/reset-db.ts](../libs/database/scripts/reset-db.ts).

## pgvector bootstrap (AI-2a)

`db:roles` тепер також встановлює `vector` 0.8.6 під адміністратором у цільову
БД та `template1` (для автоматичної Prisma shadow DB). `db:reset` і e2e вже
викликають `db:roles`, тому окремий ручний крок для них не потрібен.
`saas_migrator` не отримує superuser; SQL-міграція перевіряє готовність extension.
Для нового dev-volume те саме робить `docker/postgres/init/02-vector.sql`.

Для поточного локального переходу Alpine → pgvector/Debian старий PG-volume
видалено, схему й тестові дані відтворено без backup/restore; [порядок і обмеження](ai-assistant-implementation-plan.md#4-bootstrap-міграції-й-наявні-інсталяції).

## Стандартні ідентичності

Свіжий дев-інстанс (після `pnpm db:seed` або повного `pnpm db:reset`) завжди піднімається
з рівно трьома стандартними ідентичностями — не випадковими даними, а фіксованими,
передбачуваними значеннями, на які можна покладатись у скриптах/тестах/демо:

| Хто               | Де                               | Логін                  | Пароль          | Роль                                                                                                                    |
| ----------------- | -------------------------------- | ---------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Tenant            | `tenants`                        | slug `default`         | —               | `id` = well-known `00000000-0000-4000-8000-000000000001` (той самий у `StaticTenantResolver`-fallback і в RLS-міграції) |
| Tenant-адмін      | `users`, у tenant `default`      | `admin@example.com`    | `Admin1234567`  | `ADMIN`                                                                                                                 |
| Platform-оператор | `platform_users` (control plane) | `platform@example.com` | `Platform12345` | — (без ролей, оператор над усіма tenant-ами)                                                                            |

Обидва юзери — `upsert` за унікальним ключем (`tenantId_email` / `email`), тому `pnpm db:seed`
можна запускати повторно на вже заповненій БД без побічних ефектів — існуючі рядки не
чіпаються (`update: {}`), нові з'являються, тільки якщо їх іще немає.

> **AUTH-0 (2026-09-13): пароль tenant-адміна змінено з `Admin12345` на `Admin1234567`** —
> мінімальна довжина пароля стала 12 символів (`PasswordSchema`, NIST 800-63B: довжина
> замість композиційних правил). Через `update: {}` на **наявній** dev-БД сід пароль не
> переписує: там лишається `Admin12345` і він працює (нова політика діє лише на запис
> пароля, старі хеші живі) — до `pnpm db:reset`. `Platform12345` уже мав 13 символів.

## `pnpm db:reset` — повний цикл в одну команду

Для «почати геть з нуля»:

```
DROP DATABASE (WITH FORCE) → CREATE DATABASE → db:roles → db:migrate:deploy → db:seed
```

Свідомо **не** `prisma migrate reset`. Той дропає й перестворює саму схему `public`
(не всю БД), а `ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator IN SCHEMA public GRANT ...`
(`ensure-roles.ts`, [multi-tenancy-architecture.md §4](multi-tenancy-architecture.md#4-ролі-postgres))
прив'язаний до **OID** конкретної схеми — після `DROP SCHEMA`/`CREATE SCHEMA` OID новий,
і правило default-privileges для старої схеми більше ні на що не діє: щойно замігровані
таблиці `saas_app` не отримає жодних прав автоматично, RLS-політики й `resolve_tenant` при
цьому відновляться (вони в самій міграції), а от DML-гранти — ні. `reset-db.ts` уникає цього,
дропаючи й перестворюючи **цілу БД** (кластерний рівень: ролі й прив'язки схема↔дефолт-привілеї
не існують до першого `db:roles`-виклику на свіжій БД — `ensure-roles.ts` встановлює їх заново
явно, не покладаючись на те, що щось «саме зберіглось»).

Запобіжник: скрипт відмовляється виконуватись, якщо host у `POSTGRES_ADMIN_URL` не
`localhost`/`127.0.0.1` — це не заміна обережності, а страховка від фатальної помилки з
неправильним `.env`.
