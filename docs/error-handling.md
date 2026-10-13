# Обробка помилок: наскрізна архітектура (фаза 2.2)

Єдиний контракт помилки від Prisma до поля форми. Будь-яка помилка API — незалежно від того,
хто її кинув (Zod-валідація, Prisma, guard, сервіс чи невідомий баг) — виходить назовні
в одному форматі `ApiError`, а фронтенд має єдину точку розбору і три канали реакції:
поле форми, глобальний toast або refresh-інтерсептор.

```
┌─────────────────────────  БЕКЕНД (apps/api)  ─────────────────────────┐
│                                                                        │
│  ZodValidationPipe ──┐                                                 │
│  Guards/Сервіси ─────┤                                                 │
│  Prisma ─────────────┼──▶ AllExceptionsFilter (@Catch() — ловить ВСЕ)  │
│  Невідомий виняток ──┘         │                                       │
│                                ▼                                       │
│              ApiError { statusCode, code, message,                     │
│                         fieldErrors?, requestId }                      │
└────────────────────────────────┬───────────────────────────────────────┘
                                 ▼
┌─────────────────────────  ФРОНТЕНД (apps/web)  ────────────────────────┐
│                                                                        │
│  axios ──▶ 401? ──▶ refresh-інтерсептор (single-flight, ротація)       │
│              │                                                         │
│              ▼ ні                                                      │
│  parseApiError() ──▶ isGlobalApiError()?                               │
│         │                    │                                         │
│         │           так: network / 5xx / 403                           │
│         │                    ▼                                         │
│         │            toast.danger (глобальні QueryCache/               │
│         │            MutationCache onError, дедуп 5 c)                 │
│         │                                                              │
│         └── ні (4xx у формі): applyServerError(error, form)            │
│                 ├─ fieldErrors[field] є у формі → setError(field)      │
│                 └─ решта → errors.root.server                          │
└────────────────────────────────────────────────────────────────────────┘
```

---

> **Доменний код** (CHAT-2b): виняток може назвати свій код явно (`new UnprocessableEntityException({ code: 'CHANNEL_WINDOW_CLOSED', message })`);
> `AllExceptionsFilter` приймає лише коди з закритої множини `ApiErrorCodeSchema`, будь-що інше ігнорується й код
> виводиться зі статусу. Новий код = зміна контракту: додається в `libs/contracts/src/error/error.schema.ts` і
> перегенеровуються обидва клієнти.

## 1. Контракт `ApiError` (`libs/contracts/src/error/`)

Фронт імпортує тип напряму з `@saas-skeleton/contracts` — без OpenAPI-шляху.
Схема — Zod, тому фронт не «вірить» відповіді, а валідує її (`safeParse` у `parseApiError`).

| Поле          | Тип                          | Опис                                                              |
| ------------- | ---------------------------- | ----------------------------------------------------------------- |
| `statusCode`  | `number`                     | HTTP-статус (дублюється в тілі — envelope самодостатній)          |
| `code`        | enum (закритий)              | Машинний код — фронт світчиться по ньому, **не** по `message`     |
| `message`     | `string`                     | Людське повідомлення; для 5xx завжди замасковане                  |
| `fieldErrors` | `{field, message, code?, params?}[]` (опц.) | Прив'язка до полів request-схеми; вкладеність через крапку |
| `requestId`   | `string` (опц.)              | id запиту з pino-http — кореляція відповіді з рядком у лозі       |

**I18N-2** (`libs/contracts/src/error/error.schema.ts`): `FieldError.code` — машинний код помилки
поля (Zod issue code: `too_small`, `invalid_format`… або бізнес-код `already_exists`), `params` —
значення для інтерполяції в переклад. Обидва опційні — `message` лишається fallback, коли фронт
не знає код (наприклад, ще не перекладений новий бізнес-код).

### Коди (`ApiErrorCodeSchema`)

| `code`                | HTTP | Коли виникає                                        | `fieldErrors`      |
| --------------------- | ---- | --------------------------------------------------- | ------------------ |
| `VALIDATION_ERROR`    | 400  | Zod-валідація body/query (nestjs-zod)               | так, з issue paths |
| `BAD_REQUEST`         | 400  | 400 без прив'язки до полів                          | —                  |
| `UNAUTHORIZED`        | 401  | Немає/протух access-токен, невірний логін           | —                  |
| `FORBIDDEN`           | 403  | Немає прав (RBAC — у беклозі)                       | —                  |
| `NOT_FOUND`           | 404  | Ресурс не знайдено (явно або Prisma P2025)          | —                  |
| `CONFLICT`            | 409  | Унікальність/конфлікт стану (P2002, явний конфлікт) | так, якщо відоме поле |
| `CHANNEL_WINDOW_CLOSED` | 422 | Вікно вільного тексту каналу закрите (CHAT-2b); фронт пояснює правило й пропонує нотатку | — |
| `INTERNAL_ERROR`      | 500  | Невідомий виняток; message завжди замаскований      | —                  |
| `SERVICE_UNAVAILABLE` | 503  | БД/залежність недоступна — клієнту можна ретраїти   | —                  |

---

## 2. Бекенд: `AllExceptionsFilter` (`apps/api/src/common/filters/all-exceptions.filter.ts`)

Один глобальний фільтр `@Catch()` без аргументів — ловить **усі** винятки.
Підключається в `configureApp()` (`app.setup.ts`) — той самий сетап у `main.ts` і в e2e-тестах,
тому тести перевіряють рівно те, що бачить прод.

### Таблиця нормалізації

| Джерело винятку                                        | HTTP | `code`                | Що у відповіді                                            |
| ------------------------------------------------------ | ---- | --------------------- | --------------------------------------------------------- |
| `ZodValidationException` (nestjs-zod pipe)             | 400  | `VALIDATION_ERROR`    | `fieldErrors` з `issue.path.join('.')` + `issue.message` + `issue.code` (Zod issue code — ключ `errors:fieldErrors.<code>` на фронті) |
| `HttpException` 4xx (сервіси, guards)                  | як у винятку | мапа статусів | `message` з винятку; `fieldErrors`, якщо передані в тілі  |
| `fieldConflictException(field, msg, code?)` (`common/errors.ts`) | 409 | `CONFLICT`   | `fieldErrors: [{field, message, code}]` — `code` за замовчуванням `already_exists` |
| Prisma `P2002` (unique constraint)                     | 409  | `CONFLICT`            | `fieldErrors` з полів констрейнта + `code: 'already_exists'` (див. підводний камінь) |
| Prisma `P2003` (FK constraint)                         | 409  | `CONFLICT`            | без поля                                                  |
| Prisma `P2025` (запис не знайдено)                     | 404  | `NOT_FOUND`           | `Resource not found`                                      |
| Prisma `P1000/P1001/P1002/P1008/P1010/P1017/P2024`     | 503  | `SERVICE_UNAVAILABLE` | «please retry» — маскування деталей                       |
| `ECONNREFUSED/ECONNRESET/ETIMEDOUT/ENOTFOUND/EAI_AGAIN`| 503  | `SERVICE_UNAVAILABLE` | те саме (див. підводний камінь про adapter-pg)            |
| Prisma інші `P*`, `HttpException` 5xx, невідомий виняток | 500 | `INTERNAL_ERROR`     | завжди `"Internal server error"` — без деталей            |

### Правила фільтра

- **Маскування 5xx**: жоден внутрішній message/stack не виходить назовні. Деталі — тільки в лог
  (`logger.error` з повним `err`), відповідь містить `requestId` для кореляції.
- **Логування**: 5xx → `error` (з винятком і stack), 4xx → `warn` (з `code` і `fieldErrors`).
- **`requestId`** — з pino-http (`req.id`), додається в кожен envelope.

### Підводні камені Prisma 7 + adapter-pg (перевірено на живо)

1. **P2002**: поля унікального констрейнта лежать у `meta.driverAdapterError.cause.constraint.fields`,
   а **не** в `meta.target` (класичний шлях). Фільтр підтримує обидва.
2. **БД недоступна**: летить `PrismaClientKnownRequestError` з кодом **`ECONNREFUSED`**
   (сирий код драйвера), а не `P1001`. Тому connection-рівневі Node-коди мапляться на 503 окремим набором.

### Як кидати помилки в новому модулі

```ts
// Конфлікт із прив'язкою до поля — фронт покаже помилку під полем форми;
// code за замовчуванням 'already_exists' (перекладається як errors:fieldErrors.already_exists):
throw fieldConflictException('email', 'Email already registered');

// Інший бізнес-код конфлікту — додати ключ у libs/i18n/src/locales/en/errors.json → fieldErrors:
throw fieldConflictException('slug', 'Slug is reserved', 'reserved_slug');

// Звичайні випадки — стандартні HttpException, фільтр сам загорне в envelope:
throw new NotFoundException(`Customer "${id}" not found`);
throw new UnauthorizedException('Invalid email or password');

// P2002/P2025 можна НЕ ловити: фільтр перетворить їх на 409/404 сам.
// Явна перевірка перед create дає краще повідомлення; констрейнт добиває гонку.
```

---

## 3. Фронтенд: три канали реакції

Розбір — `parseApiError(error)` (`apps/web/src/api/api-error.ts`): axios-помилка →
`safeParse` тіла по `ApiErrorSchema`; не envelope (HTML від проксі, обрив мережі) →
синтезований fallback (`status: null` для network).

### Хто що перехоплює

| Ситуація                          | `status`/`code`             | Канал                        | Що бачить користувач                              |
| --------------------------------- | --------------------------- | ---------------------------- | ------------------------------------------------- |
| Обрив мережі / сервер не відповідає | `status: null`            | глобальний toast             | «Connection problem» + порада перевірити зв'язок  |
| Падіння сервера                   | 500 `INTERNAL_ERROR`        | глобальний toast             | «Server error»                                    |
| БД/залежність лежить              | 503 `SERVICE_UNAVAILABLE`   | глобальний toast             | «Service unavailable» + можна повторити           |
| Немає прав                        | 403 `FORBIDDEN`             | глобальний toast             | «Access denied»                                   |
| Протух access-токен               | 401                         | axios-інтерсептор            | нічого: single-flight refresh + повтор запиту; якщо refresh провалився — logout + `/login` |
| Невірний логін (401 на auth-роуті) | 401 `UNAUTHORIZED`         | форма: `errors.root.server`  | message бекенда під формою                        |
| Валідація полів                   | 400 `VALIDATION_ERROR`      | форма: `setError(field)`     | помилка під конкретним полем                      |
| Конфлікт унікальності             | 409 `CONFLICT` + fieldErrors| форма: `setError(field)`     | помилка під конкретним полем                      |
| Інший 4xx без полів               | 4xx                         | форма: `errors.root.server`  | message бекенда під формою                        |

### Глобальний toast (`main.tsx` + `lib/error-toast.ts`)

- `QueryCache.onError` + `MutationCache.onError` → `parseApiError` → `isGlobalApiError`
  (network / 403 / ≥500) → `toast.add({ type: 'error' })`.
- **Дедуп 5 с** по ключу `status:code:message` — сторінки з автооновленням (jobs, 5 с)
  не спамлять однаковими тостами.
- **Розміщення** (`components/toast-host.tsx`, живе в root-роуті): адмінка — знизу
  праворуч, гостьовий `/login` — знизу по центру. Регіон живих сповіщень — окремий, зверху
  праворуч (`docs/frontend/ui-stack.md` § «Регіони тостів»).
- **I18N-2, переклад**: заголовок — `errors:toast.connectionTitle` / `accessDeniedTitle` /
  `serviceUnavailableTitle` / `serverErrorTitle` (`toastTitle()`, гілки за `status`/`code`
  один в один з таблицею вище). Опис — `errors:codes.<code>` (`toastDescription()`); коли
  `code` немає (network, невалідний envelope) — `parsed.message` вже перекладений на
  джерелі, в `parseApiError()` (`errors:network`/`errors:generic`), бо ці рядки повністю
  фронтові, бекенд їх не надсилає.

### Форми: `applyServerError(error, form)` (`components/form/server-error.ts`)

1. Глобальні помилки (network/5xx/403) — **ігнорує**: їх уже показав toast, форму не чіпає.
2. Кожен `fieldErrors[i].field` звіряється з полями форми (`Object.keys(form.getValues())`) →
   збіг: `setError(field, { type: 'server' })` (+focus на перше поле).
3. Невідомі поля та помилки без `fieldErrors` → `errors.root.server` з message бекенда.
4. **I18N-2, переклад** (`translateFieldError()`): `fieldError.code` є → ключ
   `errors:fieldErrors.<code>` з `{ defaultValue: fieldError.message, ...fieldError.params }` —
   немає перекладу для коду (відкрита множина, на відміну від `ApiErrorCode`) → фронт тихо
   падає на англійський `message`, а не показує сирий ключ. `errors.root.server` (крок 3) і
   orphan-поля лишаються англійським `message` бекенда — не мапляться на форму, перекладати
   немає куди.

**Вимога**: форма мусить задавати **повні `defaultValues`** — по них визначаються відомі поля.

```tsx
const form = useForm<CreateUser>({ resolver: zodResolver(CreateUserSchema),
  defaultValues: { email: '', name: '', role: 'USER', password: '' } });
// ...
try { await mutation.mutateAsync({ data }); }
catch (error) { applyServerError(error, form); }
// у розмітці: {errors.root?.server && <p className="text-danger">{errors.root.server.message}</p>}
```

---

## 4. Тести (e2e, `apps/api/test/`)

| Сценарій                                   | Перевіряється                                              |
| ------------------------------------------ | ---------------------------------------------------------- |
| Невалідний payload create/query            | 400, `code: VALIDATION_ERROR`, `fieldErrors` з іменами полів |
| Дубль email (users create, явна перевірка) | 409, `CONFLICT`, `fieldErrors: [{field: 'email', message: 'Email already registered', code: 'already_exists'}]` |
| Неіснуючий id (get/patch/delete)           | 404, `Resource not found`                                  |
| Без токена / протухлий токен               | 401                                                        |

Перевірено вручну на живо (2026-07-12): обрив БД → 503 envelope; вимкнений API → toast;
дубль email у формах реєстрації та створення юзера → помилка під полем Email.
**I18N-2** (2026-07-12): дубль email у create-user-modal → мережа підтверджує
`fieldErrors: [{field: 'email', message: 'Email already registered', code: 'already_exists'}]`,
поле форми показує перекладене **«Already exists»** (не сирий `message`) — ключ
`errors:fieldErrors.already_exists` спрацював.
