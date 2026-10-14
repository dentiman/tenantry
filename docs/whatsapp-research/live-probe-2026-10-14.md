# Жива перевірка CHAT-3a (2026-10-14)

Те саме тестове WABA, що в [live-probe-2026-10-13.md](live-probe-2026-10-13.md); цього разу — через **наш код**
(`pnpm chat:connect-meta`, API + воркер), а не окремий скрипт. Токени, номери отримувачів і вміст повідомлень сюди не
потрапляють; журнал викликів (`channel_logs`) зберігає лише `recipientLast4` і id провайдера.

| Що | Результат |
| --- | --- |
| Підключення | `debug_token` з app token `APP_ID|APP_SECRET`: `SYSTEM_USER`, безстроковий, scopes `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`, `manage_app_solution`, `whatsapp_business_manage_events`, `public_profile`. `GET /{waba}` — назва «Test WhatsApp Business Account». Повторне підключення того ж акаунта оновлює токен і не дублює запис |
| Синхронізація номерів | один номер `+1 555-000-0001`, «Test Number», `quality_rating GREEN`, `account_mode LIVE`; повторна синхронізація — `updated 1`, без дублів |
| Шаблон `hello_world`/`en_US` | HTTP 200, `messages[0].id = wamid…`, повідомлення `SENT`, `attempts 1` |
| Текст | HTTP 200, `messages[0].id`. Вікно власника, найімовірніше, було відкрите (він писав на номер 2026-10-13); наш власний стан вікна невідомий (вхідні не приймаємо), тож локально нічого не блокувало — саме це робить `windowEnforcement: 'provider'` |
| `biz_opaque_callback_data` | Meta **приймає** на верхньому рівні тіла (і в шаблоні, і в тексті); чи повертається у вебхуку — перевіряється в 3b |
| Неіснуючий шаблон | HTTP **404**, код **132001** (`PERMANENT`) |
| Правильне імʼя, мова без перекладу | HTTP **404**, той самий **132001** — Meta не розрізняє «немає імені» і «немає мови» |
| Отримувач поза allow-списком | HTTP 400, **131030** (`PERMANENT`), заголовок про список дозволених |
| Невалідний токен | HTTP 400, `OAuthException`, **190** (`AUTH` → `NEEDS_REAUTH`); перевірено прямим викликом, шлях `NEEDS_REAUTH` покритий e2e |
| `131047` | не відтворено: потрібен отримувач із закритим вікном, а тестовий WABA дозволяє лише номер власника |

**Висновки для наступних фаз.**
- Статуси з відповіді не взяти: `SENT` значить «Meta прийняла». Текст поза вікном або на номер без WhatsApp може бути
  прийнятий синхронно й провалитись пізніше вебхуком — тому в 3a інтерфейс каже, що квитанцій немає, а їх
  отримання — перша задача 3b.
- Помилка шаблону показується однаково для імені й мови; текст для агента з заголовка Meta в 3a не виводиться
  (рядок «повідомлення не можна доставити на цей номер» для `PERMANENT` загальний) — доробка в 3b/3c.
- `health_status` WABA (блокування оплатою, код 141006) у 3a не читається й не показується: відправка шаблону
  працює попри нього (див. проби 2026-10-13); відображення — 3c.

## Вебхуки на стенді Hetzner (CHAT-3b1, вечір 2026-10-14)

| Що | Результат |
| --- | --- |
| Підписка номера (`POST /{phone-id}` з `webhook_configuration { override_callback_uri, verify_token }`) | прийнято, Meta пройшла GET-рукостискання з нашим verify token; зворотне читання: `phone_number` = наша адреса, `whatsapp_business_account`/`application` = fms-dev (недоторкані) |
| Скидання (`override_callback_uri: ""`) | знімає лише рівень номера; ефективне призначення знову fms-dev; повторна підписка з `replaceHost` працює |
| Вхідний текст з телефону | `messages[].type = text` з `from_user_id` (BSUID) і `contacts[].user_id`; `x-hub-signature-256` валідний над сирими байтами |
| Статуси нашого відправлення | `sent`, `delivered` з нашим id у `biz_opaque_callback_data`; `pricing` = `service` / `free_customer_service` (вікно відкрите вхідним) |
| Заголовки запиту Meta | `user-agent: facebookexternalua`, `x-hub-signature` і `x-hub-signature-256`, `content-type: application/json` |

## Вхідні й квитанції на стенді (CHAT-3b2)

| Що | Результат |
| --- | --- |
| Вхідний текст | розбір → контакт, відкрита розмова, повідомлення; `customerLastMessageAt` = час Meta, вікно +24 год; BSUID у `providerMeta` |
| Вхідне зображення | `type: image` з `id`/`mime_type`/`sha256`/`url` → повідомлення `[image]` + `payload.unsupported.type`; у стрічці «Message not supported (image)» |
| Відповідь зі стенду | `sent` → `delivered` → `read` (час `read` — момент відкриття на телефоні); два `delivered` на одне повідомлення Meta шле нерідко — другий нічого не міняє |
| Підпис | POST без підпису й з хибним — 401 (`enforce`); справжні Meta-хуки — `valid` |
| Старі захоплення (3b1) | не перепроцесуються: повідомлення, відправлене до 3b2, лишається на одній галочці |
