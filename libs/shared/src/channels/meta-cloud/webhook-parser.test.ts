import { describe, expect, it } from 'vitest';
import { classifyWebhookFailure } from './errors';
import {
  PHONE_ID,
  accountUpdateHook,
  failedHook,
  mediaHook,
  reactionHook,
  statusHook,
  templateStatusHook,
  textHook,
} from './testing/webhook-fixtures';
import { parseMetaWebhook } from './webhook-parser';

const parse = (body: string): ReturnType<typeof parseMetaWebhook> => parseMetaWebhook(Buffer.from(body));

interface Hook {
  entry: { changes: { value: Record<string, unknown> }[] }[];
}

/** Правка `value` кожної зміни готового тіла: так ламаємо справжню форму, не будуючи JSON руками */
function tweak(body: string, apply: (value: Record<string, unknown>) => void): string {
  const hook = JSON.parse(body) as Hook;
  for (const entry of hook.entry) for (const change of entry.changes) apply(change.value);
  return JSON.stringify(hook);
}

describe('parseMetaWebhook — повідомлення', () => {
  it('текст: адреса-телефон, імʼя з contacts, час із секунд, BSUID у providerMeta', () => {
    const { events, error } = parse(textHook({ id: 'wamid.T1', body: 'Привіт', name: 'Олена', bsuid: 'UA.77' }));
    expect(error).toBeUndefined();
    expect(events).toEqual([
      {
        kind: 'message',
        externalMessageId: 'wamid.T1',
        channelExternalId: PHONE_ID,
        from: { kind: 'phone', value: '380000000001' },
        profileName: 'Олена',
        sentAt: new Date(1791961399 * 1000).toISOString(),
        content: { type: 'text', body: 'Привіт' },
        providerMeta: { from_user_id: 'UA.77', user_id: 'UA.77', context: null },
      },
    ]);
  });

  it.each(['image', 'document'] as const)('%s → нейтральна заглушка з типом, без завантаження', (type) => {
    const [event] = parse(mediaHook({ id: `wamid.${type}`, type })).events;
    expect(event).toMatchObject({
      kind: 'message',
      content: { type: 'text', body: `[${type}]`, unsupportedType: type },
    });
  });

  it('знята реакція (без емодзі) — reaction.emoji: null', () => {
    const removed = tweak(reactionHook({ id: 'wamid.R2', target: 'wamid.X' }), (value) => {
      for (const m of value.messages as { reaction: Record<string, unknown> }[]) delete m.reaction.emoji;
    });
    const [event] = parse(removed).events;
    expect(event).toMatchObject({ content: { unsupportedType: 'reaction', reaction: { emoji: null } } });
  });

  it('реакція і невідомий тип — теж заглушки', () => {
    const [reaction] = parse(reactionHook({ id: 'wamid.R', target: 'wamid.X' })).events;
    expect(reaction).toMatchObject({
      content: { body: '[reaction]', unsupportedType: 'reaction', reaction: { emoji: '👍' } },
    });

    const weird = tweak(textHook({ id: 'wamid.W' }), (value) => {
      for (const m of value.messages as { type: string }[]) m.type = 'hologram';
    });
    const [event] = parse(weird).events;
    expect(event).toMatchObject({ content: { body: '[hologram]', unsupportedType: 'hologram' } });
  });

  it('текст без body — заглушка `[text]`, а не порожнє повідомлення', () => {
    const body = tweak(textHook({ id: 'wamid.E' }), (value) => {
      for (const m of value.messages as { text: unknown }[]) m.text = {};
    });
    const [event] = parse(body).events;
    expect(event).toMatchObject({ content: { unsupportedType: 'text' } });
  });
});

describe('parseMetaWebhook — квитанції', () => {
  it('sent/delivered/read: наш id з biz_opaque_callback_data, час з секунд, pricing у providerMeta', () => {
    for (const status of ['sent', 'delivered', 'read'] as const) {
      const [event] = parse(statusHook({ id: 'wamid.S', status, opaque: 'our-id', timestamp: '1791961500' })).events;
      expect(event).toMatchObject({
        kind: 'status',
        channelExternalId: PHONE_ID,
        externalMessageId: 'wamid.S',
        opaqueId: 'our-id',
        status,
        occurredAt: new Date(1791961500 * 1000).toISOString(),
        failure: null,
      });
    }
    const [read] = parse(statusHook({ id: 'wamid.S', status: 'read' })).events;
    expect(read).toMatchObject({ providerMeta: { pricing: { type: 'free_customer_service' }, recipient_user_id: 'UA.2' } });
  });

  it('без biz_opaque_callback_data — opaqueId null', () => {
    const [event] = parse(statusHook({ id: 'wamid.S', status: 'sent' })).events;
    expect(event).toMatchObject({ opaqueId: null });
  });

  it('failed 131049 → клас POLICY, код, наш заголовок і details від Meta', () => {
    const [event] = parse(failedHook({ id: 'wamid.F', code: 131049, opaque: 'our-id', details: 'engagement policy' })).events;
    expect(event).toMatchObject({
      kind: 'status',
      status: 'failed',
      opaqueId: 'our-id',
      failure: { class: 'POLICY', code: '131049', details: 'engagement policy' },
    });
  });

  it('невідомий код у failed — PERMANENT (фінальний статус не повторюють)', () => {
    expect(classifyWebhookFailure(999999, 'Odd', null)).toEqual({ class: 'PERMANENT', code: '999999', title: 'Odd' });
    expect(classifyWebhookFailure(null, 'No code', 'why')).toMatchObject({ class: 'PERMANENT', code: 'unknown', details: 'why' });
    expect(classifyWebhookFailure(131047, 'x', null)).toMatchObject({ class: 'WINDOW_CLOSED' });
    expect(classifyWebhookFailure(190, 'x', null)).toMatchObject({ class: 'AUTH' });
  });
});

describe('parseMetaWebhook — решта', () => {
  it('інші поля (шаблон, акаунт) — unsupported із назвою поля', () => {
    expect(parse(templateStatusHook()).events).toEqual([
      { kind: 'unsupported', channelExternalId: null, reason: 'field:message_template_status_update', providerMeta: {} },
    ]);
    expect(parse(accountUpdateHook()).events).toMatchObject([{ kind: 'unsupported', reason: 'field:account_update' }]);
  });

  it('пакет зі статусом і повідомленням дає обидві події; зіпсована гілка не губить решту', () => {
    const batch = tweak(statusHook({ id: 'wamid.S', status: 'sent' }), (value) => {
      value.messages = [
        { from: '380000000002', id: 'wamid.M', timestamp: '1791961399', type: 'text', text: { body: 'hi' } },
        { id: 'broken' },
      ];
    });
    const kinds = parse(batch).events.map((e) => (e.kind === 'unsupported' ? `unsupported:${e.reason}` : e.kind));
    expect(kinds).toEqual(['status', 'message', 'unsupported:invalid_message']);
  });

  it('без phone_number_id — одна unsupported; невідомий статус — unsupported', () => {
    const noPhone = tweak(textHook({ id: 'wamid.N' }), (value) => {
      value.metadata = {};
    });
    expect(parse(noPhone).events).toMatchObject([{ kind: 'unsupported', reason: 'no_phone_number_id' }]);

    const odd = tweak(statusHook({ id: 'wamid.O', status: 'sent' }), (value) => {
      for (const st of value.statuses as { status: string }[]) st.status = 'deleted';
    });
    expect(parse(odd).events).toMatchObject([{ kind: 'unsupported', reason: 'unknown_status:deleted' }]);
  });

  it('не JSON → invalid_json; JSON не тієї форми → unexpected_payload; порожній entry → без подій', () => {
    expect(parse('<<>>')).toEqual({ events: [], error: 'invalid_json' });
    expect(parse('{"hello":1}')).toEqual({ events: [], error: 'unexpected_payload' });
    expect(parse('{"entry":[]}')).toEqual({ events: [] });
  });
});
