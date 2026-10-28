# Code Review — Sentry find-bugs — 2026-10-17

Проверены изменения `f675b43...160f977` (3 коммита, 80 файлов): разделение
DB-полномочий, навигация/Playground и новый logout. База задана явно, поскольку
GitLab default branch `main` не совпадает с основной веткой разработки `dev`.
Незакоммиченный `database-access-audit-2026-10-17.md` не входит в этот diff.

Установлен и применён `getsentry/skills`, `skills/find-bugs`, локально
скіл `find-bugs` (Sentry). Источник:
https://github.com/getsentry/skills/tree/main/skills/find-bugs.
Это анализ изменений, не полный security-аудит всей кодовой базы.

## Объём и проверка перед выводами

Прочитаны изменённые строки всех 80 файлов; перечень в конце отчёта.
Полностью прочитаны ключевые реализации: оба `end-session.ts`, оба account footer,
security page, изменённые nav/Playground-файлы, public-guide rail, nav test/Vitest config,
PrismaModule/SystemPrismaModule, WorkerModule, ensure-roles, оба Hetzner-скрипта,
Dockerfile.tools, SQL init и ESLint config. Дополнительно прочитаны оба init-auth,
HTTP clients, auth stores, tenant auth guards, релевантные generated API функции,
logout controllers, Hetzner deploy flow и зависимости shared/DI.

В больших документах, CI/stack-конфигурации и 46 e2e-файлах проверялся полный diff
с необходимым контекстом; весь неизменённый текст этих файлов не перечитывался целиком.
Следовательно, формальное требование skill о полном чтении каждого файла выполнено
для основных реализаций, а для этой группы покрытие ограничено изменениями.
Не следует считать этот отчёт проверкой всех исторических сценариев e2e или всех CI jobs.

### Поверхность изменений

| Группа | Входы, данные и полномочия | Внешние вызовы / состояние |
| --- | --- | --- |
| Logout обоих SPA и account security | Нажатие logout, ответ revokeSession, access token в памяти, httpOnly refresh-cookie | POST logout, очистка store, hard navigation; при старте refresh и me |
| Nav, guide, Playground | URL, VITE_PLAYGROUND, текущая identity/role; новые HTTP API и DB-запросы не добавлены | Router redirects, sidebar state; фиксированные ссылки, React rendering |
| PrismaModule, SystemPrismaModule, WorkerModule | DI composition, DB connection env, tenant context | Разделение app/platform connection pools; crypto не меняется |
| ensure-roles | Административные env и имя целевой БД; фиксированные имена ролей | CREATE/ALTER ROLE, grants; пароль экранируется `client.escapeLiteral`, логируются имена переменных, не значения |
| CI, stack, Hetzner, Dockerfile, deploy.env, SQL init | Операторские настройки ролей, image/config inputs | Docker execution и DB bootstrap; URL составляется из env, допустимый алфавит пароля явно задан в runbook |
| 46 e2e-файлов | Существующие test fixtures | Только добавление импорта и регистрации SystemPrismaModule; тестовый доступ BYPASSRLS явный |
| ESLint и docs | Статическая конфигурация/тексты | Runtime-входов и новых сетевых операций нет |

### Чеклист skill

«Нет новой находки» означает результат проверки diff, а не гарантию всей системы.
Пункты без соответствующей поверхности (например, crypto в nav order) неприменимы.

| Пункт | Результат |
| --- | --- |
| Injection: SQL/command/template/header | Новая находка не подтверждена: значения новых password SQL экранируются, role identifiers фиксированы; shell password args заключены в кавычки. Старые динамические identifiers не объявлены новой регрессией. |
| XSS | Новая находка не подтверждена: фиксированные route targets/labels, React rendering; HTML sinks в diff не добавлены. |
| Authentication | Найден F1: после неудачного logout startup восстанавливает сессию. |
| Authorization/IDOR | Новая находка не подтверждена: удалён лишний DI provider, worker регистрирует его явно; backend authz не ослаблен. Playground guard не заменяет серверную авторизацию. |
| CSRF | Новая находка не подтверждена: logout остаётся POST с OriginGuard; generated client отправляет credentials. |
| Race conditions / TOCTOU | In-flight refresh остаётся кандидатом для browser regression; отдельный подтверждённый новый race не заявляется. F1 не требует параллельного refresh. |
| Session lifecycle | F1 подтверждён на реальных функциях с mock HTTP; успешный logout проверен как контроль. |
| Cryptography | Новые алгоритмы/ключи не вводятся; известные dev DB credentials явно сохраняются как компромисс стенда. |
| Information disclosure | Новая подтверждённая находка отсутствует; значения секретов в отчёт не включены. DI separation не объявляется защитой от захваченного контейнера. |
| DoS | Новая находка не подтверждена: новые публичные batch inputs не добавлены. Реальную длительность deployment/DB locks не измеряли. |
| Business logic | Навигационные snapshots и frontend suite проходят. Ошибка завершения сессии — F1. |

### Выполненные проверки и ограничения

- `pnpm --filter @saas-skeleton/web test -- src/nav.test.ts`: фактически runner выполнил
  всю frontend suite — **28 файлов, 291 тест, все прошли**.
- `pnpm --filter @saas-skeleton/web --filter @saas-skeleton/platform-web typecheck`:
  **оба прошли**.
- Локальный Node/TypeScript VM experiment: исходные endSession/initAuth транспилированы
  без изменения логики; использованы реальные Zustand stores. Подменены только HTTP,
  location и localStorage. Четыре сценария дали ожидаемые assertions:

| Plane | Logout | Identity после endSession → initAuth |
| --- | --- | --- |
| tenant | 204, cookie недействительна | отсутствует |
| tenant | network error, cookie действительна | восстановлена |
| platform | 204, cookie недействительна | отсутствует |
| platform | network error, cookie действительна | восстановлена |

Это подтверждает клиентский control flow, но не заменяет браузерный тест cookie/HTTP.
DB/e2e, полный backend CI, сборка Docker, удалённый deploy и реальные роли БД
не запускались/не проверялись. Внешние аккаунты, credentials и данные не изменялись.
Наличие успешного browser logout в auth-hardening-plan подтверждает happy path,
но не опровергает сетевую ошибку. Отдельных тестов endSession на failure/timeout
поиск в `apps` не обнаружил.

## Результат: одна подтверждённая находка

### F1 — Medium: неудачный logout немедленно восстанавливает прежнюю сессию

**Место:** `apps/web/src/features/auth/lib/end-session.ts:24–26` и
`apps/platform-web/src/features/auth/lib/end-session.ts:14–18`.

**Условие:** POST logout не дошёл до сервера, получил ошибку до revoke/clear-cookie,
либо был прерван timeout до завершения logout; при этом следующий refresh проходит.
Не любой timeout оставляет сессию действующей: если сервер успел revoke, восстановления нет.

**Проблема:** catch подавляет ошибку, после чего `location.assign('/login')` загружает
приложение заново. Оба main перед router вызывают initAuth, а тот безусловно выполняет
refresh и me. Если cookie ещё действительна, store снова получает прежнюю identity.
Tenant requireGuest дополнительно отправит пользователя с `/login` в `/workspace`.
На общем компьютере это означает, что пользователь нажал «Выйти», но доступ сохранился.

**Доказательство:** trace локального эксперимента для обоих SPA:
`logout:network-error → navigate:/login → startup:refresh → identityRestored:true`.
С успешным logout в той же проверке `identityRestored:false`.
Generated helpers действительно принимают переданный AbortSignal; ошибка не в аргументах.
Backend чистит cookie после успешного вызова service, а JS не может удалить httpOnly cookie.

**Отношение к diff:** прежнее подавление logout-error тоже оставляло серверную сессию,
но SPA-navigation не вызывала startup refresh немедленно. Новая hard navigation делает
автоматическое восстановление частью самого logout-потока. При этом она правильно
устраняет прежнюю проблему оставшегося QueryClient/feature cache — откатывать это решение
без замены не стоит.

**Направление исправления:** сохранить очистку приватного состояния и reload, но отличать
подтверждённый logout от незавершённого. До подтверждения revoke не запускать автоматическое
восстановление identity; предусмотреть явный pending-logout сценарий с повтором серверного
logout и понятным состоянием ошибки. Если используется marker, он должен переживать reload,
учитываться всеми refresh-путями и сниматься после подтверждённого logout/явного нового login.
Marker лишь подавляет локальное восстановление, а серверную сессию не отзывает.
Простое увеличение трёхсекундного timeout проблему не решает.

**Регрессионная проверка:** для обоих SPA отклонить только POST logout, разрешив затем
refresh/me; после выхода прежняя identity не должна автоматически появляться. Отдельно:
timeout до revoke, успешный logout, revoke текущего устройства, refresh in flight и
переход A→logout→B без старого кеша.

## Отклонённые подозрения и оставшийся долг

- Удаление SystemPrisma из tenant module не оставило найденного runtime-потребителя
  без DI: прямых инъекций в tenant source нет; shared ChannelPendingSweeper подключён
  через worker providers, где SystemPrismaModule теперь указан явно.
- E2e добавляют system provider для fixtures. Это само по себе не означает, что
  tenant services начали исполнять запросы с BYPASSRLS.
- Playground скрыт в rail и закрыт parent beforeLoad для прямых маршрутов. То, что
  определения routes остаются в bundle, само по себе не является обходом guard.
- Runbook ограничивает пароли URL-safe алфавитом. Отсутствие URL encoding при таком
  контракте не заявляется отдельной регрессией; автоматическая валидация могла бы помочь.
- Известные dev credentials, migrator в API runtime и устаревшие auth-документы остаются
  долгом предыдущего архитектурного отчёта. Calendar/customer/user дефекты из DB-аудита
  не относятся к этим трём коммитам и повторно в findings не включены.

Бизнесовый код не менялся. Добавлен только этот отчёт; skill установлен глобально.

## Перечень всех файлов diff

Ниже — manifest покрытия изменённых строк, не утверждение о полном перечитывании
неизменённого содержимого каждого большого файла (ограничение описано выше).

```text
.gitlab-ci.yml
Dockerfile.tools
apps/api/test/account.e2e-spec.ts
apps/api/test/activities.e2e-spec.ts
apps/api/test/ai-availability.e2e-spec.ts
apps/api/test/ai-citations.e2e-spec.ts
apps/api/test/ai-cost-ledger.e2e-spec.ts
apps/api/test/ai-disabled.e2e-spec.ts
apps/api/test/ai-knowledge-ingest.e2e-spec.ts
apps/api/test/ai-knowledge.e2e-spec.ts
apps/api/test/ai-message-limit.e2e-spec.ts
apps/api/test/ai-realtime.e2e-spec.ts
apps/api/test/ai-retention.e2e-spec.ts
apps/api/test/ai-state.e2e-spec.ts
apps/api/test/ai-usage-quota.e2e-spec.ts
apps/api/test/ai.e2e-spec.ts
apps/api/test/auth-recovery.e2e-spec.ts
apps/api/test/auth-sessions.e2e-spec.ts
apps/api/test/auth.e2e-spec.ts
apps/api/test/calendar.e2e-spec.ts
apps/api/test/chat-channels-ingest.e2e-spec.ts
apps/api/test/chat-channels-webhook.e2e-spec.ts
apps/api/test/chat-customer-inbox.e2e-spec.ts
apps/api/test/chat-delivery.e2e-spec.ts
apps/api/test/chat-dev-tools.e2e-spec.ts
apps/api/test/chat-inbox-signal.e2e-spec.ts
apps/api/test/chat-mark-read.e2e-spec.ts
apps/api/test/chat-meta-webhook.e2e-spec.ts
apps/api/test/chat-notifications.e2e-spec.ts
apps/api/test/chat-outbound.e2e-spec.ts
apps/api/test/chat-outreach.e2e-spec.ts
apps/api/test/chat-realtime.e2e-spec.ts
apps/api/test/chat-socket-events.e2e-spec.ts
apps/api/test/chat-webhook-capture.e2e-spec.ts
apps/api/test/chat-webhook-subscription.e2e-spec.ts
apps/api/test/chat-whatsapp-connection.e2e-spec.ts
apps/api/test/chat-whatsapp-send.e2e-spec.ts
apps/api/test/chat.e2e-spec.ts
apps/api/test/customers.e2e-spec.ts
apps/api/test/files.e2e-spec.ts
apps/api/test/messaging.e2e-spec.ts
apps/api/test/notifications.e2e-spec.ts
apps/api/test/numbering.e2e-spec.ts
apps/api/test/rate-limit.e2e-spec.ts
apps/api/test/realtime.e2e-spec.ts
apps/api/test/settings.e2e-spec.ts
apps/api/test/tenant-isolation.e2e-spec.ts
apps/api/test/users.e2e-spec.ts
apps/platform-web/src/app-shell/account-footer.tsx
apps/platform-web/src/features/auth/lib/end-session.ts
apps/web/src/app-shell/account-footer.tsx
apps/web/src/features/account/pages/security.tsx
apps/web/src/features/ai/ai.nav.ts
apps/web/src/features/auth/lib/end-session.ts
apps/web/src/features/calendar/calendar.nav.ts
apps/web/src/features/chat/chat.nav.ts
apps/web/src/features/guide/components/public-guide-rail.tsx
apps/web/src/features/guide/guide.nav.ts
apps/web/src/features/playground/playground.flag.ts
apps/web/src/features/playground/playground.nav.ts
apps/web/src/features/playground/playground.routes.tsx
apps/web/src/features/settings/settings.nav.ts
apps/web/src/nav.test.ts
apps/web/vitest.config.ts
apps/worker/src/worker.module.ts
docker/deploy.env
docker/docker-compose.stack.yml
docker/postgres/init/01-roles.sql
docs/notes/architecture-review-2026-10-15.md
docs/auth-hardening-plan.md
docs/deploy-hetzner.md
docs/deploy-swarm.md
docs/frontend/app-shell.md
docs/multi-tenancy-architecture.md
eslint.config.mjs
libs/database/scripts/ensure-roles.ts
libs/database/src/prisma.module.ts
libs/database/src/system-prisma.module.ts
scripts/hetzner/common.sh
scripts/hetzner/ops.sh
```
