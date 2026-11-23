# Спостережуваність: логи й наскрізний id операції

Що зроблено в коді застосунків (без зовнішньої інфраструктури) і на що можна спиратися.
Чого ще немає — §6. Реалізація: `libs/shared/src/logging/`
(бекенд), `libs/ui/src/api/trace-context.ts` і `libs/ui/src/lib/report-error.ts` (фронтенди).

## 1. Один id на всю операцію

Формат — trace-id з [W3C Trace Context](https://www.w3.org/TR/trace-context/): 32 hex.

1. Фронтенд ставить на кожен запит заголовок `traceparent` (`00-<trace-id>-<parent-id>-01`,
   інтерсептор у `apps/*/src/api/http-client.ts`). Повтор запиту після refresh токена несе той
   самий заголовок — це та сама дія користувача.
2. Бекенд бере trace-id як id запиту (`genReqId`). Немає заголовка або він не за специфікацією —
   генерує власний. Довільний рядок від клієнта (колишній `X-Request-Id`) більше не приймається:
   значення осідає в логах і в довговічних job-рядках.
3. Той самий id: `ApiError.requestId` у відповіді, `correlationId` у конверті повідомлення
   (`docs/event-driven-architecture.md` §3.1.1), поле `trace_id` у кожному лог-записі запиту й
   кожної джоби, яку він породив.
4. Корінь поза HTTP (cron-тік, публікація зі скрипта) — uuid джоби чи повідомлення без дефісів:
   той самий формат, детермінований між повторами.

Фронтенд знає id ще до відповіді, тому показує його в тості помилки API і тоді, коли відповіді
не було (мережа, 502 від проксі).

## 2. Поля лог-запису

Імена — за семантичними угодами OpenTelemetry (`LOG_FIELDS` у `log-fields.ts`): коли зʼявиться
OTel SDK, запити й дашборди не переписуються. У JSON це пласкі ключі з крапкою.

| Поле | Значення | Звідки |
| --- | --- | --- |
| `service.name` | `api` / `platform-api` / `worker` | процес |
| `service.version` | `<APP_BUILD_NUMBER>+<APP_GIT_SHA>`, якщо задані | env |
| `deployment.environment.name` | `APP_ENV`, інакше `development` / `production` | env |
| `host.name`, `process.pid` | — | процес |
| `trace_id` | id операції (§1) | CLS: HTTP-вхід або конверт |
| `tenant.id` | tenant операції | CLS (`TenantContextService`) |
| `user.id` | користувач / оператор / ініціатор джоби; лише id, без email | guard після перевірки токена; актор конверта |
| `messaging.message.id`, `messaging.operation.name`, `messaging.destination.name`, `messaging.job.id` | повідомлення, його імʼя, черга, job pg-boss | записи реєстратора воркера |

`trace_id` / `tenant.id` / `user.id` додає mixin із CLS, тож вони є і в `this.logger.*` сервісів
та підписників, а не лише в записі про завершення запиту. У platform-api tenant-контексту немає,
тому `ClsModule` там підключено напряму в `app.module.ts`.

`tenant.id` і `messaging.job.id` угодами OTel не покриті — названі в тому ж стилі.

## 3. Що в лог не потрапляє

Один список на всі три процеси (`log-redaction.ts`): заголовки `authorization`, `cookie`,
`set-cookie`, ключі API, CSRF-токени → `[REDACTED]`; паролі й токени в тілі та query.
До цієї зміни platform-api писав `Authorization` і refresh-cookie оператора відкритим текстом —
локальні логи, створені раніше, варто видалити (`pnpm logs:clean`).

## 4. Куди пишеться

- **dev**: консоль + `apps/<app>/logs/<service>.log` (JSON) + `<service>-pretty.log`, ротація
  10 МБ, два попередні файли поруч.
- **prod**: лише stdout. Файл — `LOG_FILE=1` (сценарій без оркестратора).
- Падіння процесу (`uncaughtException`, `unhandledRejection`) пишеться тим самим логером рівнем
  `fatal`, а не сирим текстом у stderr.

### Команди (для людини й агента)

```bash
pnpm logs:trace <trace-id>        # усі записи операції з усіх процесів і обох фронтендів, за часом
pnpm logs:errors --since 15m      # error/fatal за проміжок (--warn — разом із warn; --json — сирі рядки)
pnpm debug:jobs <trace-id>        # джоби pg-boss цього ланцюга: черга, стан, спроби, помилка, dlq
pnpm debug:jobs --failed          # останні невдалі джоби й вміст dlq
pnpm logs:tail                    # pretty-логи трьох бекенд-процесів
```

`<trace-id>` — `requestId` з відповіді API або з тоста помилки, `trace_id` з будь-якого запису.
Типовий хід: помилка в UI → `logs:trace` (що сталося в браузері, API й воркері) → `debug:jobs`
(чи дійшла джоба, скільки спроб, чи лежить у `dlq`). `logs:*` читають лише файли поточного
checkout-а (у worktree — логи його слота); `debug:jobs` читає `pgboss.job` роллю control plane.
Cron-джоби за trace-id не знаходяться: їхній payload порожній, конверт добудовується в памʼяті.

## 5. Фронтенди

`reportError` (`libs/ui/src/lib/report-error.ts`) — єдина точка; збирач підміняється в
`apps/*/src/lib/error-reporting.ts`. Сюди приходять межі роутів, `LazyBoundary`, глобальні
`error` / `unhandledrejection` вікна і невдалі запити до API (мережа та 5xx, з `requestId`).
До звіту додаються маршрут, версія збірки, id користувача.

Збирач: консоль браузера, а в dev ще й файл. Плагін Vite dev-сервера
(`libs/ui/src/build/client-log-sink.ts`, `POST /__client-log`) дописує звіти в
`apps/<app>/logs/<web|platform-web>.log` тими самими полями, що й бекенд, тому `logs:trace`
показує браузер і сервер одним списком. Це свідомо не endpoint API: у збірці плагіна немає
(`apply: 'serve'`), публічної поверхні в проді він не додає. На стендах звіти фронтенду поки що
не збираються — туди потрібен окремий збирач (Sentry / Faro), підміна в одному файлі.

## 5.1. Сокети

Подія клієнта (`ClientEventRegistry.dispatch`) — корінь власного ланцюга, як HTTP-запит: на неї
генерується `trace_id`, у контекст кладеться `user.id`, тож логи обробника й опубліковані ним
джоби шукаються одним id. Записи життєвого циклу зʼєднання (connect / disconnect / оновлення
токена) несуть `socket.id`, `user.id`, `tenant.id` полями, а не текстом повідомлення.

## 6. Не зроблено

- Збирач помилок фронтенду на стендах (у dev — файл, §5).
- Клієнт не передає власний id у події сокета: ланцюг починається на сервері, у браузері його
  не видно.
- Іменовані події (поле `event`) замість тексту в `msg` — решта логів досі інтерполює значення
  в рядок; email користувача трапляється в повідомленнях `AuthService`.
- `MessageContextService.setActor` на HTTP-вході не викликається: актор конверта за
  замовчуванням `system`, якщо його не передали явно. Увімкнення змінить авторство записів
  активності — окреме рішення.
- OpenTelemetry (трейси, метрики), Loki, Sentry — `docs/roadmap.md` §2.6.
