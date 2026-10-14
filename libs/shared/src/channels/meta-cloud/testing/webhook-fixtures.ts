/**
 * Тіла вебхуків Meta зі справжньою формою (CHAT-3b2): знято зі 300 хуків fms-dev і наших захоплень на стенді,
 * значення вигадані. Лише для тестів (юніт і e2e).
 */

export const PHONE_ID = '120000000000001';
export const WABA_ID = '210000000000001';

type Json = Record<string, unknown>;

const envelope = (field: string, value: Json): string =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: WABA_ID, changes: [{ value, field }] }],
  });

const metadata = (phoneId = PHONE_ID): Json => ({
  display_phone_number: '15550000001',
  phone_number_id: phoneId,
});

export function textHook(opts: {
  id: string;
  from?: string;
  body?: string;
  name?: string;
  timestamp?: string;
  phoneId?: string;
  bsuid?: string;
}): string {
  const from = opts.from ?? '380000000001';
  return envelope('messages', {
    messaging_product: 'whatsapp',
    metadata: metadata(opts.phoneId),
    contacts: [
      {
        profile: { name: opts.name ?? 'Denis' },
        wa_id: from,
        ...(opts.bsuid && { user_id: opts.bsuid }),
      },
    ],
    messages: [
      {
        from,
        ...(opts.bsuid && { from_user_id: opts.bsuid }),
        id: opts.id,
        timestamp: opts.timestamp ?? '1791961399',
        text: { body: opts.body ?? 'Test on saas' },
        type: 'text',
      },
    ],
  });
}

export function mediaHook(opts: {
  id: string;
  type: 'image' | 'document';
  from?: string;
  phoneId?: string;
}): string {
  const from = opts.from ?? '380000000001';
  return envelope('messages', {
    messaging_product: 'whatsapp',
    metadata: metadata(opts.phoneId),
    contacts: [{ profile: { name: 'Sample Sender' }, wa_id: from }],
    messages: [
      {
        from,
        id: opts.id,
        timestamp: '1791961400',
        type: opts.type,
        [opts.type]: {
          mime_type: opts.type === 'image' ? 'image/jpeg' : 'application/pdf',
          sha256: 'if9aBY9vO9WHJ9pnRhiesHAlZ9zp9w',
          id: `media-${opts.id}`,
          url: 'https://lookaside.example/media',
        },
      },
    ],
  });
}

export function reactionHook(opts: {
  id: string;
  target: string;
  from?: string;
  phoneId?: string;
  timestamp?: string;
}): string {
  const from = opts.from ?? '380000000001';
  return envelope('messages', {
    messaging_product: 'whatsapp',
    metadata: metadata(opts.phoneId),
    contacts: [{ profile: { name: 'Sample Reactor' }, wa_id: from, user_id: 'UA.1' }],
    messages: [
      {
        from,
        from_user_id: 'UA.1',
        id: opts.id,
        timestamp: opts.timestamp ?? '1791961401',
        type: 'reaction',
        reaction: { message_id: opts.target, emoji: '👍' },
      },
    ],
  });
}

export function statusHook(opts: {
  id: string;
  status: 'sent' | 'delivered' | 'read';
  opaque?: string;
  timestamp?: string;
  to?: string;
  phoneId?: string;
}): string {
  const to = opts.to ?? '380000000001';
  return envelope('messages', {
    messaging_product: 'whatsapp',
    metadata: metadata(opts.phoneId),
    ...(opts.status !== 'read' && { contacts: [{ wa_id: to, user_id: 'UA.2' }] }),
    statuses: [
      {
        id: opts.id,
        status: opts.status,
        timestamp: opts.timestamp ?? '1791961399',
        recipient_id: to,
        recipient_user_id: 'UA.2',
        ...(opts.opaque && { biz_opaque_callback_data: opts.opaque }),
        pricing:
          opts.status === 'read'
            ? { billable: false, pricing_model: 'PMP', category: 'service', type: 'free_customer_service' }
            : { billable: true, pricing_model: 'PMP', category: 'utility', type: 'regular' },
      },
    ],
  });
}

export function failedHook(opts: {
  id: string;
  code: number;
  opaque?: string;
  details?: string;
  phoneId?: string;
}): string {
  return envelope('messages', {
    messaging_product: 'whatsapp',
    metadata: metadata(opts.phoneId),
    statuses: [
      {
        id: opts.id,
        status: 'failed',
        timestamp: '1791961500',
        recipient_id: '380000000001',
        recipient_user_id: 'UA.2',
        ...(opts.opaque && { biz_opaque_callback_data: opts.opaque }),
        errors: [
          {
            code: opts.code,
            title: 'This message was not delivered to maintain healthy ecosystem engagement.',
            message: 'This message was not delivered to maintain healthy ecosystem engagement.',
            error_data: { details: opts.details ?? 'Message failed to send because of an engagement policy.' },
          },
        ],
      },
    ],
  });
}

export const templateStatusHook = (): string =>
  envelope('message_template_status_update', {
    event: 'APPROVED',
    message_template_id: 2055586498393722,
    message_template_name: 'some_template',
    message_template_language: 'en_US',
    reason: 'NONE',
    message_template_category: 'MARKETING',
  });

export const accountUpdateHook = (): string =>
  envelope('account_update', { phone_number: '15550000001', event: 'PHONE_NUMBER_ADDED' });
