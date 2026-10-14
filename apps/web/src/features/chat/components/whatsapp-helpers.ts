import type { ParsedApiError } from '@saas-skeleton/ui/api/api-error';

/** Мінімум того, що потрібно знати про токен акаунта для картки (форма — з `MessagingAccountResponse.token`) */
export interface TokenInfo {
  mask: string;
  kind: 'SYSTEM_USER' | 'USER' | 'UNKNOWN';
  expiresAt: string | null;
  scopes: string[];
  verified: boolean;
}

export type TokenState =
  | { state: 'permanent'; kind: TokenInfo['kind'] }
  | { state: 'unverified' }
  | { state: 'temporary'; msLeft: number }
  | { state: 'expired' };

/**
 * Як токен показується в картці (CHAT-3a): безстроковий системного користувача, «не перевірено» (підключили
 * без app secret — про вид і права нічого не знаємо), тимчасовий із відліком або вже протермінований.
 */
export function tokenState(token: TokenInfo, now: number): TokenState {
  if (token.expiresAt !== null) {
    const msLeft = new Date(token.expiresAt).getTime() - now;
    return msLeft > 0 ? { state: 'temporary', msLeft } : { state: 'expired' };
  }
  return token.verified ? { state: 'permanent', kind: token.kind } : { state: 'unverified' };
}

/** «3 d 4 h», «2 h 10 min», «15 min», «< 1 min»; без секунд — відлік тимчасового токена не має миготіти */
export function formatCountdown(msLeft: number): string {
  const minutes = Math.floor(msLeft / 60_000);
  if (minutes < 1) return '< 1 min';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${String(days)} d ${String(hours)} h`;
  if (hours > 0) return `${String(hours)} h ${String(mins)} min`;
  return `${String(mins)} min`;
}

/** Коди вердикту провайдера при підключенні (`CONNECTION_FIELD_CODES`) → ключ тексту й параметри */
export function connectionErrorKey(code: string): string {
  switch (code) {
    case 'token_invalid':
    case 'token_missing_scope':
    case 'token_wrong_app':
    case 'waba_no_access':
    case 'app_secret_invalid':
      return `settings.connect.errors.${code}`;
    default:
      return 'settings.connect.errors.generic';
  }
}

export interface FieldMessages {
  /** Помилки по полях форми: `{ accessToken: { key, params } }` */
  fields: Record<string, { key: string; params?: Record<string, string> }>;
  /** Помилка без поля (недоступний провайдер, ліміт частоти…) */
  generic: boolean;
}

/** `fieldErrors` відповіді → тексти під полями; усе інше — один загальний тост */
export function connectionFieldMessages(error: ParsedApiError): FieldMessages {
  const fields: FieldMessages['fields'] = {};
  for (const item of error.fieldErrors) {
    fields[item.field] = {
      key: item.code ? connectionErrorKey(item.code) : 'settings.connect.errors.generic',
      ...(item.params
        ? {
            params: Object.fromEntries(Object.entries(item.params).map(([k, v]) => [k, String(v)])),
          }
        : {}),
    };
  }
  return { fields, generic: Object.keys(fields).length === 0 };
}

/** Рядок номера в таблиці: що показати як стан */
export function channelState(channel: {
  isEnabled: boolean;
  isDefault: boolean;
  isMissing: boolean;
}): 'missing' | 'default' | 'enabled' | 'disabled' {
  if (channel.isMissing) return 'missing';
  if (channel.isEnabled && channel.isDefault) return 'default';
  return channel.isEnabled ? 'enabled' : 'disabled';
}

/** Ті самі правила, що в контракті `PostTemplateMessageSchema`: форма не пропускає того, що сервер відхилить */
export const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
export const TEMPLATE_LANGUAGE_PATTERN = /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/;

const LAST_TEMPLATE_KEY = 'chat.lastTemplate';

export interface TemplateChoice {
  name: string;
  language: string;
}

export const DEFAULT_TEMPLATE: TemplateChoice = { name: 'hello_world', language: 'en_US' };

/** Останній використаний шаблон цього браузера; зіпсоване чи відсутнє сховище — типовий (storage може кидати) */
export function readLastTemplate(storage: Pick<Storage, 'getItem'> | null): TemplateChoice {
  try {
    const raw = storage?.getItem(LAST_TEMPLATE_KEY);
    if (!raw) return DEFAULT_TEMPLATE;
    const parsed = JSON.parse(raw) as Partial<TemplateChoice>;
    if (
      typeof parsed.name === 'string' &&
      typeof parsed.language === 'string' &&
      TEMPLATE_NAME_PATTERN.test(parsed.name) &&
      TEMPLATE_LANGUAGE_PATTERN.test(parsed.language)
    ) {
      return { name: parsed.name, language: parsed.language };
    }
  } catch {
    // відсутнє чи заблоковане сховище — не помилка
  }
  return DEFAULT_TEMPLATE;
}

export function saveLastTemplate(
  storage: Pick<Storage, 'setItem'> | null,
  choice: TemplateChoice,
): void {
  try {
    storage?.setItem(LAST_TEMPLATE_KEY, JSON.stringify(choice));
  } catch {
    // квота чи приватне вікно: наступного разу буде типовий
  }
}

export interface WebhookStatusLike {
  state: 'ours' | 'none' | 'elsewhere';
  host: string | null;
  address: string | null;
}

export type WebhookAction =
  | { kind: 'no-address' }
  | { kind: 'subscribe' }
  | { kind: 'takeover'; host: string }
  | { kind: 'unsubscribe' };

/** Що можна зробити з номером: підписати, забрати чужі події (з названим хостом) чи відписати */
export function webhookAction(status: WebhookStatusLike): WebhookAction {
  if (status.state === 'ours') return { kind: 'unsubscribe' };
  if (!status.address) return { kind: 'no-address' };
  if (status.state === 'elsewhere') return { kind: 'takeover', host: status.host ?? 'unknown' };
  return { kind: 'subscribe' };
}

/**
 * Один рядок про захоплений вебхук, щоб список читався без розгортання: `status delivered`, `message text`,
 * `template_status APPROVED`, `account PHONE_NUMBER_ADDED`. Лише форма (типи подій), без номерів і тексту.
 */
export function summarizeWebhookBody(body: string): string {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return 'not JSON';
  }
  const parts: string[] = [];
  const entries = (json as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return 'unknown payload';
  for (const entry of entries as { changes?: unknown }[]) {
    if (!Array.isArray(entry.changes)) continue;
    for (const change of entry.changes as { field?: unknown; value?: Record<string, unknown> }[]) {
      const value = change.value ?? {};
      if (change.field === 'messages') {
        for (const s of (value.statuses as { status?: string }[] | undefined) ?? [])
          parts.push(`status ${s.status ?? '?'}`);
        for (const m of (value.messages as { type?: string }[] | undefined) ?? [])
          parts.push(`message ${m.type ?? '?'}`);
      } else if (change.field === 'message_template_status_update') {
        parts.push(`template_status ${typeof value.event === 'string' ? value.event : '?'}`);
      } else if (change.field === 'account_update') {
        parts.push(`account ${typeof value.event === 'string' ? value.event : '?'}`);
      } else {
        parts.push(typeof change.field === 'string' ? change.field : 'unknown');
      }
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'empty';
}

/** Шаблонне повідомлення (CHAT-3a) показується як «Template: імʼя (мова)», а не голим імʼям */
export function templateText(
  message: { payload?: unknown },
  t: (key: string, options: Record<string, string>) => string,
): string | null {
  const payload = message.payload as
    { template?: { name?: string; language?: string } } | null | undefined;
  const template = payload?.template;
  if (!template?.name) return null;
  return t('template.bubble', { name: template.name, language: template.language ?? '' });
}

/**
 * Тип провайдера, який ми не вміємо показати (CHAT-3b3): текст робить інтерфейс із `payload.unsupported`,
 * а не бекенд. Реакція — окремий випадок: показуємо емодзі, а не «не підтримується»
 */
export function unsupportedText(
  message: { payload?: unknown },
  t: (key: string, options: Record<string, string>) => string,
): string | null {
  const payload = message.payload as
    | { unsupported?: { type?: string }; reaction?: { emoji?: string | null } }
    | null
    | undefined;
  if (payload?.reaction !== undefined) {
    const emoji = payload.reaction.emoji;
    return emoji ? t('message.reaction', { emoji }) : t('message.reactionRemoved', {});
  }
  const type = payload?.unsupported?.type;
  return type ? t('message.unsupported', { type }) : null;
}
