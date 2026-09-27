import { Injectable } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';
import type { LlmUsage } from './llm/llm-provider';

/**
 * Усі переходи статусу відповіді асистента, для ОБОХ процесів (AI-0.1, design.md D1,
 * D3, D4, D8). Кожен перехід — умовний `updateMany`, і саме поруч ці `WHERE` роблять
 * переходи взаємно виключними без `$executeRaw` (CLAUDE.md rule 16) і без транзакції,
 * що тримається крізь виклик моделі (AI-0 §6.1).
 *
 * Сервіс НІЧОГО не емітить — це відповідальність викликача через `onCommit` тієї ж
 * транзакції (воркер: `ai.message-completed.v1`; API: `ai.conversation-changed.v1`).
 * Живе в `libs/shared`, а не в `apps/worker`, бо переходи АПІ (`cancelPending`,
 * `requestCancel`, `closeAbandoned`) і воркера (`claim`, `restart`, …) — одна умовна
 * модель, і тенантний e2e для API може ганяти гонки проти справжнього Postgres.
 */
@Injectable()
export class AiMessageStateService {
  /**
   * Захоплення власності генерації (design.md D1). Успіх, коли рядок `PENDING`,
   * АБО `STREAMING` з простроченою (чи відсутньою) орендою — «покинута» відповідь.
   * Нуль оновлених рядків = уже захоплено іншою спробою або рядок термінальний;
   * це НЕ помилка, викликач тихо виходить.
   */
  async claim(
    tx: Prisma.TransactionClient,
    messageId: string,
    conversationId: string,
    options: {
      readonly leaseMs: number;
      readonly model: string;
      /** Версія знань промпту цієї спроби (ai-1b, design.md D7) */
      readonly knowledgeVersion: string;
    },
  ): Promise<{
    readonly id: string;
    readonly tenantId: string;
    readonly conversationId: string;
    readonly userId: string;
    readonly seq: number;
    readonly attempt: number;
  } | null> {
    const now = new Date();
    const { count } = await tx.aiMessage.updateMany({
      where: {
        id: messageId,
        conversationId,
        OR: [
          { status: 'PENDING' },
          {
            status: 'STREAMING',
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
          },
        ],
      },
      data: {
        status: 'STREAMING',
        attempt: { increment: 1 },
        leaseExpiresAt: new Date(now.getTime() + options.leaseMs),
        content: '',
        chunkCount: 0,
        errorCode: null,
        startedAt: now,
        model: options.model,
        // Версія знань належить РІВНО тій спробі, що володіє рядком, — як і `model`:
        // перезахоплена покинута відповідь перепідготовлена з нуля і перезаписує її
        // тим, що справді надіслала (ai-1b, design.md D7). restart() промпт не змінює
        knowledgeVersion: options.knowledgeVersion,
        // Облік токенів — лише тієї спроби, що дала збережений текст (ai-1a, design.md D7):
        // перезахоплений рядок не має права зберегти числа попередньої
        promptTokens: null,
        completionTokens: null,
        // НАВМИСНО НЕ чіпаємо cancelRequestedAt: якщо Stop уже стояв на покинутій
        // (наприклад, впала попередня спроба) STREAMING-відповіді, нова спроба
        // мусить побачити його одразу на пост-підписковому чеку (design.md D4) —
        // скидання тут загубило б Stop без жодного шансу його повторити
      },
    });
    if (count === 0) {
      return null;
    }

    // Захоплення вдалось — читаємо щойно оновлений рядок за business-даними
    // (tenantId для RLS уже в контексті, userId потрібен для realtime-адресації)
    const reply = await tx.aiMessage.findUniqueOrThrow({
      where: { id: messageId },
      include: { conversation: { select: { userId: true } } },
    });
    return {
      id: reply.id,
      tenantId: reply.tenantId,
      conversationId: reply.conversationId,
      userId: reply.conversation.userId,
      seq: reply.seq,
      attempt: reply.attempt,
    };
  }

  /**
   * Перезапуск усередині ТІЄЇ Ж доставки після тимчасової відмови провайдера
   * (design.md D2). Фенсинг тим самим `attempt`, яким володіє викликач: програш —
   * ознака втраченої власності (інша спроба вже захопила рядок), і генерація
   * має мовчки зупинитись, а не почати новий стрім поверх чужого.
   */
  async restart(
    tx: Prisma.TransactionClient,
    messageId: string,
    ownedAttempt: number,
    options: { readonly leaseMs: number },
  ): Promise<{ readonly attempt: number } | null> {
    const now = new Date();
    const { count } = await tx.aiMessage.updateMany({
      where: { id: messageId, attempt: ownedAttempt, status: 'STREAMING' },
      data: {
        attempt: { increment: 1 },
        leaseExpiresAt: new Date(now.getTime() + options.leaseMs),
        content: '',
        chunkCount: 0,
        promptTokens: null,
        completionTokens: null,
      },
    });
    return count === 0 ? null : { attempt: ownedAttempt + 1 };
  }

  /**
   * Короткий самостійний запис поза генераційним потоком — саме це робить
   * правдивими «частковий вивід переживає обрив» і «reconnect посеред генерації».
   * Повертає, чи ще належить викликачу рядок: `false` — стрім має зупинитись
   * МОВЧКИ, нічого більше не пишучи й не емітуючи.
   */
  async persistPartial(
    tx: Prisma.TransactionClient,
    messageId: string,
    ownedAttempt: number,
    text: string,
    chunkCount: number,
  ): Promise<boolean> {
    const { count } = await tx.aiMessage.updateMany({
      where: { id: messageId, attempt: ownedAttempt, status: 'STREAMING' },
      data: { content: text, chunkCount },
    });
    return count > 0;
  }

  /**
   * Чи попросили Stop для цієї відповіді (design.md D4). Незалежно від `attempt`:
   * маркер живе, поки рядок не термінальний, і мусить перервати навіть паузу
   * перед ретраєм (design.md D2) — Stop важливіший за спробу відновитись.
   */
  async isCancelRequested(tx: Prisma.TransactionClient, messageId: string): Promise<boolean> {
    const row = await tx.aiMessage.findUnique({
      where: { id: messageId },
      select: { cancelRequestedAt: true },
    });
    return row?.cancelRequestedAt != null;
  }

  /**
   * Фінальний стан. `false` — власність втрачено між останнім записом і
   * фіналізацією: викликач НЕ емітує `completed` (design.md D1, «мовчки зупинитись»).
   *
   * `usage` (ai-1a) пишеться в ТОМУ Ж умовному UPDATE, у зарезервовані колонки.
   * Немає usage — колонки не чіпаються (лишаються NULL від `claim()`/`restart()`):
   * порожньо, а не оцінка. `model` перезаписується, лише якщо бекенд його назвав.
   */
  async finalize(
    tx: Prisma.TransactionClient,
    messageId: string,
    ownedAttempt: number,
    input: {
      readonly status: 'COMPLETE' | 'FAILED' | 'CANCELLED';
      readonly errorCode: string | null;
      readonly text: string;
      readonly chunkCount: number;
      readonly usage?: LlmUsage | null;
    },
  ): Promise<boolean> {
    const usage = input.usage;
    const { count } = await tx.aiMessage.updateMany({
      where: { id: messageId, attempt: ownedAttempt, status: 'STREAMING' },
      data: {
        status: input.status,
        errorCode: input.errorCode,
        content: input.text,
        chunkCount: input.chunkCount,
        completedAt: new Date(),
        ...(usage
          ? {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              ...(usage.model ? { model: usage.model } : {}),
            }
          : {}),
      },
    });
    return count > 0;
  }

  // -------------------------------------------------------------- API-side

  /**
   * Stop до старту генерації (design.md D4): фінальний і миттєвий — `claim()`
   * знайде `CANCELLED` і ніколи не викличе провайдера. Повертає, чи рядок
   * дійсно був `PENDING` (інакше викликач переходить до `requestCancel`).
   */
  async cancelPending(tx: Prisma.TransactionClient, messageId: string): Promise<boolean> {
    const { count } = await tx.aiMessage.updateMany({
      where: { id: messageId, status: 'PENDING' },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    return count > 0;
  }

  /**
   * Stop для відповіді в роботі: записує ФАКТ у БД (design.md D4). Повертає,
   * чи рядок дійсно був `STREAMING` — лише тоді викликач публікує pub/sub-сигнал
   * швидкого шляху; на термінальному рядку публікувати нічого не потрібно.
   */
  async requestCancel(tx: Prisma.TransactionClient, messageId: string): Promise<boolean> {
    const { count } = await tx.aiMessage.updateMany({
      where: { id: messageId, status: 'STREAMING' },
      data: { cancelRequestedAt: new Date() },
    });
    return count > 0;
  }

  /**
   * Закриває ПОКИНУТІ відповіді розмови (design.md D3): `PENDING`/`STREAMING` з
   * простроченою чи відсутньою орендою → `FAILED`, частковий текст лишається.
   * Повертає кількість закритих рядків — 0 означає «нічого змінилось», і
   * викликач не має емітувати `reply-closed`.
   */
  async closeAbandoned(tx: Prisma.TransactionClient, conversationId: string): Promise<number> {
    const now = new Date();
    const { count } = await tx.aiMessage.updateMany({
      where: {
        conversationId,
        status: { in: ['PENDING', 'STREAMING'] },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: { status: 'FAILED', errorCode: 'INTERNAL', completedAt: now },
    });
    return count;
  }
}
