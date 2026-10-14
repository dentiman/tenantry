import { describe, expect, it } from 'vitest';
import type { ParsedApiError } from '@saas-skeleton/ui/api/api-error';
import {
  channelState,
  connectionErrorKey,
  connectionFieldMessages,
  DEFAULT_TEMPLATE,
  formatCountdown,
  readLastTemplate,
  summarizeWebhookBody,
  templateText,
  unsupportedText,
  webhookAction,
  saveLastTemplate,
  TEMPLATE_LANGUAGE_PATTERN,
  TEMPLATE_NAME_PATTERN,
  tokenState,
  type TokenInfo,
} from './whatsapp-helpers';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const token = (over: Partial<TokenInfo>): TokenInfo => ({
  mask: '••••abcd',
  kind: 'SYSTEM_USER',
  expiresAt: null,
  scopes: ['whatsapp_business_messaging'],
  verified: true,
  ...over,
});

describe('tokenState', () => {
  it('безстроковий перевірений токен — permanent з видом', () => {
    expect(tokenState(token({}), NOW)).toEqual({ state: 'permanent', kind: 'SYSTEM_USER' });
  });

  it('без app secret — «не перевірено», навіть якщо вид невідомий', () => {
    expect(tokenState(token({ verified: false, kind: 'UNKNOWN', scopes: [] }), NOW)).toEqual({
      state: 'unverified',
    });
  });

  it('тимчасовий — відлік; протермінований — expired', () => {
    expect(
      tokenState(
        token({ kind: 'USER', expiresAt: new Date(NOW + 90 * 60_000).toISOString() }),
        NOW,
      ),
    ).toEqual({
      state: 'temporary',
      msLeft: 90 * 60_000,
    });
    expect(
      tokenState(token({ kind: 'USER', expiresAt: new Date(NOW - 1000).toISOString() }), NOW),
    ).toEqual({ state: 'expired' });
  });
});

describe('formatCountdown', () => {
  it.each([
    [30_000, '< 1 min'],
    [15 * 60_000, '15 min'],
    [(2 * 60 + 10) * 60_000, '2 h 10 min'],
    [(3 * 1440 + 4 * 60) * 60_000, '3 d 4 h'],
  ])('%i мс → %s', (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

describe('connectionErrorKey / connectionFieldMessages', () => {
  it('усі коди вердикту мають свій текст, невідомий — загальний', () => {
    for (const code of [
      'token_invalid',
      'token_missing_scope',
      'token_wrong_app',
      'waba_no_access',
      'app_secret_invalid',
    ]) {
      expect(connectionErrorKey(code)).toBe(`settings.connect.errors.${code}`);
    }
    expect(connectionErrorKey('something_new')).toBe('settings.connect.errors.generic');
  });

  it('fieldErrors → тексти під полями з параметрами; без fieldErrors — загальна помилка', () => {
    const withFields: ParsedApiError = {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'x',
      fieldErrors: [
        {
          field: 'accessToken',
          message: 'm',
          code: 'token_missing_scope',
          params: { scope: 'whatsapp_business_messaging' },
        },
      ],
    };
    expect(connectionFieldMessages(withFields)).toEqual({
      fields: {
        accessToken: {
          key: 'settings.connect.errors.token_missing_scope',
          params: { scope: 'whatsapp_business_messaging' },
        },
      },
      generic: false,
    });
    expect(
      connectionFieldMessages({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'x',
        fieldErrors: [],
      }).generic,
    ).toBe(true);
  });
});

describe('channelState', () => {
  it('зниклий важливіший за решту; default — лише для ввімкненого', () => {
    expect(channelState({ isEnabled: true, isDefault: true, isMissing: true })).toBe('missing');
    expect(channelState({ isEnabled: true, isDefault: true, isMissing: false })).toBe('default');
    expect(channelState({ isEnabled: true, isDefault: false, isMissing: false })).toBe('enabled');
    expect(channelState({ isEnabled: false, isDefault: false, isMissing: false })).toBe('disabled');
  });
});

describe('шаблон: патерни збігаються з контрактом', () => {
  it('імʼя — малі літери, цифри, підкреслення; мова — ll або ll_RR', () => {
    expect(TEMPLATE_NAME_PATTERN.test('hello_world')).toBe(true);
    expect(TEMPLATE_NAME_PATTERN.test('Hello World')).toBe(false);
    expect(TEMPLATE_LANGUAGE_PATTERN.test('en_US')).toBe(true);
    expect(TEMPLATE_LANGUAGE_PATTERN.test('uk')).toBe(true);
    expect(TEMPLATE_LANGUAGE_PATTERN.test('english')).toBe(false);
  });
});

describe('запамʼятований шаблон', () => {
  const memory = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return {
      data,
      getItem: (key) => data[key] ?? null,
      setItem: (key, value) => {
        data[key] = value;
      },
    };
  };

  it('збережений вибір повертається; порожнє, зіпсоване чи недійсне сховище дає типовий', () => {
    const storage = memory();
    expect(readLastTemplate(storage)).toEqual(DEFAULT_TEMPLATE);
    saveLastTemplate(storage, { name: 'order_ready', language: 'uk' });
    expect(readLastTemplate(storage)).toEqual({ name: 'order_ready', language: 'uk' });

    storage.data['chat.lastTemplate'] = '{не json';
    expect(readLastTemplate(storage)).toEqual(DEFAULT_TEMPLATE);
    storage.data['chat.lastTemplate'] = JSON.stringify({ name: 'Bad Name', language: 'uk' });
    expect(readLastTemplate(storage)).toEqual(DEFAULT_TEMPLATE);
    expect(readLastTemplate(null)).toEqual(DEFAULT_TEMPLATE);
  });

  it('сховище, що кидає, не ламає ні читання, ні запис', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readLastTemplate(broken)).toEqual(DEFAULT_TEMPLATE);
    expect(() => {
      saveLastTemplate(broken, DEFAULT_TEMPLATE);
    }).not.toThrow();
  });
});

describe('webhookAction', () => {
  it('наші → відписати; без адреси → «немає адреси»; чужі → забрати з назвою хоста; нічиї → підписати', () => {
    expect(webhookAction({ state: 'ours', host: 'a', address: 'x' })).toEqual({
      kind: 'unsubscribe',
    });
    expect(webhookAction({ state: 'none', host: null, address: null })).toEqual({
      kind: 'no-address',
    });
    expect(webhookAction({ state: 'elsewhere', host: 'fms.example', address: 'x' })).toEqual({
      kind: 'takeover',
      host: 'fms.example',
    });
    expect(webhookAction({ state: 'none', host: null, address: 'x' })).toEqual({
      kind: 'subscribe',
    });
  });
});

describe('summarizeWebhookBody', () => {
  const wrap = (field: string, value: unknown): string =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field, value }] }],
    });

  it('статуси, повідомлення, шаблон, акаунт, невідоме, порожнє, не JSON', () => {
    expect(
      summarizeWebhookBody(
        wrap('messages', { statuses: [{ status: 'delivered' }, { status: 'read' }] }),
      ),
    ).toBe('status delivered, status read');
    expect(
      summarizeWebhookBody(
        wrap('messages', { messages: [{ type: 'text' }, { type: 'reaction' }] }),
      ),
    ).toBe('message text, message reaction');
    expect(
      summarizeWebhookBody(wrap('message_template_status_update', { event: 'APPROVED' })),
    ).toBe('template_status APPROVED');
    expect(summarizeWebhookBody(wrap('account_update', { event: 'PHONE_NUMBER_ADDED' }))).toBe(
      'account PHONE_NUMBER_ADDED',
    );
    expect(summarizeWebhookBody(wrap('flows', {}))).toBe('flows');
    expect(summarizeWebhookBody(wrap('messages', {}))).toBe('empty');
    expect(summarizeWebhookBody('{"hello":1}')).toBe('unknown payload');
    expect(summarizeWebhookBody('<<>>')).toBe('not JSON');
  });
});

describe('тексти повідомлень із payload', () => {
  const t = (key: string, options: Record<string, string>): string =>
    `${key}:${JSON.stringify(options)}`;

  it('шаблон — з payload.template; без нього null', () => {
    expect(
      templateText({ payload: { template: { name: 'hello_world', language: 'en_US' } } }, t),
    ).toBe('template.bubble:{"name":"hello_world","language":"en_US"}');
    expect(templateText({ payload: {} }, t)).toBeNull();
    expect(templateText({}, t)).toBeNull();
  });

  it('непідтримуваний тип — з payload.unsupported; без нього null', () => {
    expect(unsupportedText({ payload: { unsupported: { type: 'image' } } }, t)).toBe(
      'message.unsupported:{"type":"image"}',
    );
    expect(unsupportedText({ payload: { unsupported: {} } }, t)).toBeNull();
    expect(unsupportedText({ payload: null }, t)).toBeNull();
  });

  it('реакція — з емодзі; знята реакція — окремий текст, а не «не підтримується»', () => {
    const reaction = { unsupported: { type: 'reaction' } };
    expect(unsupportedText({ payload: { ...reaction, reaction: { emoji: '👍' } } }, t)).toBe(
      'message.reaction:{"emoji":"👍"}',
    );
    expect(unsupportedText({ payload: { ...reaction, reaction: { emoji: null } } }, t)).toBe(
      'message.reactionRemoved:{}',
    );
  });
});
