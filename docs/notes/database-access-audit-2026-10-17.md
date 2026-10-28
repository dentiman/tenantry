# Доступ до БД та повторна перевірка архітектури — 2026-10-17

База: `160f977`, порівняння архітектурних змін із `f675b43`.
Методика: локальний `database-access-audit` із `ruicore/codex-skills`.
Це результат аналізу, не нормативний документ чи затверджений план реалізації.

## Підсумок

- Обсяг: вибірковий аудит tenant API, спільної persistence/messaging інфраструктури,
  channel delivery, scheduled notifications і cleanup; перевірка виправлень попереднього огляду.
- Режим: статичний, без зміни бізнесового коду й без підключення до БД.
- Стек із маніфестів і lockfile: NestJS 11, Prisma/client/adapter-pg 7.8.0,
  `pg` 8.22.0, PostgreSQL 17 із pgvector 0.8.6 у local Compose.
  Фактичні версії віддалених серверів не перевірялися.
- Головна проблема у вибірці — збереження змін на основі застарілого стану,
  а не кількість запитів або відсутність repository-шару.
- Дві групи підтверджених проблем correctness: роль учасника календаря не оновлюється;
  конкурентні зміни можуть втрачати дані або дублювати факти в журналі.
- За шкалою цього skill обидві групи — **P0 (must fix correctness)**. Тут цей ярлик
  не означає аварію production або доведений витік між тенантами: перша проблема
  функціональна й локальна, друга потребує конкурентного виконання. Для планування
  спочатку усунути втрату часу події, потім роль учасника й решту state transitions.
- Виміряних performance-проблем і підтвердженого N+1 цей обсяг не встановив.
- Невідомі: реальні обсяги, частота конкурентних записів, SQL traces, latency,
  EXPLAIN та поведінка під навантаженням. Огляд не є вичерпним аудитом усіх запитів.

## Що змінилося після архітектурного огляду

| Попереднє зауваження | Стан на `160f977` | Доказ / залишок |
| --- | --- | --- |
| A1: приватний кеш переживає logout | Виправлено для перевірених явних шляхів виходу на рівні коду | Обидва `features/auth/lib/end-session.ts` чекають logout із timeout, очищують auth і виконують `window.location.assign('/login')`; tenant security page також використовує helper. Новий документ знищує in-memory QueryClient і feature stores. Браузерний сценарій не запускався. |
| A2: tenant API отримує BYPASSRLS-клієнт через DI | DI-частину виправлено | `libs/database/src/prisma.module.ts` більше не надає SystemPrismaService. Worker імпортує SystemPrismaModule явно; ESLint забороняє відповідні імпорти в `apps/api/src`. |
| A2: runtime доступ до привілейованих DB credentials | Повністю не закрито | `docs/multi-tenancy-architecture.md:179` і далі явно залишають migrator для API entrypoint і описують dev-паролі ролей та мережу як поточну межу. Це обмеження стенда, а не доказ HTTP-експлойта. До production isolation потрібні окремі секрети й migration job. |
| A3: застаріла нормативна auth-документація | Залишилося | `docs/multi-tenancy-architecture.md:311` описує platform access 60m; `docs/frontend/app-shell.md:757` заперечує platform logout endpoint, а `:771` описує localStorage без refresh. Код уже має cookie sessions/logout і default 15m у `platform-auth.module.ts:22`. |

Timeout/network failure під час logout не доводить відкликання серверної cookie-сесії.
Повне перезавантаження прибирає старий in-memory кеш, але серверне завершення сесії
варто окремо перевірити браузерним тестом із мережевою помилкою. Це межа перевірки A1,
не повторне відкриття старого дефекту кеша.

Поточні перевірки: `pnpm modules:check --strict` повідомив відсутність порушень;
`pnpm deps:check` — 492 файли, циклів немає, один warning madge.
Повний lint/typecheck/CI, DB/e2e і браузерні тести в цьому огляді не запускалися.

## Знахідки

| ID | Пріоритет skill | Місце | Форма операції | Докази | Потрібна перевірка |
| --- | --- | --- | --- | --- | --- |
| D1 | P0, локальна correctness | `CalendarService.setAttendees`, `calendar.service.ts:436` | Диференціація множини + createMany/deleteMany; атрибут існуючого зв'язку пропущено | Контролер, schema, service, DB model, наявні тести | PUT із тим самим userId та іншою role |
| D2 | P0, concurrent correctness | `CalendarService.update:272`, `setAttendees:436`; `CustomersService.update:185`, `setStatus:243`; `UsersService.setStatus:243` | Read перед tx → рішення в пам'яті → unconditional write + effects | Реальні шляхи виклику, tx helper, тести й задокументований борг | Детерміновані concurrent e2e з бар'єром читання |

### D1. Зміна ролі вже наявного учасника ігнорується

**Область:** tenant API, `PUT /calendar/events/:id/attendees`, організатор/дозволений
редактор за calendar access policy. **Статус: survived. Впевненість: висока, статична.**

`libs/contracts/src/calendar/calendar.schema.ts:73` приймає `role`; endpoint повного
складу використовує цей input (`:153`, максимум 100 елементів). `resolveAttendees`
зберігає передану роль у Map. Але `setAttendees` обчислює лише `added` та `removed`
за userId (`:453`), а при незмінному наборі id повертає `current` (`:456`). Навіть
коли інші учасники додаються/видаляються, role тих, хто залишився, не записується.

Приклад: guest уже REQUIRED; PUT того самого складу з guest OPTIONAL повертає
успіх зі старою REQUIRED. Запис для існуючого guest взагалі не виконується.
Це доводиться control flow, без припущення про SQL batching чи isolation level.

**Disproof:** перевірені контролер `calendar.controller.ts:138`, input schema,
`CalendarEventAttendee` (`calendar.prisma:96`), `resolveAttendees:797` і тест
`calendar.e2e-spec.ts:319`. Контракт не забороняє зміну role; тест no-op перевіряє
лише той самий склад із тими самими/default ролями. Unique `(tenantId,eventId,userId)`
захищає від дубля рядка, але не оновлює атрибут. Окремого role-update в цьому шляху немає.

**Операційна форма:** O(N) diff у пам'яті, N ≤ 100 на вході; createMany для доданих,
deleteMany для вилучених, окремі доменні effects. Порожній список за контрактом
повного складу означає прибрати гостей, організатор додається назад — це свідома
семантика, а не довільний broad delete. Delete обмежений eventId та списком removed;
за порожнього removed гілка не виконується. Counts create/delete тут не перевіряються;
це не причина пропуску role — потрібний update відсутній ще до DB-виклику.

**Найпростіше виправлення:** окремий `roleChanged` diff для збережених id, оновлення
лише role в тій самій захищеній транзакції; no-op тільки коли порожні всі три diff.
Зберегти RSVP, comment, respondedAt та персональні reminders; не delete+recreate.
Поведінку omitted role залишити узгодженою з контрактом, який нині нормалізує її в REQUIRED.
Не надсилати повторне запрошення тільки через зміну ролі. Single SQL не потрібний;
кілька простих update для bounded input зрозуміліші за спеціальний bulk SQL.

**Валідація:** role-only update; role-change разом із add/remove; unchanged no-op;
збереження RSVP/reminders; інший tenant; політика ролі організатора. Live e2e не виконано.

### D2. Рішення й побічні ефекти спираються на snapshot до транзакції

**Область:** tenant доменні mutations. **Статус: survived. Впевненість: висока щодо
можливого interleaving із коду; частота та runtime-відтворення не встановлені.**

Найсильніший випадок — `calendar.service.ts:278–329`:

1. Запит B змінює лише title, читає старий час T0 і обчислює `isRescheduled=false`.
2. Запит A переносить подію на T1, комітить час і переплановані reminders.
3. B записує title **і завжди записує** startsAt/endsAt/timeZone/allDay зі свого T0.
4. Подія повертається до T0, а B не викликає rescheduleReminders та не пише
   rescheduled activity: його рішення вже було false. Reminders можуть лишитися на T1.

Це не звичайний last-write-wins одного явно зміненого поля: PATCH назви записує
час, якого користувач не змінював, і розходиться з похідним станом.

Той самий клас у `setAttendees`: паралельні replacements рахують diff від старого
складу; unique constraint відхиляє дубль вставки, але не серіалізує повний replacement.
`docs/backend-conventions.md:76` уже називає обидва calendar-методи свідомим боргом.
Це підтвердження чинного боргу, не регресія останніх трьох комітів.

**Додатково виявлена повторюваність:** `CustomersService.setStatus:248–279` і
`UsersService.setStatus:255–286` роблять no-op check перед tx, а всередині оновлюють
за id та пишуть activity без перевірки фактичного переходу. Два archive/disable
запити, що прочитали старий стан, можуть записати два факти однієї зміни.
У `CustomersService.update:185–236` рішення про owner-change та previousOwner також
обчислюється за старим читанням: конкурентні призначення можуть дати хибного
previousOwner або пропустити повідомлення про фактичне перепризначення.

**Disproof:** `TenantTransactions.withTenantTx:36` встановлює RLS-контекст і
атомарність переданого callback, але не включає попередній `findOne`; у цих writes
немає expected-state/version predicate або row lock на прочитаному агрегаті.
RLS захищає tenant scope, а не актуальність snapshot. Calendar unique не захищає час.
`customers.e2e-spec.ts:212` та users status tests перевіряють послідовний no-op,
а не два simultaneous callers. Сам факт tx навколо write+activity це не спростовує.

**Операційна форма:** для update/status O(1) основних entity-операцій плюс доменні
effects; календарні effects залежать від кількості учасників/reminders. Для attendees
див. D1 щодо empty input. Unconditional entity update повертає рядок, але це не доказ
переходу зі стану, прочитаного раніше. У deleteMany по removed count ігнорується;
кілька stale replacements можуть будувати activity за старим diff незалежно від
фактично вилучених рядків. Немає підстав називати цей випадок cross-tenant write.

**Виправлення:** читати й перевіряти актуальний агрегат усередині tx під row lock
або застосувати optimistic expected-version/state predicate з обробкою конфлікту.
Саме перенесення read всередину tx без блокування/CAS недостатнє. Для calendar
практичний напрям — одна політика блокування event для всіх mutation-потоків, потім
diff, write, reminders, activity. Для простих status — conditional update + перевірка
count/returned state, activity тільки для фактичного переходу. Не потрібен глобальний
repository-шар або один складний SQL для всього агрегату.

**Tradeoff:** row lock серіалізує записи однієї події; optimistic guard додає retry/409.
Потрібні коротка транзакція, однаковий порядок locks і визначена поведінка конфлікту.

**Валідація:** детермінований barrier після read для title/reschedule race; concurrent
повні replacements; два archive/disable → один transition activity; owner A→B→C із
коректним previousOwner. Перевіряти entity, reminders, activity й notifications разом,
не лише HTTP-коди. Live DB-тести не запускалися.

## Що не зараховано до дефектів

- **Rejected: «немає tenantId у кожному where».** Tenant extension обгортає model
  operations у set_config + query; `withTenantTx` ставить контекст на початку tx.
  Відсутність повторного фільтра сама по собі не доводить порушення RLS.
- **Rejected: «будь-який raw SQL небезпечний».** `ScheduledNotificationService.claimDue`
  отримує tx, використовує bound parameters, LIMIT і SKIP LOCKED та повертає захоплені
  рядки. Окремого дефекту лише через `$queryRaw` немає.
- **Rejected: «inbox marker комітиться до бізнесової операції».** `runOnce` вставляє
  marker із skipDuplicates, перевіряє count і виконує callback у тому самому tx.
- **Rejected: «fan-out publisher слід розпаралелити».** Послідовне надсилання через
  переданий tx забезпечує спільний rollback; цикл тут не автоматично дефект.
- **Rejected: «attendees — N+1 перевірка користувачів».** `resolveAttendees` дедуплікує
  Map і робить один findMany для ids; input обмежений 100. Персональні activity,
  reminders та notifications мають власну семантику, простий bulk rewrite її втратить.
- **Downgraded/P2: cleanup orphan files.** Є O(N) S3 delete + DB delete, читання пачками
  по 100. Порядок S3→DB явно дозволяє повторне прибирання після збою. Пачка не обмежує
  загальну тривалість job; без метрик backlog/latency це кандидат на вимірювання,
  не підстава міняти порядок видалення чи додавати складний bulk SQL.
- **Перевірена позитивна межа:** channel delivery має claim → зовнішнє надсилання →
  settle з окремими tx. Це не повна сертифікація доставки/провайдера.

## Порядок подальшої роботи

1. Закрити calendar concurrency так, щоб час, склад, reminders й activity узгоджувалися.
2. Додати role diff, зберігши інші атрибути зв'язку.
3. Застосувати guarded transitions до customers/users; перевірити дублікати activity.
4. Виправити застарілий опис platform-auth і окремо запланувати production DB credentials.
5. Після correctness виміряти queries/latency на великих календарях та cleanup backlog.

## Межі доказів і відкриті питання

Релевантні джерела: `libs/database/package.json`, `pnpm-lock.yaml`, local Compose,
PrismaModule/SystemPrismaModule, tenant extension/transactions, calendar contract/controller/
service/schema/e2e, customers/users service та status e2e, messaging inbox/publisher,
scheduled notifications, channel delivery/status, cleanup subscribers; документація
backend conventions/multi-tenancy/calendar/modules/auth і попередній архітектурний звіт.
Міграції всіх доменів, усі AI retrieval запити та всі індекси повторно не переглядалися.

Для сильніших runtime-висновків потрібні ізольований test stack і concurrency e2e;
для performance — представницькі дані й query traces. Для політики role організатора
потрібне продуктове рішення: завжди REQUIRED чи дозволено OPTIONAL. Це не блокує
підтверджений дефект role для звичайного guest.

Бізнесовий код, конфігурація, дані БД та встановлені skills не змінювалися.
