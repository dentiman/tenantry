# Мультиязичність (i18n) — зафіксовані рішення та план впровадження

> Зафіксовано: 2026-07-12. Стартова мова — тільки `en`; будуємо інфраструктуру,
> друга мова і TMS свідомо відкладені (фаза I18N-4).
> Пов'язані доки: [error-handling.md](error-handling.md) (контракт ApiError),
> [roadmap.md](roadmap.md) (місце в загальному плані).

## Зафіксовані рішення (НЕ переглядати без запиту користувача)

| Питання                    | Рішення                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Принцип backend ↔ frontend | **Бекенд — машинні коди, текст рендерить споживач** (web/portal/worker). API не читає `Accept-Language`; `ApiError.message` — англійська діагностика для логів, юзеру не показується |
| Бібліотека                 | **i18next**: react-i18next на всіх фронтах, той самий i18next у Node-режимі в worker (email). Lingui/Paraglide розглянуті й відхилені (консервативний вибір для форк-скелетона) |
| Формат повідомлень         | i18next JSON v4 (вбудовані плюрали/інтерполяція, без окремого ICU-плагіна)                                                                                                   |
| Зберігання перекладів      | **JSON у монорепо**: спільне — `libs/i18n`, фічеве — `apps/<app>/src/locales`. TMS (кандидат — Tolgee self-hosted) — тільки з появою другої мови                             |
| Типізація ключів           | TS-augmentation `declare module 'i18next'` з згенерованих типів ресурсів — compile-time перевірка ключів                                                                     |
| fieldErrors                | `FieldErrorSchema` розширюється опційними `code` (машинний код помилки поля) + `params`; `message` лишається англійським fallback                                            |
| Zod-повідомлення           | Кастомні `message` у схемах contracts — це **ключі перекладу**, не текст. Стандартні issue — locale-паки Zod 4 (`z.config(z.locales.xx())`) на фронті                        |
| Дати/числа/валюти          | Нативний `Intl.DateTimeFormat` / `NumberFormat` з поточною локаллю; жодних locale-пакетів date-бібліотек                                                                     |
| Визначення локалі (web)    | localStorage `saas_locale` → після логіну `user.locale` з профілю → `navigator.language` → `'en'` (патерн як у next-themes із темою)                                         |
| Локаль у БД                | Поле `users.locale` (default `'en'`) — джерело правди для server-rendered текстів (email) і синхронізації між пристроями                                                     |
| Що НЕ перекладаємо         | Логи, Swagger/OpenAPI, `ApiError.message`, машинні значення в БД (enum-и, стани job-ів — фронт перекладає лейбли по значенню)                                                |

## Архітектура словників

```
libs/i18n/
  src/locales/en/
    common.json       # спільні дії/лейбли для всіх фронтів (Save, Cancel, page N of M…)
    errors.json       # ApiErrorCode → текст + коди fieldErrors (1:1 з libs/contracts)
    validation.json   # ключі кастомних Zod-повідомлень із contracts
  src/index.ts        # список локалей, типи ресурсів, ресурси для i18next
apps/web/src/locales/en/
    auth.json, users.json, jobs.json, dashboard.json   # namespace = фіча
```

- `libs/i18n` наразі споживає лише web. **I18N-3, ревізія**: `apps/worker` НЕ підключений
  до `libs/i18n` — email-контент (`notifications.json`) живе локально в `apps/worker/src/locales/en/`,
  бо спільного з web контенту поки немає (навіть назва бренду — `apps/web/src/locales/en/layout.json`,
  не в лібі). Форсувати залежність worker → `libs/i18n` заради самого факту «той самий i18next»
  було б передчасною абстракцією; тримаємо worker на плейн `i18next` з власними ресурсами.
  Якщо колись з'явиться реально спільний контент (бренд, спільні лейбли) — тоді й переносити
  в `libs/i18n`, за трьома місцями з правила №1 CLAUDE.md (`tsconfig.base.json` вже готовий
  з I18N-1; додати `apps/worker/tsconfig.json` paths + `apps/worker/webpack.config.js` alias).
- Ключі `errors.json`/`validation.json` тримаються синхронними з contracts вручну;
  дисципліна: новий код помилки → у тому ж PR ключ у `errors.json`.

## Фази впровадження

Місце в roadmap: виконувати **до фази 4 (доменні модулі)** — customers/tickets мають
писатися одразу з ключами. Можна паралельно з фазою 3. Усього 3 робочі фази + 1 відкладена.

### I18N-1 — інфраструктура фронта (web)

1. `libs/i18n`: структура вище, `en`-ресурси, типи ключів, експорт для i18next.
2. `apps/web`: i18next + react-i18next init (suspense off, fallback `en`),
   детекція localStorage `saas_locale` → `navigator.language` → `'en'`;
   TS-augmentation для типізованих ключів.
3. Виніс УСІХ наявних рядків адмінки в ключі: auth (login/register), users
   (таблиця, форми, діалоги), jobs (фільтри, стани — лейбли по значенню enum),
   dashboard, layout/навігація, common.
4. Хелпери `formatDate`/`formatNumber` на `Intl.*` з поточною локаллю
   (`apps/web/src/lib/`), замінити прямі виклики.
5. Правило з цього моменту: **жодних хардкод-рядків у JSX** (у т.ч. в нових фічах).

DoD: адмінка працює як раніше, `grep` по JSX не знаходить літералів UI-текстів,
lint/typecheck/build чисті.

### I18N-2 — помилки та валідація (contracts + api + web)

1. `libs/contracts`: `FieldErrorSchema` + опційні `code`, `params`
   → `openapi:generate` → `web:codegen`.
2. `apps/api` `AllExceptionsFilter`: у fieldErrors класти `code`
   (Zod issue code для VALIDATION_ERROR; `already_exists` для P2002);
   `fieldConflictException()` приймає code. `message` не змінюється (fallback).
3. Кастомні Zod-повідомлення у contracts переписати на ключі `validation.*`.
4. `apps/web`: локалізація Zod (`z.config(z.locales.en())` у bootstrap);
   toast-канал (`main.tsx`) і `applyServerError` маплять `ApiError.code` /
   `fieldErrors[].code` → ключі `errors.json`; `message` — fallback, якщо ключа немає.
5. Оновити [error-handling.md](error-handling.md): колонка «ключ перекладу»
   в таблицях нормалізації/каналів.

DoD: e2e зелені (перевіряють code, не message), живий флоу: 409 conflict у формі
create user показує перекладений текст поля.

### I18N-3 — server-rendered тексти + локаль юзера (database + worker) — ✅ завершено 2026-07-12

1. `libs/database`: міграція `users.locale TEXT NOT NULL DEFAULT 'en'`. `libs/contracts`:
   `UserLocaleSchema = z.enum(['en'])` (окрема від `SUPPORTED_LOCALES` — contracts не залежить
   від `libs/i18n`); `UserSchema.locale` (response), `CreateUserSchema.locale` (опційний,
   дефолт `'en'`) → `UpdateUserSchema` успадковує через існуючий `.omit({password}).partial()`.
   `users.mapper.ts` віддає поле. `openapi:generate` + `web:codegen` (locale проходить через
   Swagger — на відміну від error-схем із I18N-2).
2. `apps/worker`: плейн `i18next` (без react-i18next, без `libs/i18n` — див. ревізію архітектури
   словників вище) з локальним `src/locales/en/notifications.json`. `MailerService` (nodemailer)
   + сервіс Mailpit у `docker-compose.yml`. `WelcomeEmailHandler` читає `locale`+`name` СВІЖИМИ
   з БД по `payload.userId` (не з job payload — стан міг змінитися між диспатчем і обробкою),
   рендерить через `i18n.t(key, { lng: locale, ...params })`, шле реальний лист.
3. **Свідомо не зроблено** (кожен пункт — уникнення мертвого коду, не забута робота):
   - `apps/web` пріоритетність `profile.locale` над `localStorage` — з `SUPPORTED_LOCALES = ['en']`
     ця гілка ніколи не виконується інакше; писати її є сенс разом з мовним перемикачем в I18N-4.
   - `RegisterSchema.locale` — немає відправника (форма реєстрації нічого не шле), додати
     разом з UI-вибором мови в I18N-4.
   - HTML-екранування в `apps/worker/src/i18n`: НЕ вимикали `escapeValue` (на відміну від web,
     де React екранує сам) — тут `{{name}}` іде прямо в HTML листа, i18next має лишатися
     єдиним рубежем екранування.

DoD (перевірено живим флоу): реєстрація через API → `users.user-registered` →
`notifications.welcome-email` → лист у Mailpit, subject/body з ключів (не хардкод),
`{{name}}`-інтерполяція коректна, HTML не задвоєно екранований.

### I18N-4 — друга мова + TMS (ВІДКЛАДЕНО до реальної потреби)

- Друга локаль (`uk`?) + language switcher в UI (патерн theme-switcher).
- TMS: Tolgee self-hosted (кандидат), CI-sync JSON ↔ платформа.
- Zod locale-пак другої мови, `Intl` перевірка форматів.
- QA: pseudo-locale (подовжені рядки) для перевірки верстки.

## Ризики / підводні камені

- **Дублікат enum locale**: `UserLocaleSchema` (contracts) і `SUPPORTED_LOCALES` (libs/i18n) —
  два окремі списки з тієї самої причини, що й error-коди (contracts не залежить від i18n).
  I18N-4 з новою мовою мусить оновити ОБИДВА, інакше можна отримати валідну по contracts
  локаль, для якої немає перекладів на фронті (fallback на `'en'` в i18next це пом'якшує,
  але неузгодженість краще ловити свідомо).
- **Zod locale-паки** діють глобально (`z.config`) — конфігурувати тільки на фронті
  в bootstrap; бекенд лишається на en (його повідомлення — fallback/логи).
- Ключі, що «розсинхронилися» з contracts, ловляться типами лише в `errors.json`
  (enum закритий); для `validation.*` — дисципліна PR.
- orval перегенерує типи після зміни `FieldErrorSchema` — фронт імпортує ApiError
  напряму з contracts (не з generated), звірити, що ніде не розійшлося.
