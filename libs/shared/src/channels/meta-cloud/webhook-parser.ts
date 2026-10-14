import { NormalizedEventSchema, type NormalizedEvent } from '@saas-skeleton/contracts';
import type { ParseResult } from '../channel-adapter';
import { classifyWebhookFailure } from './errors';

/**
 * Тіло вебхука Meta → події ядра (CHAT-3b2, design.md D1–D4). Форму звірено зі 300 справжніми хуками (fms-dev і наші
 * захоплення, `docs/whatsapp-research/fms-webhook-sample-2026-10-14.md`). Чиста функція: нічого не кидає, одна
 * зіпсована гілка не губить решту пакета, а все, чого не вміємо, лишається `unsupported` — видимим, а не мовчки
 * відкинутим. Нічого не завантажує й не інтерпретує сверх повідомлень і квитанцій.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);

/** Секунди Unix (рядком чи числом) → ISO; `null`, якщо не число */
function iso(seconds: unknown): string | null {
  const n = typeof seconds === 'string' ? Number(seconds) : seconds;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function unsupported(channel: string | null, reason: string, meta: Json = {}): NormalizedEvent {
  return { kind: 'unsupported', channelExternalId: channel, reason, providerMeta: meta };
}

export function parseMetaWebhook(raw: Buffer): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    return { events: [], error: 'invalid_json' };
  }
  if (!isObject(json) || !Array.isArray(json.entry)) {
    return { events: [], error: 'unexpected_payload' };
  }

  const events: NormalizedEvent[] = [];
  for (const entry of list(json.entry)) {
    for (const change of list(entry.changes)) {
      const field = str(change.field) ?? 'unknown';
      const value = isObject(change.value) ? change.value : {};
      if (field !== 'messages') {
        events.push(unsupported(null, `field:${field}`));
        continue;
      }
      events.push(...parseMessagesChange(value));
    }
  }

  // Контракт — останній рубіж: подія, що його не проходить, не йде далі, а стає видимою заглушкою
  return {
    events: events.map((event) => {
      const checked = NormalizedEventSchema.safeParse(event);
      return checked.success ? checked.data : unsupported(null, 'invalid_event');
    }),
  };
}

function parseMessagesChange(value: Json): NormalizedEvent[] {
  const phoneId = isObject(value.metadata) ? str(value.metadata.phone_number_id) : null;
  if (!phoneId) return [unsupported(null, 'no_phone_number_id')];

  // Імʼя і BSUID відправника — з `contacts[]` за wa_id
  const contacts = new Map<string, { name: string | null; userId: string | null }>();
  for (const contact of list(value.contacts)) {
    const waId = str(contact.wa_id);
    if (!waId) continue;
    contacts.set(waId, {
      name: isObject(contact.profile) ? str(contact.profile.name) : null,
      userId: str(contact.user_id),
    });
  }

  const events: NormalizedEvent[] = [];

  for (const status of list(value.statuses)) {
    events.push(parseStatus(phoneId, status));
  }

  for (const message of list(value.messages)) {
    events.push(parseMessage(phoneId, message, contacts));
  }
  return events;
}

function parseStatus(phoneId: string, status: Json): NormalizedEvent {
  const id = str(status.id);
  const kind = str(status.status);
  if (!id) return unsupported(phoneId, 'invalid_status');
  if (kind !== 'sent' && kind !== 'delivered' && kind !== 'read' && kind !== 'failed') {
    return unsupported(phoneId, `unknown_status:${kind ?? '?'}`);
  }

  let failure = null;
  if (kind === 'failed') {
    const error = list(status.errors)[0] ?? {};
    const code = typeof error.code === 'number' ? error.code : null;
    failure = classifyWebhookFailure(
      code,
      str(error.title) ?? str(error.message) ?? 'The provider could not deliver the message',
      isObject(error.error_data) ? str(error.error_data.details) : null,
    );
  }

  return {
    kind: 'status',
    channelExternalId: phoneId,
    externalMessageId: id,
    opaqueId: str(status.biz_opaque_callback_data),
    status: kind,
    occurredAt: iso(status.timestamp) ?? new Date().toISOString(),
    failure,
    providerMeta: {
      recipient_id: str(status.recipient_id),
      recipient_user_id: str(status.recipient_user_id),
      pricing: isObject(status.pricing) ? status.pricing : null,
      conversation: isObject(status.conversation) ? status.conversation : null,
    },
  };
}

function parseMessage(
  phoneId: string,
  message: Json,
  contacts: Map<string, { name: string | null; userId: string | null }>,
): NormalizedEvent {
  const id = str(message.id);
  const from = str(message.from);
  const type = str(message.type);
  if (!id || !from || !type) return unsupported(phoneId, 'invalid_message');

  const sentAt = iso(message.timestamp) ?? new Date().toISOString();
  const contact = contacts.get(from);
  const text = isObject(message.text) ? str(message.text.body) : null;
  const isText = type === 'text' && text !== null;

  return {
    kind: 'message',
    externalMessageId: id,
    channelExternalId: phoneId,
    from: { kind: 'phone', value: from },
    profileName: contact?.name ?? null,
    sentAt,
    // Тип, якого не вміємо показати, лишає нейтральну заглушку; текст для людини робить інтерфейс
    content: isText
      ? { type: 'text', body: text }
      : {
          type: 'text',
          body: `[${type}]`.slice(0, 66),
          unsupportedType: type.slice(0, 64),
          // Реакція (CHAT-3b3): емодзі зберігаємо; без нього реакцію зняли
          ...(type === 'reaction' && { reaction: { emoji: reactionEmoji(message) } }),
        },
    providerMeta: {
      from_user_id: str(message.from_user_id),
      user_id: contact?.userId ?? null,
      context: isObject(message.context) ? message.context : null,
    },
  };
}

function reactionEmoji(message: Json): string | null {
  const emoji = isObject(message.reaction) ? str(message.reaction.emoji) : null;
  return emoji ? emoji.slice(0, 32) : null;
}
