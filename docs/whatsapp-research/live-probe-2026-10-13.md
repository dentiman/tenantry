# Жива проба Cloud API — що перевірено і які особливості (2026-10-13)

> Знімок фактів, **підтверджених викликами на живому тестовому акаунті**, на відміну від решти `whatsapp-research/`
> (документація Meta, legacy-api, OSS). Інструмент: `pnpm whatsapp:probe` (`scripts/whatsapp-probe.ts`; секрети — з
> кореневого `.env`, `WHATSAPP_*`). Graph **v23.0**. Тестовий WABA «Test WhatsApp Business Account», app
> `kolvix masseging`, один тестовий номер. Рішення з цих фактів — у [whatsapp-channel.md](../whatsapp-channel.md) §8.1.

## 1. Що працює (підтверджено)

| API | Результат | Що з цього для адаптера |
| --- | --- | --- |
| `GET /debug_token` (bearer `APP_ID\|APP_SECRET`, `input_token`) | `type: SYSTEM_USER`, `is_valid`, `expires_at: 0`, `data_access_expires_at: 0`, `scopes[]`, `granular_scopes[]`, `app_id` | варіант A (системний користувач) працює для тестового WABA; безстроковий токен; перевіряємо `app_id`, обидва `whatsapp_*` scopes |
| `GET /{waba}?fields=id,name,currency,timezone_id,message_template_namespace,account_review_status,business_verification_status,health_status` | усі поля прийняті | відображення акаунта у налаштуваннях; `health_status` — готова ознака стану |
| `GET /{waba}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,name_status,status,account_mode,code_verification_status,platform_type,throughput` | усі поля прийняті; є `account_mode: LIVE`, `throughput.level: STANDARD` | синхронізація номерів (F2) |
| `GET /{waba}/subscribed_apps` | `data[].{whatsapp_business_api_data{id,name,link}, override_callback_uri?}` | поле `override_callback_uri` читається; видно **всі** застосунки, підписані на WABA |
| `GET /{waba}/message_templates?limit=100&fields=id,name,language,status,category,components` | усі поля прийняті, 25 шаблонів | синхронізація шаблонів (F8) |
| `POST /{phone}/messages` `type: template` (`hello_world`/`en_US`) | 200 + `contacts[]` + `messages[0].id` + **`message_status: "accepted"`** | відповідь «прийнято», не «доставлено» |
| `POST /{phone}/messages` `type: text` у відкритому вікні | 200 + `contacts[]` + `messages[0].id`; **без** `message_status` | успіх = 2xx + `messages[0].id` |

## 2. Особливості, які треба врахувати

1. **Відповідь на відправку не доводить доставку.** Статус `sent/delivered/read/failed` приходить лише вебхуком;
   `accepted` не гарантія. Помилки доставки (оплата, вікно, політика) можуть з'явитись пізніше як `failed`.
2. **Форма відповіді різниться за типом**: у шаблону є `message_status`, у тексту немає. Парсер не вимагає його.
3. **`health_status` має ієрархію** `WABA → BUSINESS → APP`, по `can_send_message: AVAILABLE|BLOCKED|LIMITED`, з
   `errors[].{error_code, error_description, possible_solution}`. На тестовому WABA: WABA `BLOCKED` (код 141006,
   «помилка способу оплати блокує розмови, ініційовані бізнесом»), BUSINESS і APP `AVAILABLE`.
4. **`BLOCKED` не зупинив відправку**: і шаблон, і текст прийняті. Не вважати `BLOCKED` жорстким «не слати» — показувати
   попередження й чекати результату `failed` у вебхуку.
5. **Спільний WABA / застосунок.** `subscribed_apps` містить кілька застосунків; один із них має
   `override_callback_uri` (інший проєкт). Callback на рівні WABA — **один на застосунок**: запис перезапише чужий.
   Перед `POST subscribed_apps` завжди `GET` і зберегти попереднє значення. Це також продуктовий ризик:
   тенант, чий WABA уже підключений до іншого застосунку, не повинен втрачати його вебхуки мовчки (UI-попередження).
6. **Вікно 24 год відкривається вхідним повідомленням** — підтверджено: після відповіді користувача на тестовий номер
   звичайний `text` пішов без шаблону.
7. **`code_verification_status: NOT_VERIFIED`** на тестовому номері — це нормально для публічного тестового номера;
   не вважати помилкою синхронізації.
8. **Токен у заголовку** `Authorization: Bearer …`, не в query — щоб не потрапляв у логи/проксі.
9. **`wamid` містить закодований номер отримувача** (base64 у середині) — не логувати й не показувати як «безпечний
   id» поза межами тенанта; зберігати як `external_id`, але не виносити в метрики.
10. **Невідомі поля не ламають запит лише коли їх нема в запиті**: якщо на іншому WABA поле не підтримане, Graph
    повертає помилку на весь запит — адаптер пробує набір полів від повного до мінімального (так робить проба).

## 3. Не перевірено (лишається у whatsapp-channel.md §8)

- Вебхук: підпис `X-Hub-Signature-256`, форма `statuses[]`, `biz_opaque_callback_data` у вебхуку, вхідні повідомлення.
- `POST /{waba}/subscribed_apps` з `override_callback_uri` (на спільному WABA не виконувався — зніме чужий вебхук).
- Медіа (завантаження/відправка), шаблони з параметрами, реакції, mark-as-read/typing.
- `GET /{phone-id}?fields=health_status` на рівні номера; поведінка `failed` після `BLOCKED`.
- Коди помилок реальних відмов (131047 вікно, 131030 список отримувачів, 131026 тощо) — у пробі не відтворювались.
