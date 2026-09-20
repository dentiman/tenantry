import { describe, expect, it, vi } from 'vitest';
import { AiCancelChannel, FakeLlmProvider, FAKE_LLM_DIRECTIVES, type AiConfig } from '@saas-skeleton/shared';
import type { AiMessageCompleted, AiMessageDelta } from '@saas-skeleton/contracts';
import { AiGenerateReplySubscriber } from './ai-generate-reply.subscriber';

/**
 * Життєвий цикл генерації відповіді — без БД, без брокера, без мережі.
 * Prisma і realtime підмінені, а ось провайдер тут СПРАВЖНІЙ `FakeLlmProvider`:
 * саме його директиви (`__fail__`, `__stall__`, `__long__`) і роблять важкі гілки
 * досяжними з тесту.
 */

const TENANT = '7c9e6a54-2b3d-4f18-9a77-1e5c8d0b6a32';
const USER = '3f1b7c0e-9d4a-4b7e-8c21-5a6d2e4f9b10';
const CONVERSATION = '5b2f8a11-0c3e-4d6a-9f52-7a1b3c4d5e6f';
const REPLY = '9d4e2c88-1a5b-4f30-8e71-2c6d9f0a3b45';

type Status = 'PENDING' | 'STREAMING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';

/** Пошук, який падає зрозуміло, а не мовчазним `!` чи `as` */
function requireRow(rows: MessageRow[], id: string): MessageRow {
  const row = rows.find((m) => m.id === id);
  if (!row) {
    throw new Error(`Test fixture has no message ${id}`);
  }
  return row;
}

interface MessageRow {
  id: string;
  tenantId: string;
  conversationId: string;
  seq: number;
  role: 'USER' | 'ASSISTANT';
  status: Status;
  content: string;
  errorCode: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  model: string | null;
}

interface World {
  messages: MessageRow[];
  conversation: { id: string; tenantId: string; userId: string; lastMessageAt: Date | null };
  transactions: { withTenantTx: <T>(fn: (t: unknown) => Promise<T>) => Promise<T>; onCommit: (t: unknown, hook: () => void) => void };
  realtime: {
    aiDelta: (tenantId: string, userId: string, payload: AiMessageDelta) => void;
    aiCompleted: (tenantId: string, userId: string, payload: AiMessageCompleted) => void;
  };
  deltas: AiMessageDelta[];
  completed: AiMessageCompleted[];
  reply: () => MessageRow;
}

function makeWorld(
  replyStatus: Status = 'PENDING',
  question = 'How do I rename the workspace?',
): World {
  const messages: MessageRow[] = [
    {
      id: 'question-1', tenantId: TENANT, conversationId: CONVERSATION, seq: 0,
      role: 'USER', status: 'COMPLETE', content: question,
      errorCode: null, startedAt: null, completedAt: null, model: null,
    },
    {
      id: REPLY, tenantId: TENANT, conversationId: CONVERSATION, seq: 1,
      role: 'ASSISTANT', status: replyStatus, content: '',
      errorCode: null, startedAt: null, completedAt: null, model: null,
    },
  ];
  const conversation = { id: CONVERSATION, tenantId: TENANT, userId: USER, lastMessageAt: null as Date | null };

  const tx = {
    aiMessage: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> => {
        const row = messages.find((m) => m.id === where.id);
        return Promise.resolve(row ? { ...row, conversation } : null);
      },
      findFirst: ({ where }: { where: { seq: number; role: string } }): Promise<unknown> =>
        Promise.resolve(messages.find((m) => m.seq === where.seq && m.role === where.role) ?? null),
      findMany: ({ where }: { where: { seq: { lt: number }; status: string } }): Promise<unknown> =>
        Promise.resolve(
          messages
            .filter((m) => m.seq < where.seq.lt && m.status === where.status)
            .sort((a, b) => b.seq - a.seq),
        ),
      update: ({ where, data }: { where: { id: string }; data: Partial<MessageRow> }): Promise<unknown> => {
        const row = requireRow(messages, where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    },
    aiConversation: {
      update: ({ data }: { data: { lastMessageAt: Date } }): Promise<unknown> => {
        conversation.lastMessageAt = data.lastMessageAt;
        return Promise.resolve(conversation);
      },
    },
    user: {
      findUnique: (): Promise<unknown> => Promise.resolve({ role: 'USER', locale: 'en' }),
    },
  };

  let hooks: (() => void | Promise<void>)[] = [];
  const transactions = {
    withTenantTx: async <T,>(fn: (t: unknown) => Promise<T>): Promise<T> => {
      const own: (() => void | Promise<void>)[] = [];
      hooks = own;
      const result = await fn(tx);
      // Хуки біжать ТІЛЬКИ після успішного fn — як у справжньому withTenantTx
      for (const hook of own) {
        await hook();
      }
      return result;
    },
    onCommit: (_t: unknown, hook: () => void): void => {
      hooks.push(hook);
    },
  };

  const deltas: AiMessageDelta[] = [];
  const completed: AiMessageCompleted[] = [];
  const realtime = {
    aiDelta: (_t: string, _u: string, payload: AiMessageDelta): void => {
      deltas.push(payload);
    },
    aiCompleted: (_t: string, _u: string, payload: AiMessageCompleted): void => {
      completed.push(payload);
    },
  };

  const reply = (): MessageRow => requireRow(messages, REPLY);
  return { messages, conversation, transactions, realtime, deltas, completed, reply };
}

function makeSubscriber(
  world: World,
  overrides: Partial<AiConfig> = {},
  cancel: Partial<AiCancelChannel> = {},
): AiGenerateReplySubscriber {
  const config: AiConfig = {
    enabled: true, provider: 'fake', maxOutputTokens: 256, historyTurns: 10,
    requestTimeoutMs: 60_000, streamFlushMs: 10, partialPersistMs: 2_000, model: 'fake-1', ...overrides,
  };
  const cancelChannel = {
    onCancel: () => Promise.resolve(() => undefined),
    requestCancel: () => Promise.resolve(),
    ...cancel,
  } as unknown as AiCancelChannel;

  return new AiGenerateReplySubscriber(
    {} as never,
    world.transactions as never,
    world.realtime as never,
    cancelChannel,
    new FakeLlmProvider({ chunkDelayMs: 1, chunkChars: 12 }),
    config,
  );
}

const job = { conversationId: CONVERSATION, messageId: REPLY };

describe('AiGenerateReplySubscriber', () => {
  it('щаслива гілка: COMPLETE, дельти впорядковані, їх конкатенація = збережений текст', async () => {
    const world = makeWorld();
    await makeSubscriber(world).handle(job);

    expect(world.reply().status).toBe('COMPLETE');
    expect(world.reply().content.length).toBeGreaterThan(0);
    expect(world.reply().model).toBe('fake-1');

    // chunkSeq монотонний і починається з 0 — на цьому тримається детектор дірок
    expect(world.deltas.map((d) => d.chunkSeq)).toEqual(
      world.deltas.map((_, index) => index),
    );
    expect(world.deltas.map((d) => d.text).join('')).toBe(world.reply().content);
  });

  it('коалесує: кадрів провайдера більше, ніж дельт у сокеті', async () => {
    const world = makeWorld();
    await makeSubscriber(world, { streamFlushMs: 50 }).handle(job);

    const providerFrames = Math.ceil(world.reply().content.length / 12);
    expect(world.deltas.length).toBeLessThan(providerFrames);
  });

  it('completed емітиться РІВНО раз і вже після запису фінального тексту', async () => {
    const world = makeWorld();
    let contentWhenEmitted: string | null = null;
    world.realtime.aiCompleted = (_t, _u, payload): void => {
      contentWhenEmitted = world.reply().content;
      world.completed.push(payload);
    };

    await makeSubscriber(world).handle(job);

    expect(world.completed).toHaveLength(1);
    expect(world.completed[0]?.status).toBe('COMPLETE');
    expect(contentWhenEmitted).toBe(world.reply().content);
  });

  it(`${FAKE_LLM_DIRECTIVES.fail}: FAILED / PROVIDER_UNAVAILABLE, розмова лишається робочою`, async () => {
    const world = makeWorld('PENDING', `help ${FAKE_LLM_DIRECTIVES.fail}`);
    await makeSubscriber(world).handle(job);

    expect(world.reply().status).toBe('FAILED');
    expect(world.reply().errorCode).toBe('PROVIDER_UNAVAILABLE');
    expect(world.completed[0]?.errorCode).toBe('PROVIDER_UNAVAILABLE');
  });

  it(`${FAKE_LLM_DIRECTIVES.stall}: перевищення часу дає FAILED / TIMEOUT`, async () => {
    const world = makeWorld('PENDING', `help ${FAKE_LLM_DIRECTIVES.stall}`);
    await makeSubscriber(world, { requestTimeoutMs: 30 }).handle(job);

    expect(world.reply().status).toBe('FAILED');
    expect(world.reply().errorCode).toBe('TIMEOUT');
  });

  it('скасування користувачем: CANCELLED, частковий текст ЗБЕРІГАЄТЬСЯ, це не помилка', async () => {
    const world = makeWorld('PENDING', `${FAKE_LLM_DIRECTIVES.long} tell me everything`);
    // Обʼєкт-тримач, а не `let`: присвоєння відбувається всередині колбека, і TS
    // цього не бачить — змінну він і далі вважав би `null`
    const cancel: { fire?: () => void } = {};
    const subscriber = makeSubscriber(world, {}, {
      onCancel: (_id: string, handler: () => void): Promise<() => void> => {
        cancel.fire = handler;
        return Promise.resolve(() => undefined);
      },
    });

    const running = subscriber.handle(job);
    // Даємо стріму почати, потім тиснемо Stop
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(cancel.fire).toBeDefined();
    cancel.fire?.();
    await running;

    expect(world.reply().status).toBe('CANCELLED');
    expect(world.reply().errorCode).toBeNull();
    expect(world.reply().content.length).toBeGreaterThan(0);
    expect(world.completed[0]?.status).toBe('CANCELLED');
  });

  it('частковий текст пишеться ПІД ЧАС генерації, а не лише в кінці', async () => {
    const world = makeWorld('PENDING', `${FAKE_LLM_DIRECTIVES.long} tell me everything`);
    // Знімки вмісту в момент кожного проміжного запису
    const snapshots: string[] = [];
    const original = world.transactions.withTenantTx;
    world.transactions.withTenantTx = async <T,>(fn: (t: unknown) => Promise<T>): Promise<T> => {
      const result = await original(fn);
      snapshots.push(world.reply().content);
      return result;
    };

    await makeSubscriber(world, { partialPersistMs: 5 }).handle(job);

    // Більше ніж дві транзакції (prepare + finalize) означає, що проміжні були,
    // і текст у них ріс, а не зʼявився цілком в останній
    expect(snapshots.length).toBeGreaterThan(2);
    const middle = snapshots[Math.floor(snapshots.length / 2)] ?? '';
    expect(middle.length).toBeGreaterThan(0);
    expect(middle.length).toBeLessThan(world.reply().content.length);
  });

  it('уже COMPLETE не перегенеровується (ідемпотентність по статусу рядка)', async () => {
    const world = makeWorld('COMPLETE');
    world.reply().content = 'already answered';

    await makeSubscriber(world).handle(job);

    expect(world.reply().content).toBe('already answered');
    expect(world.deltas).toHaveLength(0);
    expect(world.completed).toHaveLength(0);
  });

  it('ретрай скидає накопичений текст і шле chunkSeq 0 — дві спроби не склеюються', async () => {
    const world = makeWorld('STREAMING');
    // Слід попередньої, обірваної спроби
    world.reply().content = 'LEFTOVER FROM THE FIRST ATTEMPT';

    await makeSubscriber(world).handle(job);

    expect(world.reply().content).not.toContain('LEFTOVER');
    expect(world.deltas[0]?.chunkSeq).toBe(0);
    expect(world.deltas.map((d) => d.text).join('')).toBe(world.reply().content);
  });

  it('зниклий рядок відповіді — тихий вихід, а не падіння', async () => {
    const world = makeWorld();
    const subscriber = makeSubscriber(world);
    // eslint-disable-next-line @typescript-eslint/dot-notation -- logger приватний, і саме його мовчання тут і перевіряємо
    const warn = vi.spyOn(subscriber['logger'], 'warn').mockImplementation(() => undefined);

    await expect(subscriber.handle({ ...job, messageId: 'no-such-id' })).resolves.toBeUndefined();
    expect(world.deltas).toHaveLength(0);
    warn.mockRestore();
  });
});
