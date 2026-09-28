import { describe, expect, it, vi } from 'vitest';
import {
  AiCancelChannel,
  AiMessageStateService,
  AiUsageQuotaService,
  ASSISTANT_BOUNDARIES,
  FakeLlmProvider,
  FAKE_LLM_DIRECTIVES,
  LlmProviderError,
  StaticKnowledgeSource,
  buildKnowledgeCorpus,
  serializeKnowledgeCorpus,
  type AiConfig,
  type KnowledgeSource,
  type LlmProvider,
  type LlmChunk,
  type LlmRequest,
} from '@saas-skeleton/shared';
import type { AiMessageCompleted, AiMessageDelta } from '@saas-skeleton/contracts';
import { AiGenerateReplySubscriber } from './ai-generate-reply.subscriber';

/**
 * Життєвий цикл генерації відповіді — без справжнього Postgres, без брокера, без
 * мережі. Prisma підмінена мінімальним in-memory рушієм, що розуміє РІВНО ті
 * `where`/`data` форми, які реально шле `AiMessageStateService` (сама вона тут
 * СПРАВЖНЯ, не мокована — тестується фенсинг, а не його імітація). Провайдер —
 * СПРАВЖНІЙ `FakeLlmProvider`: саме його директиви (`__fail__`, `__fail_once__`,
 * `__reject__`, `__stall__`, `__long__`) роблять важкі гілки досяжними з тесту.
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
  attempt: number;
  leaseExpiresAt: Date | null;
  chunkCount: number;
  cancelRequestedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  model: string | null;
  // ai-1a: у фікстурах не задаються — зʼявляються з першим записом state-сервісу
  promptTokens?: number | null;
  completionTokens?: number | null;
  // ai-1d: так само
  cachedPromptTokens?: number | null;
  // ai-1b: так само зʼявляється з першим claim()
  knowledgeVersion?: string | null;
}

// ---------------------------------------------------------------------------
// Мінімальний матчер `where`/`data`, достатній для форм запитів, які реально
// будує AiMessageStateService (design.md D1/D2/D4): плоска рівність, `null`,
// `{lt: Date}}`, `{in: [...]}}`, і рекурсивні `OR`/`AND`.
// ---------------------------------------------------------------------------

function matchesWhere(row: MessageRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      return (condition as Record<string, unknown>[]).some((c) => matchesWhere(row, c));
    }
    if (key === 'AND') {
      return (condition as Record<string, unknown>[]).every((c) => matchesWhere(row, c));
    }
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const cond = condition as Record<string, unknown>;
      if ('lt' in cond) {
        return actual != null && (actual as Date).getTime() < (cond.lt as Date).getTime();
      }
      if ('in' in cond) {
        return (cond.in as unknown[]).includes(actual);
      }
      throw new Error(`Unsupported where operator on '${key}': ${JSON.stringify(cond)}`);
    }
    return actual === condition;
  });
}

function applyUpdateData(row: MessageRow, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !(value instanceof Date) &&
      'increment' in (value as Record<string, unknown>)
    ) {
      const current = (row as unknown as Record<string, number>)[key] ?? 0;
      (row as unknown as Record<string, unknown>)[key] =
        current + (value as { increment: number }).increment;
    } else {
      (row as unknown as Record<string, unknown>)[key] = value;
    }
  }
}

interface UsageCounterRow {
  tenantId: string;
  userId: string;
  periodStart: Date;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
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
  /** ai-1d: рядки ai_usage_counters, які реально написав deduct() (design.md D4) */
  usageCounters: UsageCounterRow[];
}

/** Попередній хід розмови, доданий ПЕРЕД поточним питанням/відповіддю */
interface PriorTurn {
  readonly questionContent: string;
  readonly answerStatus: Status;
  readonly answerContent: string;
}

function makeWorld(
  replyStatus: Status = 'PENDING',
  question = 'How do I rename the workspace?',
  priorTurns: readonly PriorTurn[] = [],
  replyOverrides: Partial<Pick<MessageRow, 'attempt' | 'leaseExpiresAt' | 'content'>> = {},
  userRole: 'ADMIN' | 'USER' = 'USER',
  // ai-1c: вміст `tenants.settings` (JSON) — `{}` означає «тенант нічого не задавав»
  tenantSettings: unknown = {},
): World {
  const prior: MessageRow[] = priorTurns.flatMap((turn, index) => [
    {
      id: `prior-question-${String(index)}`, tenantId: TENANT, conversationId: CONVERSATION, seq: index * 2,
      role: 'USER' as const, status: 'COMPLETE' as const, content: turn.questionContent,
      errorCode: null, attempt: 0, leaseExpiresAt: null, chunkCount: 0, cancelRequestedAt: null,
      startedAt: null, completedAt: null, model: null,
    },
    {
      id: `prior-answer-${String(index)}`, tenantId: TENANT, conversationId: CONVERSATION, seq: index * 2 + 1,
      role: 'ASSISTANT' as const, status: turn.answerStatus, content: turn.answerContent,
      errorCode: null, attempt: 0, leaseExpiresAt: null, chunkCount: 0, cancelRequestedAt: null,
      startedAt: null, completedAt: null, model: null,
    },
  ]);
  const currentSeq = prior.length;
  const messages: MessageRow[] = [
    ...prior,
    {
      id: 'question-1', tenantId: TENANT, conversationId: CONVERSATION, seq: currentSeq,
      role: 'USER', status: 'COMPLETE', content: question,
      errorCode: null, attempt: 0, leaseExpiresAt: null, chunkCount: 0, cancelRequestedAt: null,
      startedAt: null, completedAt: null, model: null,
    },
    {
      id: REPLY, tenantId: TENANT, conversationId: CONVERSATION, seq: currentSeq + 1,
      role: 'ASSISTANT', status: replyStatus, content: replyOverrides.content ?? '',
      errorCode: null,
      attempt: replyOverrides.attempt ?? 0,
      leaseExpiresAt: replyOverrides.leaseExpiresAt ?? null,
      chunkCount: 0, cancelRequestedAt: null,
      startedAt: null, completedAt: null, model: null,
    },
  ];
  const conversation = { id: CONVERSATION, tenantId: TENANT, userId: USER, lastMessageAt: null as Date | null };
  const usageCounters: UsageCounterRow[] = [];

  const tx = {
    // AiUsageQuotaService.deduct() (ai-1d, design.md D4) — єдиний $executeRaw цього
    // шляху, точнісінько ті самі позиційні значення, що й реальний INSERT ... ON
    // CONFLICT: id, tenantId, userId, periodStart, promptTokens, cachedPromptTokens,
    // completionTokens
    $executeRaw: (
      _strings: TemplateStringsArray,
      _id: string,
      tenantId: string,
      userId: string,
      periodStart: Date,
      promptTokens: number,
      cachedPromptTokens: number,
      completionTokens: number,
    ): Promise<number> => {
      const existing = usageCounters.find(
        (c) =>
          c.tenantId === tenantId && c.userId === userId && c.periodStart.getTime() === periodStart.getTime(),
      );
      if (existing) {
        existing.promptTokens += promptTokens;
        existing.cachedPromptTokens += cachedPromptTokens;
        existing.completionTokens += completionTokens;
      } else {
        usageCounters.push({ tenantId, userId, periodStart, promptTokens, cachedPromptTokens, completionTokens });
      }
      return Promise.resolve(1);
    },
    aiMessage: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> => {
        const row = messages.find((m) => m.id === where.id);
        return Promise.resolve(row ? { ...row, conversation } : null);
      },
      findUniqueOrThrow: ({ where }: { where: { id: string } }): Promise<unknown> => {
        const row = requireRow(messages, where.id);
        return Promise.resolve({ ...row, conversation: { userId: conversation.userId } });
      },
      findFirst: ({ where }: { where: { seq: number; role: string } }): Promise<unknown> =>
        Promise.resolve(messages.find((m) => m.seq === where.seq && m.role === where.role) ?? null),
      findMany: ({ where }: { where: { seq: { lt: number } } }): Promise<unknown> =>
        Promise.resolve(
          messages
            .filter((m) => m.seq < where.seq.lt)
            .sort((a, b) => b.seq - a.seq),
        ),
      updateMany: (
        { where, data }: { where: Record<string, unknown>; data: Record<string, unknown> },
      ): Promise<{ count: number }> => {
        const matched = messages.filter((m) => matchesWhere(m, where));
        for (const row of matched) {
          applyUpdateData(row, data);
        }
        return Promise.resolve({ count: matched.length });
      },
    },
    aiConversation: {
      update: ({ data }: { data: { lastMessageAt: Date } }): Promise<unknown> => {
        conversation.lastMessageAt = data.lastMessageAt;
        return Promise.resolve(conversation);
      },
    },
    user: {
      findUnique: (): Promise<unknown> => Promise.resolve({ role: userRole, locale: 'en' }),
    },
    tenant: {
      // Лише рядок СВОГО тенанта — так, як його бачить RLS у справжньому withTenantTx
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> =>
        Promise.resolve(where.id === TENANT ? { settings: tenantSettings } : null),
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
  return { messages, conversation, transactions, realtime, deltas, completed, reply, usageCounters };
}

/** Обгортка над справжнім `FakeLlmProvider`, яка запам'ятовує кожен надісланий запит —
 *  дає тестам порахувати виклики провайдера й заглянути в `LlmRequest` */
function capturingProvider(delegate = new FakeLlmProvider({ chunkDelayMs: 1, chunkChars: 12 })): {
  provider: LlmProvider;
  requests: LlmRequest[];
} {
  const requests: LlmRequest[] = [];
  return {
    requests,
    provider: {
      generate(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
        requests.push(request);
        return delegate.generate(request, signal);
      },
    },
  };
}

/** Маленький корпус із документом адміна — щоб фільтр `audience` було видно в промпті (ai-1b) */
const TEST_KNOWLEDGE = JSON.parse(
  serializeKnowledgeCorpus(
    buildKnowledgeCorpus([
      {
        name: '00-everyone.md',
        text: '---\nslug: everyone\ntitle: Everyone doc\naudience: all\narea: general\n---\nPublic knowledge body\n',
      },
      {
        name: '01-admins.md',
        text: '---\nslug: admins\ntitle: Admin doc\naudience: admin\narea: settings\n---\nAdmin knowledge body\n',
      },
    ]),
  ),
) as { version: string };

function makeSubscriber(
  world: World,
  overrides: Partial<AiConfig> = {},
  cancel: Partial<AiCancelChannel> = {},
  provider: LlmProvider = new FakeLlmProvider({ chunkDelayMs: 1, chunkChars: 12 }),
  knowledgeSource: KnowledgeSource = new StaticKnowledgeSource(TEST_KNOWLEDGE),
): AiGenerateReplySubscriber {
  const config: AiConfig = {
    enabled: true, provider: 'fake', maxOutputTokens: 256, historyTurns: 10,
    requestTimeoutMs: 60_000, streamFlushMs: 10, partialPersistMs: 2_000, model: 'fake-1',
    modelConfigured: false, baseUrl: null, apiKey: null,
    providerRetries: 1, retryDelayMs: 5, pendingTimeoutMs: 300_000, cancelCheckMs: 2_000,
    leaseMs: 90_000, quotaUserDailyTokens: 1_000_000, quotaTenantDailyTokens: 10_000_000,
    ...overrides,
  };
  const cancelChannel = {
    onCancel: () => Promise.resolve(() => undefined),
    requestCancel: () => Promise.resolve(),
    ...cancel,
  } as unknown as AiCancelChannel;

  return new AiGenerateReplySubscriber(
    world.transactions as never,
    new AiMessageStateService(),
    world.realtime as never,
    cancelChannel,
    provider,
    knowledgeSource,
    config,
    new AiUsageQuotaService(config),
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
    expect(world.reply().attempt).toBe(1); // одна успішна спроба — claim() з 0 у 1

    // chunkSeq монотонний і починається з 0 — на цьому тримається детектор дірок
    expect(world.deltas.map((d) => d.chunkSeq)).toEqual(
      world.deltas.map((_, index) => index),
    );
    // Усі дельти належать тій самій (єдиній) спробі
    expect(world.deltas.every((d) => d.attempt === 1)).toBe(true);
    expect(world.deltas.map((d) => d.text).join('')).toBe(world.reply().content);
    expect(world.reply().chunkCount).toBe(world.deltas.length);
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

  it(`${FAKE_LLM_DIRECTIVES.fail}: вичерпання ретраїв дає FAILED / PROVIDER_UNAVAILABLE, розмова лишається робочою`, async () => {
    const world = makeWorld('PENDING', `help ${FAKE_LLM_DIRECTIVES.fail}`);
    const { provider, requests } = capturingProvider();

    await makeSubscriber(world, { providerRetries: 1 }, {}, provider).handle(job);

    expect(world.reply().status).toBe('FAILED');
    expect(world.reply().errorCode).toBe('PROVIDER_UNAVAILABLE');
    expect(world.completed[0]?.errorCode).toBe('PROVIDER_UNAVAILABLE');
    // 1 початкова спроба + 1 ретрай = 2 звернення до провайдера (design.md D2)
    expect(requests).toHaveLength(2);
    expect(world.reply().attempt).toBe(2); // claim (0→1) + один restart (1→2)
  });

  it(`${FAKE_LLM_DIRECTIVES.stall}: перевищення часу дає FAILED / TIMEOUT, без ретраю`, async () => {
    const world = makeWorld('PENDING', `help ${FAKE_LLM_DIRECTIVES.stall}`);
    await makeSubscriber(world, { requestTimeoutMs: 30 }).handle(job);

    expect(world.reply().status).toBe('FAILED');
    expect(world.reply().errorCode).toBe('TIMEOUT');
    expect(world.reply().attempt).toBe(1); // жодного ретраю на timeout
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

  it('уже COMPLETE не перегенеровується (claim() не знаходить термінальний рядок)', async () => {
    const world = makeWorld('COMPLETE');
    world.reply().content = 'already answered';

    await makeSubscriber(world).handle(job);

    expect(world.reply().content).toBe('already answered');
    expect(world.deltas).toHaveLength(0);
    expect(world.completed).toHaveLength(0);
  });

  it('покинута STREAMING (прострочена/відсутня оренда) захоплюється заново — попередній текст скидається', async () => {
    // Слід попередньої, обірваної спроби: лишок без оренди — «покинутий» (design.md D3)
    const world = makeWorld('STREAMING', undefined, [], {
      attempt: 5,
      content: 'LEFTOVER FROM THE FIRST ATTEMPT',
    });

    await makeSubscriber(world).handle(job);

    expect(world.reply().content).not.toContain('LEFTOVER');
    expect(world.reply().attempt).toBe(6); // claim() бере наступний attempt
    expect(world.deltas[0]?.chunkSeq).toBe(0);
    expect(world.deltas.every((d) => d.attempt === 6)).toBe(true);
    expect(world.deltas.map((d) => d.text).join('')).toBe(world.reply().content);
  });

  it('STREAMING з ЖИВОЮ орендою — не захоплюється, провайдер не викликається', async () => {
    const world = makeWorld('STREAMING', undefined, [], {
      attempt: 2,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    const { provider, requests } = capturingProvider();

    await makeSubscriber(world, {}, {}, provider).handle(job);

    expect(requests).toHaveLength(0);
    expect(world.reply().attempt).toBe(2); // не зачепили
    expect(world.deltas).toHaveLength(0);
    expect(world.completed).toHaveLength(0);
  });

  it('дві конкурентні доставки ОДНІЄЇ роботи: провайдер викликається РІВНО раз', async () => {
    const world = makeWorld('PENDING');
    const { provider, requests } = capturingProvider();
    const subscriber = makeSubscriber(world, {}, {}, provider);

    await Promise.all([subscriber.handle(job), subscriber.handle(job)]);

    expect(requests).toHaveLength(1);
    expect(world.reply().status).toBe('COMPLETE');
    expect(world.completed).toHaveLength(1);
  });

  it(`${FAKE_LLM_DIRECTIVES.failOnce}: один ретрай усередині доставки, друга спроба завершується COMPLETE`, async () => {
    const world = makeWorld('PENDING', `please ${FAKE_LLM_DIRECTIVES.failOnce}`);
    const { provider, requests } = capturingProvider();

    await makeSubscriber(world, { providerRetries: 1 }, {}, provider).handle(job);

    expect(world.reply().status).toBe('COMPLETE');
    expect(requests).toHaveLength(2); // 1 невдала + 1 успішна
    expect(world.reply().attempt).toBe(2); // claim (0→1) + restart (1→2)
    // Усі дельти належать ДРУГІЙ (успішній) спробі, з chunkSeq 0 — перша нічого не встигла надіслати
    expect(world.deltas.every((d) => d.attempt === 2)).toBe(true);
    expect(world.deltas[0]?.chunkSeq).toBe(0);
    expect(world.deltas.map((d) => d.text).join('')).toBe(world.reply().content);
  });

  it(`${FAKE_LLM_DIRECTIVES.reject}: НЕ ретрай-придатна помилка — одразу FAILED, лише ОДИН виклик`, async () => {
    const world = makeWorld('PENDING', `please ${FAKE_LLM_DIRECTIVES.reject}`);
    const { provider, requests } = capturingProvider();

    await makeSubscriber(world, { providerRetries: 3 }, {}, provider).handle(job);

    expect(world.reply().status).toBe('FAILED');
    expect(world.reply().errorCode).toBe('PROVIDER_UNAVAILABLE');
    expect(requests).toHaveLength(1); // бюджет був, але помилка non-retryable
  });

  it('Stop під час паузи перед ретраєм зупиняє генерацію: CANCELLED, без другої спроби', async () => {
    const world = makeWorld('PENDING', `help ${FAKE_LLM_DIRECTIVES.fail}`);
    const cancel: { fire?: () => void } = {};
    const { provider, requests } = capturingProvider();
    const subscriber = makeSubscriber(
      world,
      { providerRetries: 3, retryDelayMs: 200 },
      {
        onCancel: (_id: string, handler: () => void): Promise<() => void> => {
          cancel.fire = handler;
          return Promise.resolve(() => undefined);
        },
      },
      provider,
    );

    const running = subscriber.handle(job);
    // Даємо першому виклику провайдера впасти і зайти в паузу перед ретраєм
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cancel.fire).toBeDefined();
    cancel.fire?.();
    await running;

    expect(world.reply().status).toBe('CANCELLED');
    expect(requests).toHaveLength(1); // ретраю не було — Stop важливіший
  });

  it('Stop через ТІЛЬКИ маркер у БД (pub/sub ніколи не спрацьовує): CANCELLED протягом cancelCheckMs', async () => {
    const world = makeWorld('PENDING', `help ${FAKE_LLM_DIRECTIVES.stall}`);
    const subscriber = makeSubscriber(world, { cancelCheckMs: 15, requestTimeoutMs: 5_000 });

    const running = subscriber.handle(job);
    await new Promise((resolve) => setTimeout(resolve, 20));
    world.reply().cancelRequestedAt = new Date(); // сигнал ТІЛЬКИ в БД, onCancel не викликано

    await running;

    expect(world.reply().status).toBe('CANCELLED');
  });

  it('маркер Stop, виставлений ДО підписки воркера, ловиться одразу після неї', async () => {
    const world = makeWorld('PENDING', `help ${FAKE_LLM_DIRECTIVES.stall}`);
    // Оренда/маркер уже стоїть до виклику handle() — гонка «Stop до onCancel»
    world.reply().cancelRequestedAt = new Date();
    // Величезний cancelCheckMs доводить, що спрацював САМЕ пост-підписковий чек,
    // а не періодичний таймер
    const subscriber = makeSubscriber(world, { cancelCheckMs: 10_000, requestTimeoutMs: 5_000 });

    const started = Date.now();
    await subscriber.handle(job);

    expect(world.reply().status).toBe('CANCELLED');
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('втрата власності під час стріму: жодної фіналізації, дельти чужої спроби не дописуються', async () => {
    const world = makeWorld('PENDING', `${FAKE_LLM_DIRECTIVES.long} keep going`);
    let bumped = false;
    const originalAiDelta = world.realtime.aiDelta;
    world.realtime.aiDelta = (t, u, payload): void => {
      originalAiDelta(t, u, payload);
      if (!bumped) {
        // Симулюємо, що ІНША спроба щойно перезахопила рядок конкурентно
        bumped = true;
        world.reply().attempt += 1;
      }
    };

    // partialPersistMs: 0 — кожен наступний кадр одразу пробує проміжний запис
    // і миттєво виявляє фенсинг-розбіжність
    await makeSubscriber(world, { partialPersistMs: 0 }).handle(job);

    expect(world.completed).toHaveLength(0); // МОВЧКИ, без completed
    // Рядок лишився в стані, який поставила зовнішня "інша спроба" (STREAMING,
    // не FAILED/COMPLETE/CANCELLED) — наша втрачена спроба його не термінувала
    expect(world.reply().status).toBe('STREAMING');
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

  it('перше питання розмови надсилається моделі РІВНО РАЗ і без історії (review п.2)', async () => {
    const world = makeWorld('PENDING', 'How do I rename the workspace?');
    const { provider, requests } = capturingProvider();

    await makeSubscriber(world, {}, {}, provider).handle(job);

    expect(requests).toHaveLength(1);
    const userMessages = requests[0]?.messages.filter((m) => m.role === 'user') ?? [];
    expect(userMessages).toEqual([{ role: 'user', content: 'How do I rename the workspace?' }]);
  });

  it('провалений попередній хід не потрапляє в історію, поточне питання лишається останнім і єдиним', async () => {
    const world = makeWorld('PENDING', 'And what about the logo?', [
      { questionContent: 'How do I rename the workspace?', answerStatus: 'FAILED', answerContent: 'partial' },
    ]);
    const { provider, requests } = capturingProvider();

    await makeSubscriber(world, {}, {}, provider).handle(job);

    const userMessages = requests[0]?.messages.filter((m) => m.role === 'user') ?? [];
    // Провалений хід відсутній ЦІЛКОМ — жодного сліду ні його питання, ні його "partial"
    expect(userMessages).toEqual([{ role: 'user', content: 'And what about the logo?' }]);
    expect(requests[0]?.messages.some((m) => m.content.includes('partial'))).toBe(false);
  });

  it('завершений попередній хід потрапляє в історію один раз, поточне питання — останнє й теж один раз', async () => {
    const world = makeWorld('PENDING', 'And what about the logo?', [
      { questionContent: 'How do I rename the workspace?', answerStatus: 'COMPLETE', answerContent: 'Use Settings.' },
    ]);
    const { provider, requests } = capturingProvider();

    await makeSubscriber(world, {}, {}, provider).handle(job);

    const relevant = requests[0]?.messages.filter(
      (m) => m.role === 'user' || m.content === 'Use Settings.',
    );
    expect(relevant).toEqual([
      { role: 'user', content: 'How do I rename the workspace?' },
      { role: 'assistant', content: 'Use Settings.' },
      { role: 'user', content: 'And what about the logo?' },
    ]);
  });

  // ------------------------------------------------------------ ai-1a: облік токенів

  it('ai-1a: фейкова відповідь зберігає ненульовий usage і налаштовану модель (design.md D7/D8)', async () => {
    const world = makeWorld();
    await makeSubscriber(world).handle(job);

    expect(world.reply().status).toBe('COMPLETE');
    expect(world.reply().promptTokens).toBeGreaterThan(0);
    expect(world.reply().completionTokens).toBeGreaterThan(0);
    expect(world.reply().model).toBe('fake-1');
  });

  it('ai-1a: модель, яку назвав бекенд, перезаписує налаштовану', async () => {
    const world = makeWorld();
    const provider = scriptedProvider([
      [{ text: 'Hello' }, { text: '', usage: { promptTokens: 12, completionTokens: 3, model: 'vendor/model-real' } }],
    ]);
    await makeSubscriber(world, { model: 'vendor/model' }, {}, provider.provider).handle(job);

    expect(world.reply().content).toBe('Hello');
    expect(world.reply().promptTokens).toBe(12);
    expect(world.reply().completionTokens).toBe(3);
    expect(world.reply().model).toBe('vendor/model-real');
  });

  it('ai-1a: після ретраю зберігається usage СПРОБИ, ЩО ЗАВЕРШИЛАСЬ, а не сума чи перша', async () => {
    const world = makeWorld();
    const provider = scriptedProvider([
      [
        { text: 'partial ' },
        { text: '', usage: { promptTokens: 999, completionTokens: 999 } },
        new LlmProviderError('cut', { retryable: true }),
      ],
      [{ text: 'final' }, { text: '', usage: { promptTokens: 10, completionTokens: 5 } }],
    ]);
    await makeSubscriber(world, { providerRetries: 1 }, {}, provider.provider).handle(job);

    expect(provider.calls()).toBe(2);
    expect(world.reply().status).toBe('COMPLETE');
    expect(world.reply().content).toBe('final');
    expect(world.reply().promptTokens).toBe(10);
    expect(world.reply().completionTokens).toBe(5);
  });

  it('ai-1a: зупинена відповідь без usage лишає токени порожніми, стан фіналізується як завжди', async () => {
    const world = makeWorld('PENDING', `${FAKE_LLM_DIRECTIVES.long} tell me everything`);
    const cancel: { fire?: () => void } = {};
    const subscriber = makeSubscriber(world, {}, {
      onCancel: (_id: string, handler: () => void): Promise<() => void> => {
        cancel.fire = handler;
        return Promise.resolve(() => undefined);
      },
    });
    const running = subscriber.handle(job);
    await new Promise((resolve) => setTimeout(resolve, 40));
    cancel.fire?.();
    await running;

    expect(world.reply().status).toBe('CANCELLED');
    expect(world.reply().promptTokens).toBeNull();
    expect(world.reply().completionTokens).toBeNull();
  });

  // ------------------------------------------------------------ ai-1a: Retry-After

  it('ai-1a: Retry-After у межах AI_RETRY_DELAY_MS — один ретрай, не раніше за попрошене, COMPLETE', async () => {
    const world = makeWorld();
    const provider = scriptedProvider([
      [new LlmProviderError('429', { retryable: true, retryAfterMs: 30 })],
      [{ text: 'ok' }, { text: '', usage: { promptTokens: 1, completionTokens: 1 } }],
    ]);
    await makeSubscriber(world, { providerRetries: 1, retryDelayMs: 40 }, {}, provider.provider).handle(job);

    expect(provider.calls()).toBe(2);
    expect(world.reply().status).toBe('COMPLETE');
    const [first, second] = provider.startedAt();
    expect((second ?? 0) - (first ?? 0)).toBeGreaterThanOrEqual(30);
  });

  it('ai-1a: Retry-After ДОВШИЙ за AI_RETRY_DELAY_MS — без ретраю, одразу FAILED / PROVIDER_UNAVAILABLE', async () => {
    const world = makeWorld();
    const provider = scriptedProvider([
      [new LlmProviderError('429', { retryable: true, retryAfterMs: 60_000 })],
      [{ text: 'never' }],
    ]);
    await makeSubscriber(world, { providerRetries: 3, retryDelayMs: 5 }, {}, provider.provider).handle(job);

    expect(provider.calls()).toBe(1);
    expect(world.reply().status).toBe('FAILED');
    expect(world.reply().errorCode).toBe('PROVIDER_UNAVAILABLE');
  });

  // ---------------------------------------------------------------- ai-1b знання

  function knowledgeMessage(request: LlmRequest | undefined): string {
    const message = request?.messages.find((m) => m.content.startsWith('Product documentation:'));
    return message?.content ?? '';
  }

  it('ai-1b: USER — у промпті корпус без документів адміна; у рядку версія знань', async () => {
    const world = makeWorld();
    const { provider, requests } = capturingProvider();
    await makeSubscriber(world, {}, {}, provider).handle(job);

    const knowledge = knowledgeMessage(requests[0]);
    expect(knowledge).toContain('Public knowledge body');
    expect(knowledge).not.toContain('Admin knowledge body');
    expect(world.reply().status).toBe('COMPLETE');
    expect(world.reply().knowledgeVersion).toBe(TEST_KNOWLEDGE.version);
  });

  it('ai-1b: ADMIN — документи адміна теж у промпті, версія та сама', async () => {
    const world = makeWorld('PENDING', 'How do I rename the workspace?', [], {}, 'ADMIN');
    const { provider, requests } = capturingProvider();
    await makeSubscriber(world, {}, {}, provider).handle(job);

    expect(knowledgeMessage(requests[0])).toContain('Admin knowledge body');
    expect(world.reply().knowledgeVersion).toBe(TEST_KNOWLEDGE.version);
  });

  it('ai-1b: знання стоять після інструкції й перед контекстом юзера, історією та питанням', async () => {
    const world = makeWorld('PENDING', 'current question', [
      { questionContent: 'earlier question', answerStatus: 'COMPLETE', answerContent: 'earlier answer' },
    ]);
    const { provider, requests } = capturingProvider();
    await makeSubscriber(world, {}, {}, provider).handle(job);

    const contents = (requests[0]?.messages ?? []).map((m) => m.content);
    const knowledgeAt = contents.findIndex((c) => c.startsWith('Product documentation:'));
    const userContextAt = contents.findIndex((c) => c.startsWith('User context:'));
    const historyAt = contents.indexOf('earlier question');
    expect(knowledgeAt).toBe(1);
    expect(userContextAt).toBeGreaterThan(knowledgeAt);
    expect(historyAt).toBeGreaterThan(userContextAt);
    expect(contents.at(-1)).toBe('current question');
  });

  it('ai-1b: перезапуск усередині доставки (__fail_once__) зберігає версію знань і той самий корпус', async () => {
    const world = makeWorld('PENDING', '__fail_once__ question');
    const { provider, requests } = capturingProvider();
    await makeSubscriber(world, {}, {}, provider).handle(job);

    expect(requests).toHaveLength(2);
    expect(knowledgeMessage(requests[1])).toBe(knowledgeMessage(requests[0]));
    expect(world.reply().status).toBe('COMPLETE');
    expect(world.reply().attempt).toBe(2);
    expect(world.reply().knowledgeVersion).toBe(TEST_KNOWLEDGE.version);
  });

  it('ai-1b: фейк і далі читає лише останнє питання — директиви працюють і з непорожнім корпусом', async () => {
    const world = makeWorld('PENDING', '__reject__');
    await makeSubscriber(world).handle(job);
    expect(world.reply().status).toBe('FAILED');
  });

  it('ai-1c: знання — одразу за межами (спільний префікс), персона тенанта — окреме повідомлення 2', async () => {
    const world = makeWorld('PENDING', 'current question', [], {}, 'USER', {
      calendar: { timeZone: 'UTC' },
      ai: { persona: 'You are Ava, the Acme helpdesk assistant.', instructions: 'Mention the helpdesk.' },
    });
    const { provider, requests } = capturingProvider();
    await makeSubscriber(world, {}, {}, provider).handle(job);

    const contents = (requests[0]?.messages ?? []).map((m) => m.content);
    expect(contents[0]).toBe(ASSISTANT_BOUNDARIES);
    expect(contents.findIndex((c) => c.startsWith('Product documentation:'))).toBe(1);
    expect(contents[2]).toContain('You are Ava, the Acme helpdesk assistant.');
    expect(contents[2]).toContain('Mention the helpdesk.');
    expect(contents.at(-1)).toBe('current question');
    expect(world.reply().status).toBe('COMPLETE');
  });

  it('ai-1c: тенант без settings.ai — промпт без блоку організації (стан до ai-1c)', async () => {
    const world = makeWorld('PENDING', 'current question', [], {}, 'USER', { calendar: {} });
    const { provider, requests } = capturingProvider();
    await makeSubscriber(world, {}, {}, provider).handle(job);

    const contents = (requests[0]?.messages ?? []).map((m) => m.content);
    expect(contents[0]).toBe(ASSISTANT_BOUNDARIES);
    expect(contents.some((c) => c.includes('<organization_instructions>'))).toBe(false);
    expect(contents.findIndex((c) => c.startsWith('Product documentation:'))).toBe(1);
  });

  it('ai-1c: зіпсована секція — відповідь усе одно COMPLETE, у промпті лише межі', async () => {
    const world = makeWorld('PENDING', 'current question', [], {}, 'USER', {
      ai: { persona: 42, instructions: 'x'.repeat(10_000) },
    });
    const { provider, requests } = capturingProvider();
    await makeSubscriber(world, {}, {}, provider).handle(job);

    const contents = (requests[0]?.messages ?? []).map((m) => m.content);
    expect(contents[0]).toBe(ASSISTANT_BOUNDARIES);
    expect(contents.some((c) => c.includes('<organization_instructions>'))).toBe(false);
    expect(world.reply().status).toBe('COMPLETE');
  });

  it('ai-1c: ретрай усередині доставки (__fail_once__) шле ТОЙ САМИЙ блок організації', async () => {
    const world = makeWorld('PENDING', FAKE_LLM_DIRECTIVES.failOnce, [], {}, 'USER', {
      ai: { persona: 'Ava', instructions: '' },
    });
    const { provider, requests } = capturingProvider();
    await makeSubscriber(world, {}, {}, provider).handle(job);

    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages[2]).toEqual(requests[0]?.messages[2]);
    expect(requests[0]?.messages[2]?.content).toContain('Persona: Ava');
    expect(world.reply().status).toBe('COMPLETE');
  });

  // ------------------------------------------------------------ ai-1d: квоти токенів

  it('ai-1d: cachedPromptTokens зберігається окремою колонкою (design.md D5)', async () => {
    const world = makeWorld();
    const provider = scriptedProvider([
      [{ text: 'ok' }, { text: '', usage: { promptTokens: 100, completionTokens: 10, cachedPromptTokens: 90 } }],
    ]);
    await makeSubscriber(world, {}, {}, provider.provider).handle(job);

    expect(world.reply().status).toBe('COMPLETE');
    expect(world.reply().promptTokens).toBe(100);
    expect(world.reply().completionTokens).toBe(10);
    expect(world.reply().cachedPromptTokens).toBe(90);
  });

  it('ai-1d: бекенд без розбивки кешу лишає cachedPromptTokens NULL, а не оцінкою', async () => {
    const world = makeWorld();
    const provider = scriptedProvider([
      [{ text: 'ok' }, { text: '', usage: { promptTokens: 100, completionTokens: 10 } }],
    ]);
    await makeSubscriber(world, {}, {}, provider.provider).handle(job);

    expect(world.reply().cachedPromptTokens).toBeNull();
  });

  it('ai-1d: завершений хід списує лічильник як promptTokens+completionTokens, cached НЕ додається зверху (design.md D5)', async () => {
    const world = makeWorld();
    const provider = scriptedProvider([
      [{ text: 'ok' }, { text: '', usage: { promptTokens: 100, completionTokens: 10, cachedPromptTokens: 90 } }],
    ]);
    await makeSubscriber(world, {}, {}, provider.provider).handle(job);

    expect(world.usageCounters).toHaveLength(1);
    const counter = world.usageCounters[0];
    expect(counter?.tenantId).toBe(TENANT);
    expect(counter?.userId).toBe(USER);
    expect(counter?.promptTokens).toBe(100);
    expect(counter?.completionTokens).toBe(10);
    expect(counter?.cachedPromptTokens).toBe(90);
  });

  it('ai-1d: два завершені ходи того самого юзера/періоду сумують, не перезаписують (design.md D4)', async () => {
    const world = makeWorld();
    const provider1 = scriptedProvider([
      [{ text: 'ok' }, { text: '', usage: { promptTokens: 100, completionTokens: 10 } }],
    ]);
    await makeSubscriber(world, {}, {}, provider1.provider).handle(job);

    // Другий хід тієї самої відповіді неможливий (COMPLETE не перегенеровується) —
    // тому перевіряємо накопичення інкрементом напряму через ще один claim/finalize
    // цикл на тому самому рядку, скинутому назад у PENDING (імітує другу відповідь
    // того самого юзера в тому самому періоді)
    const reply = world.reply();
    reply.status = 'PENDING';
    reply.attempt = 0;
    reply.content = '';
    const provider2 = scriptedProvider([
      [{ text: 'ok2' }, { text: '', usage: { promptTokens: 50, completionTokens: 5 } }],
    ]);
    await makeSubscriber(world, {}, {}, provider2.provider).handle(job);

    expect(world.usageCounters).toHaveLength(1);
    const counter = world.usageCounters[0];
    expect(counter?.promptTokens).toBe(150);
    expect(counter?.completionTokens).toBe(15);
  });

  it('ai-1d: FAILED після вичерпання ретраїв (без usage-кадру) не списує лічильник (design.md D6)', async () => {
    const world = makeWorld('PENDING', FAKE_LLM_DIRECTIVES.fail);
    await makeSubscriber(world, { providerRetries: 1, retryDelayMs: 1 }).handle(job);

    expect(world.reply().status).toBe('FAILED');
    expect(world.usageCounters).toHaveLength(0);
  });

  it('ai-1d: CANCELLED без usage не списує лічильник', async () => {
    const world = makeWorld('PENDING', `${FAKE_LLM_DIRECTIVES.long} tell me everything`);
    const cancel: { fire?: () => void } = {};
    const subscriber = makeSubscriber(world, {}, {
      onCancel: (_id: string, handler: () => void): Promise<() => void> => {
        cancel.fire = handler;
        return Promise.resolve(() => undefined);
      },
    });
    const running = subscriber.handle(job);
    await new Promise((resolve) => setTimeout(resolve, 40));
    cancel.fire?.();
    await running;

    expect(world.reply().status).toBe('CANCELLED');
    expect(world.usageCounters).toHaveLength(0);
  });
});

/**
 * Провайдер за сценарієм: i-й виклик віддає i-й список кадрів; `Error` у списку
 * кидається в тій позиції. Для гілок, яких фейк свідомо не вміє (usage посеред
 * спроби, Retry-After) — тестові директиви заради семантики заголовків не варті того
 */
function scriptedProvider(script: readonly (readonly (LlmChunk | Error)[])[]): {
  provider: LlmProvider;
  calls: () => number;
  startedAt: () => number[];
} {
  const started: number[] = [];
  return {
    calls: () => started.length,
    startedAt: () => started,
    provider: {
      async *generate(): AsyncIterable<LlmChunk> {
        const steps = script[started.length] ?? [];
        started.push(Date.now());
        for (const step of steps) {
          await Promise.resolve();
          if (step instanceof Error) {
            throw step;
          }
          yield step;
        }
      },
    },
  };
}
