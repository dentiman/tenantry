/**
 * Проба WhatsApp Cloud API на живому (тестовому) акаунті — поза продуктом.
 * docs/whatsapp-feature-flows.md §F0.5. Секрети — з кореневого `.env` (`WHATSAPP_*`), ніколи не друкуються.
 *
 *   pnpm whatsapp:probe                 лише читання: debug_token, WABA, номери, підписки, шаблони
 *   pnpm whatsapp:probe --subscribe     + POST /{waba}/subscribed_apps з override_callback_uri (потрібен WEBHOOK_BASE_URL)
 *   pnpm whatsapp:probe --send          + тестове повідомлення (шаблон hello_world) на WHATSAPP_TEST_RECIPIENT
 *   pnpm whatsapp:probe --text "Привіт"  + звичайний текст (працює лише у відкритому вікні 24 год: отримувач має написати першим)
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
for (const name of ['.env', '.env.local']) {
  const file = resolve(root, name);
  if (existsSync(file)) process.loadEnvFile(file);
}

const { values: flags } = parseArgs({
  options: {
    subscribe: { type: 'boolean' },
    send: { type: 'boolean' },
    text: { type: 'string' },
    json: { type: 'boolean' },
  },
});

const env = (key: string): string => (process.env[`WHATSAPP_${key}`] ?? '').trim();
const GRAPH = `https://graph.facebook.com/${env('GRAPH_VERSION') || 'v23.0'}`;
const token = env('ACCESS_TOKEN');
const waba = env('WABA_ID');

type Json = Record<string, unknown>;
interface GraphResult {
  ok: boolean;
  status: number;
  body: Json;
}
interface Check {
  step: string;
  ok: boolean;
  note: string;
}
const checks: Check[] = [];

async function graph(
  method: 'GET' | 'POST',
  path: string,
  opts: { query?: Record<string, string>; body?: Json; bearer?: string } = {},
): Promise<GraphResult> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${opts.bearer ?? token}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  return { ok: res.ok, status: res.status, body };
}

/** Значення з JSON Graph у рядок без `[object Object]` */
function str(value: unknown, fallback = '—'): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value === undefined || value === null ? fallback : JSON.stringify(value);
}

function errorText(r: GraphResult): string {
  const e = (r.body.error ?? {}) as Json;
  const parts = [`HTTP ${String(r.status)}`];
  if (e.code !== undefined) parts.push(`code ${str(e.code)}`);
  if (e.error_subcode !== undefined) parts.push(`subcode ${str(e.error_subcode)}`);
  if (typeof e.message === 'string') parts.push(e.message);
  if (typeof e.fbtrace_id === 'string') parts.push(`fbtrace ${e.fbtrace_id}`);
  return parts.join(' · ');
}

function record(step: string, ok: boolean, note: string): void {
  checks.push({ step, ok, note });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${step}: ${note}`);
}

/** Пробує набори `fields` від повного до порожнього: тестовий WABA може не знати частини полів. */
async function withFieldFallback(
  path: string,
  fieldSets: string[],
  extra: Record<string, string> = {},
): Promise<{ result: GraphResult; fields: string }> {
  let last: { result: GraphResult; fields: string } | undefined;
  for (const fields of fieldSets) {
    const result = await graph('GET', path, { query: { ...extra, ...(fields ? { fields } : {}) } });
    last = { result, fields };
    if (result.ok) break;
  }
  return last as { result: GraphResult; fields: string };
}

function arr(body: Json): Json[] {
  return Array.isArray(body.data) ? (body.data as Json[]) : [];
}

async function main(): Promise<void> {
  const missing = ['ACCESS_TOKEN', 'WABA_ID', 'APP_ID', 'APP_SECRET'].filter((k) => !env(k));
  if (missing.length) {
    console.error(`Порожні змінні у .env: ${missing.map((k) => `WHATSAPP_${k}`).join(', ')}`);
    process.exit(1);
  }
  console.log(`Graph: ${GRAPH}  WABA: ${waba}\n`);

  // 1. Токен
  const dbg = await graph('GET', 'debug_token', {
    query: { input_token: token },
    bearer: `${env('APP_ID')}|${env('APP_SECRET')}`,
  });
  if (!dbg.ok) {
    record('debug_token', false, errorText(dbg));
  } else {
    const d = (dbg.body.data ?? {}) as Json;
    const expires = Number(d.expires_at ?? -1);
    const scopes = Array.isArray(d.scopes) ? (d.scopes as string[]) : [];
    const needed = ['whatsapp_business_management', 'whatsapp_business_messaging'];
    const lacking = needed.filter((s) => !scopes.includes(s));
    const granular = JSON.stringify(d.granular_scopes ?? []);
    record(
      'debug_token',
      d.is_valid === true && lacking.length === 0,
      `valid=${String(d.is_valid)} type=${String(d.type)} app_id=${String(d.app_id) === env('APP_ID') ? 'збігається' : 'НЕ збігається'} ` +
        `expires_at=${expires === 0 ? '0 (безстроковий)' : new Date(expires * 1000).toISOString()} ` +
        `data_access_expires_at=${str(d.data_access_expires_at)} scopes=[${scopes.join(',')}]` +
        (lacking.length ? ` БРАКУЄ: ${lacking.join(',')}` : '') +
        ` granular=${granular.length > 400 ? `${granular.slice(0, 400)}…` : granular}`,
    );
  }

  // 2. WABA
  const w = await withFieldFallback(
    waba,
    [
      'id,name,currency,timezone_id,message_template_namespace,account_review_status,business_verification_status,health_status',
      'id,name,currency,timezone_id,message_template_namespace',
      'id,name',
    ],
  );
  record(
    'GET /{waba}',
    w.result.ok,
    w.result.ok ? `fields=${w.fields} → ${JSON.stringify(w.result.body)}` : errorText(w.result),
  );

  // 3. Номери
  const p = await withFieldFallback(`${waba}/phone_numbers`, [
    'id,display_phone_number,verified_name,quality_rating,name_status,status,account_mode,code_verification_status,platform_type,throughput',
    'id,display_phone_number,verified_name,quality_rating,status',
    'id,display_phone_number,verified_name',
    '',
  ]);
  const phones = p.result.ok ? arr(p.result.body) : [];
  record(
    'GET /{waba}/phone_numbers',
    p.result.ok && phones.length > 0,
    p.result.ok
      ? `${String(phones.length)} номер(ів), fields=${p.fields || '(за замовчуванням)'} → ${JSON.stringify(phones)}`
      : errorText(p.result),
  );
  if (p.result.ok && phones.length > 0) {
    const hasMode = phones.some((x) => x.account_mode !== undefined);
    record('поле account_mode', hasMode, hasMode ? 'присутнє' : 'відсутнє на цьому WABA — синхронізація має це терпіти');
  }

  // 4. Підписки застосунків
  const subs = await graph('GET', `${waba}/subscribed_apps`);
  record('GET /{waba}/subscribed_apps', subs.ok, subs.ok ? JSON.stringify(subs.body) : errorText(subs));

  // 5. Шаблони
  const tpl = await withFieldFallback(
    `${waba}/message_templates`,
    ['id,name,language,status,category,components', 'id,name,language,status,category', ''],
    { limit: '100' },
  );
  const templates = tpl.result.ok ? arr(tpl.result.body) : [];
  record(
    'GET /{waba}/message_templates',
    tpl.result.ok,
    tpl.result.ok
      ? `${String(templates.length)} шаблон(ів), fields=${tpl.fields || '(за замовчуванням)'}: ${templates.map((t) => `${String(t.name)}/${String(t.language)}=${String(t.status)}`).join(', ') || '—'}`
      : errorText(tpl.result),
  );

  // 6. Підписка з override_callback_uri (запис — лише з --subscribe)
  if (flags.subscribe) {
    const base = env('WEBHOOK_BASE_URL').replace(/\/$/, '');
    if (!base || !env('VERIFY_TOKEN')) {
      record('POST /{waba}/subscribed_apps', false, 'потрібні WHATSAPP_WEBHOOK_BASE_URL і WHATSAPP_VERIFY_TOKEN');
    } else {
      const r = await graph('POST', `${waba}/subscribed_apps`, {
        body: {
          override_callback_uri: `${base}/public/channels/meta_cloud/probe`,
          verify_token: env('VERIFY_TOKEN'),
        },
      });
      record('POST /{waba}/subscribed_apps (override_callback_uri)', r.ok, r.ok ? JSON.stringify(r.body) : errorText(r));
    }
  }

  // 7. Тестова відправка (запис — лише з --send)
  if (flags.send) {
    const to = env('TEST_RECIPIENT').replace(/\D/g, '');
    const phoneId = str(phones[0]?.id, '');
    if (!to || !phoneId) {
      record('POST /{phone}/messages', false, 'потрібні WHATSAPP_TEST_RECIPIENT і хоча б один номер у WABA');
    } else {
      const r = await graph('POST', `${phoneId}/messages`, {
        body: {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: { name: 'hello_world', language: { code: 'en_US' } },
          biz_opaque_callback_data: 'probe-1',
        },
      });
      record('POST /{phone}/messages (hello_world)', r.ok, r.ok ? JSON.stringify(r.body) : errorText(r));
    }
  }

  // 8. Звичайний текст (запис — лише з --text); тіло — у `text.body`, перевіряє вікно 24 год
  if (flags.text !== undefined) {
    const to = env('TEST_RECIPIENT').replace(/\D/g, '');
    const phoneId = str(phones[0]?.id, '');
    if (!to || !phoneId || !flags.text) {
      record('POST /{phone}/messages (text)', false, 'потрібні WHATSAPP_TEST_RECIPIENT, номер у WABA і непорожній текст');
    } else {
      const r = await graph('POST', `${phoneId}/messages`, {
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: flags.text, preview_url: false },
          biz_opaque_callback_data: 'probe-text-1',
        },
      });
      record('POST /{phone}/messages (text)', r.ok, r.ok ? JSON.stringify(r.body) : errorText(r));
    }
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\nПідсумок: ${String(checks.length - failed)}/${String(checks.length)} OK`);
  if (flags.json) console.log(JSON.stringify(checks, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('Скрипт впав:', err instanceof Error ? err.message : err);
  process.exit(1);
});
