# Файлова підсистема (Files v1)

Зберігання файлів (зображення, PDF, офісні документи) для CRM/ERP-доменів: байти живуть
в S3-сумісному сховищі, метадані — у Postgres, доступ до байтів — тільки через
короткоживучі presigned URL після авторизації в API. Байти **ніколи не проходять через
NestJS** — браузер вантажить і читає їх напряму зі сховища, API лишається чисто JSON-ним
(конвеєр контрактів Zod → OpenAPI → orval працює без винятків під multipart).

Фаза завершена і перевірена живим прогоном 2026-07-14. Зафіксовані рішення — у
`CLAUDE.md` (розділ «Зафіксовані рішення») і памʼятці нижче.

## Зафіксовані рішення

| Питання            | Рішення                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Абстракція сховища | **S3 API і є абстракція** (без власного `StorageDriver`-інтерфейсу — аналогічно рішенню з pg-boss). Код один, сховище міняється env-ами |
| Dev-сховище        | **SeaweedFS** з docker-compose (Apache 2.0, зрілий). Garage відхилено (AGPL), RustFS — alpha, **MinIO не використовувати** (репо заархівовано 04/2026) |
| Прод               | Те саме self-hosted (`docker-compose.prod.yml`, дані в замаплених директоріях) або будь-який managed S3 (R2/B2/Hetzner/AWS) — тільки env |
| Флоу завантаження  | **Двофазний presigned upload** (proxy через API відхилено)                                                                               |
| Віддача            | Тільки короткоживучі **presigned GET** після authz; публічних бакетів немає                                                              |
| Антивірус          | ClamAV — беклог (для внутрішніх CRM не критично у v1)                                                                                    |

## Компоненти

```
┌──────────────────────────  БРАУЗЕР (apps/web)  ───────────────────────────┐
│  useFileUpload (create → PUT з progress → complete)                       │
│  FileDropzone (свій компонент; клієнтський фільтр MIME/розміру)           │
│  ChangeAvatarModal (демо-споживач на /users)                              │
└──────┬──────────────────────────────────────────────┬─────────────────────┘
       │ JSON (axios з auth-інтерсепторами)           │ байти (сирий axios,
       ▼                                              ▼  без Bearer — auth
┌────────────────────  API (apps/api)  ────────┐   ┌──────────────────────┐
│  FilesModule:                                │   │  S3-сховище          │
│   POST /api/files            → presigned PUT │   │  dev: SeaweedFS :8333│
│   POST /api/files/:id/complete (перевірки)   │──▶│  prod: той самий     │
│   GET  /api/files/:id                        │   │  контейнер за proxy  │
│   GET  /api/files/:id/download-url           │   │  або managed S3      │
│  UsersModule: PATCH avatarFileId,            │   └──────────▲───────────┘
│   UserResponse.avatarUrl (presigned GET)     │              │
└──────────────┬───────────────────────────────┘              │
               │ pg-boss                                      │
               ▼                                              │
┌──────────────────────  WORKER (apps/worker)  ────────────────┴───────────┐
│  files.generate-thumbnail  — sharp: 256px webp поруч з оригіналом        │
│  files.cleanup-orphans     — cron 03:30: PENDING старші 24h → delete     │
└───────────────────────────────────────────────────────────────────────────┘
```

Код по шарах:

- `libs/shared/src/storage/` — `StorageService` (обгортка `@aws-sdk/client-s3`: presign
  PUT/GET, `headObject`, `readObjectHead` (Range-запит під magic bytes), `putObject`,
  `deleteObject`; на старті `ensureBucket` + `PutBucketCors` — у проді м'яко скіпається,
  якщо прав немає) + глобальний `StorageModule`.
- `libs/contracts/src/file/` — Zod-схеми: allowlist MIME (`ALLOWED_FILE_MIME_TYPES`),
  ліміт `FILE_MAX_SIZE_BYTES` (25 MB), схеми запитів/відповідей.
- `apps/api/src/files/` — DTO → `FilesService` → `files.mapper` → `FilesController`.
- `libs/shared/src/messaging/definitions/files.messages.ts` — визначення обох команд
  (після EDA-1; до неї — `jobs/definitions/files.jobs.ts`).
- `apps/worker/src/subscribers/generate-thumbnail.subscriber.ts`, `cleanup-orphan-files.subscriber.ts`.
- `apps/web/src/components/file-upload/` — хук і dropzone; `change-avatar-modal.tsx` — демо.

## Модель даних

```prisma
model File {
  id           String     @id @default(uuid())
  key          String     @unique            // ключ у бакеті — назовні НЕ віддається
  filename     String                        // оригінальна назва (для Content-Disposition)
  mimeType     String
  size         Int
  status       FileStatus @default(PENDING)  // PENDING → READY
  thumbnailKey String?                       // мініатюра (тільки зображення)
  uploadedById String?                       // хто ініціював (SetNull при видаленні юзера)
  createdAt / updatedAt
}

model Attachment {                            // полиморфна прив'язка до доменних сутностей
  fileId / entityType / entityId              // (customers, tickets, …) — таблиця готова,
  @@unique([fileId, entityType, entityId])    // API з'явиться з першим доменним модулем
}

model User {
  avatarFileId String?                        // демо-споживач v1
}
```

Ключ у бакеті: `{yyyy}/{mm}/{uuid}{.ext}` — **не** оригінальна назва (безпека, колізії,
юнікод); плаский префікс дат для оглядності, попереду зарезервоване місце під `tenantId`
при міграції на мультитенантність. Мініатюра лежить поруч: `{key}.thumb.webp`.

Стани:

```
POST /files                    PUT байтів              POST /files/:id/complete
────────────▶ PENDING ────────────────────────────────▶ перевірки ──▶ READY
                 │                                          │
                 │ юзер закрив вкладку / PUT не відбувся    │ HeadObject немає / розмір
                 ▼                                          ▼ не збігся / magic bytes ≠ MIME
   cron files.cleanup-orphans (24h):                 400 (при magic-mismatch об'єкт
   delete S3-об'єкт → delete рядок                    і рядок видаляються одразу)
```

## Гарантії і безпека

- **Content-Type клієнта — недовірений.** На `complete` бекенд читає перші 4100 байтів
  (Range-запит) і звіряє magic bytes (`file-type`) із заявленим MIME. Для форматів без
  сигнатури (`text/plain`, `text/csv`) вимога зворотна: детект має бути **відсутній**
  (інакше під `.txt` ховається бінарник). docx/xlsx приймаються і як власний MIME, і як
  `application/zip` (це zip-контейнери); legacy `.doc`/`.xls` — `application/x-cfb`.
- **Заявлений MIME підписується** в presigned PUT (`ContentType` у підписі) — клієнт
  зобов'язаний слати саме його; **розмір** звіряється на `complete` через `HeadObject`.
- Presigned TTL: **PUT — 10 хв**, **GET — 5 хв** (`libs/shared/src/storage/storage.service.ts`).
- `complete` **ідемпотентний**: повторний виклик для READY — no-op з тим самим 200.
- Download віддається **тільки для READY**; для PENDING — 404 (об'єкт не підтверджений).
- Side effects через чергу некритичні: падіння диспатчу thumbnail-джоби не ламає `complete`.

## Приклад end-to-end: аватар користувача

Демо-споживач — сторінка `/users`: row action «Change avatar» → `ChangeAvatarModal` →
`useFileUpload`. Нижче — той самий флоу в сирих HTTP-запитах (реальні відповіді з живого
прогону). Всі запити до API — з `Authorization: Bearer <accessToken>`.

### Крок 1. Ініціація: `POST /api/files`

Фронт відправляє **тільки метадані** (байти ще нікуди не йдуть):

```http
POST /api/files
Content-Type: application/json
Authorization: Bearer eyJ…

{ "filename": "avatar.png", "mimeType": "image/png", "size": 379 }
```

Zod-валідація: `mimeType` — закритий enum allowlist, `size` ≤ 25 MB (порушення → 400
`VALIDATION_ERROR` з `fieldErrors`, лягає прямо в поле форми через `applyServerError`).

Відповідь `201` — PENDING-запис + одноразовий підписаний URL:

```json
{
  "file": {
    "id": "f4b2a25d-c590-41db-840a-65ca2087cfad",
    "filename": "avatar.png",
    "mimeType": "image/png",
    "size": 379,
    "status": "PENDING",
    "hasThumbnail": false,
    "uploadedById": "9e84c717-8827-466f-a3bb-4607680fb9f7",
    "createdAt": "2026-07-14T13:31:02.126Z",
    "updatedAt": "2026-07-14T13:31:02.126Z"
  },
  "uploadUrl": "http://localhost:8333/saas-files/2026/07/01fdf124-….png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=saas%2F…&X-Amz-Date=20260714T132716Z&X-Amz-Expires=600&X-Amz-Signature=…&X-Amz-SignedHeaders=host"
}
```

Зверни увагу: `key` у відповіді **відсутній** — внутрішня деталь сховища; `uploadUrl`
живе 10 хвилин і дозволяє рівно одну операцію — PUT цього ключа з цим Content-Type.

### Крок 2. Байти напряму в сховище: `PUT uploadUrl`

```http
PUT http://localhost:8333/saas-files/2026/07/01fdf124-….png?X-Amz-…
Content-Type: image/png            ← мусить збігатися з заявленим (він у підписі)

<binary body>
```

- **Без** `Authorization` — авторизація зашита в підпис URL. У `useFileUpload` це сирий
  axios без інтерсепторів (Bearer-токен не має витікати на чужий origin).
- Прогрес — стандартний `onUploadProgress` axios (модалка показує `ProgressBar`).
- Браузер спершу шле CORS preflight `OPTIONS` — origin фронта дозволений через
  bucket-CORS, який API виставив на старті (`S3_CORS_ALLOWED_ORIGINS`).

Відповідь сховища: `200` з порожнім тілом.

### Крок 3. Підтвердження: `POST /api/files/:id/complete`

```http
POST /api/files/f4b2a25d-c590-41db-840a-65ca2087cfad/complete
Authorization: Bearer eyJ…
```

Бекенд: `HeadObject` (об'єкт існує?) → розмір збігається із заявленим? → magic bytes
відповідають MIME? → `status: READY` → для зображень диспатчиться
`files.generate-thumbnail` (singletonKey = fileId).

Відповідь `200`:

```json
{
  "id": "f4b2a25d-c590-41db-840a-65ca2087cfad",
  "filename": "avatar.png",
  "mimeType": "image/png",
  "size": 379,
  "status": "READY",
  "hasThumbnail": false,
  "uploadedById": "9e84c717-8827-466f-a3bb-4607680fb9f7",
  "createdAt": "2026-07-14T13:31:02.126Z",
  "updatedAt": "2026-07-14T13:31:02.268Z"
}
```

`hasThumbnail` стане `true` за секунди — worker обробить джобу асинхронно
(перевірити можна повторним `GET /api/files/:id`).

Можливі відмови (усі — стандартний `ApiError` envelope):

| Сценарій                                 | Відповідь                                                        |
| ---------------------------------------- | ---------------------------------------------------------------- |
| PUT так і не відбувся                    | `400 BAD_REQUEST` «Uploaded object not found in storage»          |
| Розмір ≠ заявленому                      | `400 BAD_REQUEST` «Uploaded size does not match declared size»    |
| Вміст ≠ MIME (текст під виглядом png)    | `400 BAD_REQUEST` «File content does not match declared type» — **об'єкт і рядок видалено одразу** |
| Неіснуючий id                            | `404 NOT_FOUND`                                                  |

### Крок 4. Прив'язка до домену: `PATCH /api/users/:id`

Файл сам по собі «нічий» — доменний модуль вирішує, як його використати. Для аватара:

```http
PATCH /api/users/9e84c717-8827-466f-a3bb-4607680fb9f7
Content-Type: application/json
Authorization: Bearer eyJ…

{ "avatarFileId": "f4b2a25d-c590-41db-840a-65ca2087cfad" }
```

`UsersService` валідує: файл існує, `READY`, MIME — зображення. Інакше —
`400` з `fieldErrors: [{ "field": "avatarFileId", … }]` (лягає в форму).

Відповідь `200` — і тут з'являється **читання**:

```json
{
  "id": "9e84c717-8827-466f-a3bb-4607680fb9f7",
  "email": "admin@example.com",
  "name": "Admin",
  "role": "ADMIN",
  "isActive": true,
  "locale": "en",
  "avatarFileId": "f4b2a25d-c590-41db-840a-65ca2087cfad",
  "avatarUrl": "http://localhost:8333/saas-files/2026/07/01fdf124-….png.thumb.webp?X-Amz-…&X-Amz-Expires=300&…",
  "createdAt": "2026-07-11T…",
  "updatedAt": "2026-07-14T…"
}
```

`avatarUrl` — presigned GET **мініатюри** (fallback на оригінал, поки thumbnail не
згенерований), TTL 5 хв. Він приходить у JSON, тому що `<img src>` не вміє слати
`Authorization`-заголовок — авторизацію несе сам підпис URL. Грід на `/users` просто
рендерить `<Avatar.Image src={u.avatarUrl}>`; кожен refetch списку видає свіжі підписи.
Auth-роути (`/auth/me`, login) аватар **не пресайнять** (`avatarUrl: null`) — демо-споживач
тільки users.

### Крок 5. Читання оригіналу (скачування): `GET /api/files/:id/download-url`

Для документів (PDF, docx) фронт запитує одноразовий лінк:

```http
GET /api/files/f4b2a25d-c590-41db-840a-65ca2087cfad/download-url
GET /api/files/…/download-url?variant=thumbnail        ← мініатюра (для зображень)
```

Відповідь `200`:

```json
{
  "url": "http://localhost:8333/saas-files/2026/07/01fdf124-….png?X-Amz-…&X-Amz-Expires=300&response-content-disposition=attachment%3B%20filename%2A%3DUTF-8%27%27avatar.png&…",
  "expiresInSeconds": 300
}
```

- `variant=original` (дефолт) підмішує `Content-Disposition: attachment; filename*=…` —
  браузер скачує файл під **оригінальною назвою**, а не UUID-ключем.
- `variant=thumbnail` — без attachment (для `<img>`); якщо мініатюри немає — оригінал.
- Саме тут у майбутньому вбудовується RBAC/tenant-перевірка: API вирішує, кому дати
  підпис, сховище лише виконує його.

### Той самий флоу у фронтовому коді

```tsx
const { state, upload } = useFileUpload();          // кроки 1–3 всередині
const ready = await upload(file);                    // File з input/dropzone
if (ready) {
  await updateUser.mutateAsync({ id, data: { avatarFileId: ready.id } });  // крок 4
}
// state: uploading{progress} → processing → done | error{message}
```

## Конфігурація (env)

| Змінна                    | Dev (дефолти StorageService)   | Prod                                             |
| ------------------------- | ------------------------------ | ------------------------------------------------ |
| `S3_ENDPOINT`             | `http://localhost:8333`        | `https://files.example.com` (reverse proxy; браузер ходить сюди напряму — localhost не працюватиме) |
| `S3_ACCESS_KEY/SECRET_KEY`| `saas` / `saas-secret`         | з `docker/seaweedfs/s3.prod.json` (gitignored)   |
| `S3_BUCKET`               | `saas-files`                   | так само; у проді створити заздалегідь            |
| `S3_FORCE_PATH_STYLE`     | `true`                         | `true` для self-hosted; `false` для AWS за бажанням |
| `S3_CORS_ALLOWED_ORIGINS` | `http://localhost:5173`        | `https://app.example.com`                        |

Self-hosted прод: `docker/docker-compose.prod.yml` — дані в `${SAAS_DATA_DIR}/{postgres,seaweedfs}`
(бекапити узгоджено: сховище відновлювати станом не старішим за БД), порти тільки на
127.0.0.1, назовні — reverse proxy з TLS (Host-заголовок зберігати — він у SigV4-підписі;
ліміт тіла ≥ 25 MB). Managed S3 — ті самі змінні, інші значення.

## Підводні камені (перевірені на живо)

1. `@aws-sdk/client-s3` без `requestChecksumCalculation: 'WHEN_REQUIRED'` вшиває в
   presigned PUT CRC32-чексуму порожнього payload — сховище відхиляє реальний upload
   400-кою. Вже виставлено в `StorageService`, не прибирати.
2. `file-type` — ESM-only: ручна декларація типів (`apps/api/src/types/file-type.d.ts`),
   `"ts-node": {"files": true}` для openapi:generate, мок у Jest e2e.
3. У e2e `StorageService` підміняється in-memory фейком (`overrideProvider`) — живе
   сховище тестам не потрібне; сам presigned-протокол перевіряється живим прогоном.

## Обмеження v1 / беклог

- Немає `DELETE /files` і звільнення старого аватара при заміні (READY-сирота лишається);
  життєвий цикл видалення з'явиться разом із доменними модулями та `attachments`-API.
- `Attachment` — тільки таблиця, ендпоінтів поки немає (перший споживач — customers).
- Thumbnail — at-least-once (ретраї pg-boss), природно ідемпотентний перезаписом ключа.
- ClamAV-сканування, роздільні internal/public endpoint для presign — за потребою.
