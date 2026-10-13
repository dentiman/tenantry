/**
 * Симулятор вхідних клієнтських повідомлень (CHAT-2a, design.md D9). Тонка обгортка над dev-ендпоінтами API:
 * логіниться адміном, гарантує fake-канал і шле підписане повідомлення на ПУБЛІЧНИЙ вебхук, тож
 * проходить увесь шлях, як справжній провайдер. Потрібні `CHAT_DEV_TOOLS=true` і запущені api + worker.
 *
 *   pnpm chat:simulate --text "Доброго дня" --from +380501234567 --name "Олена"
 *   pnpm chat:simulate --text "ще раз" --id sim-1        # той самий --id двічі = повтор доставки (дедуп)
 */
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
    from: { type: 'string' },
    text: { type: 'string' },
    name: { type: 'string' },
    id: { type: 'string' },
    help: { type: 'boolean' },
  },
});

if (values.help) {
  console.log('pnpm chat:simulate --text <текст> [--from <номер>] [--name <імʼя>] [--id <id провайдера>] [--api <url>] [--email] [--password] [--tenant]');
  process.exit(0);
}

const api = (values.api ?? process.env.CHAT_SIM_API ?? 'http://localhost:3001').replace(/\/+$/, '');
const email = values.email ?? process.env.CHAT_SIM_EMAIL ?? 'admin@example.com';
const password = values.password ?? process.env.CHAT_SIM_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? 'Admin1234567';

async function call(path: string, body: unknown, token?: string): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function main(): Promise<void> {
  const login = await call('/api/auth/login', { email, password, ...(values.tenant ? { tenant: values.tenant } : {}) });
  const token = (login.json as { tokens?: { accessToken?: string } } | null)?.tokens?.accessToken;
  if (login.status !== 200 || !token) {
    throw new Error(`Вхід не вдався (HTTP ${String(login.status)}) — перевірте --email/--password і що api запущено на ${api}`);
  }

  const setup = await call('/api/dev/chat/fake-channel', {}, token);
  if (setup.status === 404) {
    throw new Error('Dev-інструменти вимкнені: додайте CHAT_DEV_TOOLS=true у .env і перезапустіть api та worker');
  }
  if (setup.status !== 200) throw new Error(`Не вдалося підготувати fake-канал (HTTP ${String(setup.status)})`);

  const sent = await call(
    '/api/dev/chat/simulate',
    {
      from: values.from ?? '+380501234567',
      text: values.text ?? 'Доброго дня! Це тестове повідомлення.',
      ...(values.name ? { profileName: values.name } : {}),
      ...(values.id ? { externalMessageId: values.id } : {}),
    },
    token,
  );
  const result = sent.json as { externalMessageId?: string; webhookStatus?: number } | null;
  if (sent.status !== 200 || result?.webhookStatus !== 200) {
    throw new Error(`Вебхук не прийняв повідомлення (HTTP ${String(sent.status)}, вебхук ${String(result?.webhookStatus)})`);
  }
  console.log(`OK: повідомлення ${String(result.externalMessageId)} прийнято вебхуком; воркер покладе його в скриньку за ~1 с`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
