/**
 * Повторювана жива перевірка WhatsApp (CHAT-3a, design.md D12): ті самі виклики API, що й екран. Секрети — з
 * кореневого `.env` (`WHATSAPP_*`), у вивід не потрапляють. Потрібні запущені api + worker (для `--send`).
 *
 *   pnpm chat:connect-meta                  підключити акаунт (або оновити токен), синхронізувати номери,
 *                                           увімкнути перший номер і зробити його типовим
 *   pnpm chat:connect-meta --send           + розмова з WHATSAPP_TEST_RECIPIENT і шаблон hello_world/en_US
 *   pnpm chat:connect-meta --send --text "Привіт"   + звичайний текст (приймається, лише коли вікно відкрите)
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
for (const name of ['.env', '.env.local']) {
  const file = resolve(root, name);
  if (existsSync(file)) process.loadEnvFile(file);
}

const { values } = parseArgs({
  options: {
    api: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    tenant: { type: 'string' },
    send: { type: 'boolean' },
    text: { type: 'string' },
    help: { type: 'boolean' },
  },
});

if (values.help) {
  console.log(
    'pnpm chat:connect-meta [--send] [--text <текст>] [--api <url>] [--email] [--password] [--tenant]\n' +
      'Читає WHATSAPP_WABA_ID, WHATSAPP_ACCESS_TOKEN, (WHATSAPP_APP_ID, WHATSAPP_APP_SECRET), WHATSAPP_TEST_RECIPIENT з .env',
  );
  process.exit(0);
}

const env = (key: string): string => (process.env[`WHATSAPP_${key}`] ?? '').trim();
const api = (values.api ?? process.env.CHAT_SIM_API ?? 'http://localhost:3001').replace(/\/+$/, '');
const email = values.email ?? process.env.CHAT_SIM_EMAIL ?? 'admin@example.com';
const password = values.password ?? process.env.CHAT_SIM_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? 'Admin1234567';

interface Reply {
  status: number;
  json: unknown;
}

async function call(method: string, path: string, body?: unknown, token?: string): Promise<Reply> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/** Коротко про відповідь-помилку: код, повідомлення, поля — без тіла запиту й без токена */
function describe(reply: Reply): string {
  const body = reply.json as { code?: string; message?: string; fieldErrors?: { field: string; code?: string }[] } | null;
  const fields = body?.fieldErrors?.map((f) => `${f.field}:${f.code ?? '?'}`).join(', ');
  return `HTTP ${String(reply.status)} ${body?.code ?? ''} ${body?.message ?? ''}${fields ? ` [${fields}]` : ''}`.trim();
}

function must(reply: Reply, what: string): Reply {
  if (reply.status < 200 || reply.status >= 300) throw new Error(`${what} не вдалося: ${describe(reply)}`);
  return reply;
}

interface Account {
  id: string;
  provider: string;
  status: string;
  channels: { id: string; displayPhoneNumber: string | null; isEnabled: boolean; isDefault: boolean; isMissing: boolean }[];
  token: { kind: string; expiresAt: string | null; scopes: string[]; verified: boolean } | null;
}

async function main(): Promise<void> {
  const wabaId = env('WABA_ID');
  const accessToken = env('ACCESS_TOKEN');
  if (!wabaId || !accessToken) throw new Error('У .env потрібні WHATSAPP_WABA_ID і WHATSAPP_ACCESS_TOKEN');
  const appId = env('APP_ID');
  const appSecret = env('APP_SECRET');
  const app = appId && appSecret ? { appId, appSecret } : {};

  const login = await call('POST', '/api/auth/login', { email, password, ...(values.tenant ? { tenant: values.tenant } : {}) });
  const token = (login.json as { tokens?: { accessToken?: string } } | null)?.tokens?.accessToken;
  if (login.status !== 200 || !token) throw new Error(`Вхід не вдався (${describe(login)}) — api запущено на ${api}?`);

  const listed = must(await call('GET', '/api/settings/messaging', undefined, token), 'Читання акаунтів');
  let account = (listed.json as { items: Account[] }).items.find((a) => a.provider === 'meta_cloud');

  if (account) {
    console.log(`Акаунт уже є (${account.status}); оновлюю токен`);
    account = must(
      await call('PUT', `/api/settings/messaging/accounts/${account.id}/credentials`, { accessToken, ...app }, token),
      'Оновлення токена',
    ).json as Account;
  } else {
    account = must(
      await call('POST', '/api/settings/messaging/accounts', { provider: 'meta_cloud', wabaId, accessToken, ...app }, token),
      'Підключення',
    ).json as Account;
  }
  const connected = account;
  const info = connected.token;
  console.log(
    `Підключено: статус ${account.status}; токен ${info ? `${info.kind}, ${info.verified ? `перевірений, права: ${info.scopes.join(', ')}` : 'НЕ перевірений (немає app secret)'}, ${info.expiresAt ? `спливає ${info.expiresAt}` : 'без строку'}` : 'невідомий'}`,
  );

  const synced = must(await call('POST', `/api/settings/messaging/accounts/${account.id}/sync`, undefined, token), 'Синхронізація');
  console.log(`Номери: ${JSON.stringify(synced.json)}`);

  const after = must(await call('GET', '/api/settings/messaging', undefined, token), 'Читання номерів');
  const fresh = (after.json as { items: Account[] }).items.find((a) => a.id === connected.id);
  const first = fresh?.channels.find((c) => !c.isMissing);
  if (!first) throw new Error('У акаунті немає жодного номера (він не належить WABA чи токен не бачить номерів)');
  must(await call('PATCH', `/api/settings/messaging/channels/${first.id}`, { isEnabled: true }, token), 'Увімкнення номера');
  must(await call('PATCH', `/api/settings/messaging/channels/${first.id}`, { isDefault: true }, token), 'Типовий номер');
  console.log(`Номер ${first.displayPhoneNumber ?? first.id} увімкнено й зроблено типовим`);

  if (!values.send) return;

  const recipient = env('TEST_RECIPIENT');
  if (!recipient) throw new Error('Для --send потрібен WHATSAPP_TEST_RECIPIENT (номер зі списку отримувачів, E.164)');
  const started = must(
    await call('POST', '/api/chat/outreach', { channelId: first.id, phone: `+${recipient.replace(/\D/g, '')}` }, token),
    'Початок розмови',
  );
  const conversationId = (started.json as { id: string }).id;
  console.log(`Розмова ${conversationId}`);

  const sent: { label: string; id: string }[] = [];
  const template = must(
    await call('POST', `/api/conversations/${conversationId}/template-messages`, {
      name: 'hello_world',
      language: 'en_US',
      clientMessageId: randomUUID(),
    }, token),
    'Шаблон',
  );
  sent.push({ label: 'шаблон hello_world', id: (template.json as { id: string }).id });

  if (values.text) {
    const text = await call('POST', `/api/conversations/${conversationId}/messages`, { body: values.text, clientMessageId: randomUUID() }, token);
    if (text.status === 201) sent.push({ label: 'текст', id: (text.json as { id: string }).id });
    else console.log(`Текст не прийнято: ${describe(text)}`);
  }

  // Воркер доставляє асинхронно: чекаємо, доки жодне не лишиться в QUEUED/SENDING
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const transcript = must(await call('GET', `/api/conversations/${conversationId}/messages?limit=50`, undefined, token), 'Стрічка');
    const items = (transcript.json as { items: { id: string; status: string; externalId: string | null; failure: { class: string; code: string; title: string } | null }[] }).items;
    const mine = sent.map((s) => ({ ...s, row: items.find((m) => m.id === s.id) }));
    if (mine.every((m) => m.row && m.row.status !== 'QUEUED' && m.row.status !== 'SENDING')) {
      for (const m of mine) {
        const row = m.row;
        console.log(`${m.label}: ${row?.status ?? '?'}${row?.externalId ? ` (id ${row.externalId})` : ''}${row?.failure ? ` — ${row.failure.class} ${row.failure.code}: ${row.failure.title}` : ''}`);
      }
      return;
    }
  }
  console.log('Доставка ще триває після 30 с: перевірте, що worker запущено на новому коді');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
