import { describe, expect, it } from 'vitest';
import {
  ConnectMessagingAccountSchema,
  MessagingAccountResponseSchema,
  PostTemplateMessageSchema,
  StartConversationSchema,
  UpdateAccountCredentialsSchema,
  UpdateChannelSchema,
} from '@saas-skeleton/contracts';

// `libs/contracts` не має власного раннера — схеми CHAT-3a перевіряє цей файл
const TOKEN = 'EAAG' + 'x'.repeat(40);

describe('ConnectMessagingAccountSchema', () => {
  const valid = { provider: 'meta_cloud', wabaId: '1000000000001', accessToken: TOKEN } as const;

  it('приймає мінімальний набір і набір із парою app id + секрет', () => {
    expect(ConnectMessagingAccountSchema.safeParse(valid).success).toBe(true);
    expect(
      ConnectMessagingAccountSchema.safeParse({
        ...valid,
        appId: '555000111',
        appSecret: 'a'.repeat(32),
      }).success,
    ).toBe(true);
  });

  it('app id без секрету (і навпаки) — помилка на appSecret', () => {
    const lonelyId = ConnectMessagingAccountSchema.safeParse({ ...valid, appId: '555000111' });
    expect(lonelyId.success).toBe(false);
    expect(lonelyId.error?.issues[0]?.path).toEqual(['appSecret']);
    expect(
      ConnectMessagingAccountSchema.safeParse({ ...valid, appSecret: 'a'.repeat(32) }).success,
    ).toBe(false);
  });

  it('WABA id лише з цифр, токен не надто короткий, провайдер — лише meta_cloud', () => {
    expect(ConnectMessagingAccountSchema.safeParse({ ...valid, wabaId: 'abc' }).success).toBe(
      false,
    );
    expect(
      ConnectMessagingAccountSchema.safeParse({ ...valid, accessToken: 'short' }).success,
    ).toBe(false);
    expect(ConnectMessagingAccountSchema.safeParse({ ...valid, provider: 'fake' }).success).toBe(
      false,
    );
  });

  it('токен обрізається по краях (вставка з пробілом чи переносом)', () => {
    const parsed = ConnectMessagingAccountSchema.parse({ ...valid, accessToken: `  ${TOKEN}\n` });
    expect(parsed.accessToken).toBe(TOKEN);
  });
});

describe('UpdateAccountCredentialsSchema / UpdateChannelSchema', () => {
  it('оновлення токена не вимагає WABA id, але та сама пара app id + секрет', () => {
    expect(UpdateAccountCredentialsSchema.safeParse({ accessToken: TOKEN }).success).toBe(true);
    expect(
      UpdateAccountCredentialsSchema.safeParse({ accessToken: TOKEN, appId: '1' + '0'.repeat(8) })
        .success,
    ).toBe(false);
  });

  it('канал: потрібне хоча б одне поле', () => {
    expect(UpdateChannelSchema.safeParse({}).success).toBe(false);
    expect(UpdateChannelSchema.safeParse({ isEnabled: true }).success).toBe(true);
    expect(UpdateChannelSchema.safeParse({ isDefault: true, isEnabled: true }).success).toBe(true);
  });
});

describe('PostTemplateMessageSchema / StartConversationSchema', () => {
  const clientMessageId = '11111111-1111-4111-8111-111111111111';

  it('шаблон: ім’я малими літерами з підкресленням, мова як en або en_US', () => {
    expect(
      PostTemplateMessageSchema.safeParse({
        name: 'hello_world',
        language: 'en_US',
        clientMessageId,
      }).success,
    ).toBe(true);
    expect(
      PostTemplateMessageSchema.safeParse({ name: 'hello_world', language: 'uk', clientMessageId })
        .success,
    ).toBe(true);
    expect(
      PostTemplateMessageSchema.safeParse({
        name: 'Hello World',
        language: 'en_US',
        clientMessageId,
      }).success,
    ).toBe(false);
    expect(
      PostTemplateMessageSchema.safeParse({
        name: 'hello_world',
        language: 'english',
        clientMessageId,
      }).success,
    ).toBe(false);
  });

  it('початок розмови: канал і номер обов’язкові', () => {
    const channelId = '22222222-2222-4222-8222-222222222222';
    expect(StartConversationSchema.safeParse({ channelId, phone: '+380501234567' }).success).toBe(
      true,
    );
    expect(StartConversationSchema.safeParse({ channelId }).success).toBe(false);
    expect(StartConversationSchema.safeParse({ phone: '+380501234567' }).success).toBe(false);
  });
});

describe('MessagingAccountResponseSchema', () => {
  it('токен і секрет не є полями відповіді: лише маска, вид, строк і права', () => {
    const keys = Object.keys(MessagingAccountResponseSchema.shape);
    expect(keys).not.toContain('accessToken');
    expect(keys).not.toContain('credentials');
    expect(keys).not.toContain('appSecret');
    const token = MessagingAccountResponseSchema.shape.token.unwrap().shape;
    expect(Object.keys(token).sort()).toEqual([
      'checkedAt',
      'expiresAt',
      'kind',
      'mask',
      'scopes',
      'verified',
    ]);
  });
});
