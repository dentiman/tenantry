import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import {
  AI_CONFIG,
  AiCancelChannel,
  LLM_PROVIDER,
  LlmProviderError,
  MessageSubscriber,
  buildPrompt,
  generateAiReplyCommand,
  type AiConfig,
  type AiHistoryTurn,
  type LlmProvider,
  type LlmRequest,
  type MessageData,
  type MessageSubscriberContract,
} from '@saas-skeleton/shared';
import type { AiMessageErrorCode } from '@saas-skeleton/contracts';
import { WorkerRealtimeEmitter } from '../realtime/worker-realtime.emitter';

type GenerateAiReply = MessageData<typeof generateAiReplyCommand>;

/**
 * Генерація відповіді асистента (docs/ai-assistant-plan.md §4.5).
 *
 * Три фази, і головне правило — ТРАНЗАКЦІЯ НЕ ТРИМАЄТЬСЯ ЧЕРЕЗ ВИКЛИК МОДЕЛІ:
 *
 *   tx1  прочитати розмову й історію, поставити STREAMING
 *    —   без транзакції: стрім → коалесування → дельти, кожні ~2 с короткий UPDATE
 *   tx2  фінальний текст + статус + after-commit емісія completed
 *
 * `withTenantTx` відкриває інтерактивну транзакцію Postgres. Протягнути крізь неї
 * десятки секунд генерації означало б тримати конекшн пулу і відкритий снапшот,
 * який блокує vacuum по ВСІЙ базі.
 *
 * Ідемпотентність — по СТАТУСУ РЯДКА, а не через `MessageInboxService.runOnce`:
 * runOnce ключується `messageId:consumerId` і назавжди зʼїв би легальний ретрай
 * після тимчасової відмови провайдера. Бізнес-факт тут — «відповідь вироблено»,
 * і він уже записаний у `ai_messages.status`.
 */
@Injectable()
@MessageSubscriber({ definition: generateAiReplyCommand, id: 'ai-generator' })
export class AiGenerateReplySubscriber
  implements MessageSubscriberContract<typeof generateAiReplyCommand.schema>
{
  private readonly logger = new Logger(AiGenerateReplySubscriber.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TenantTransactions,
    private readonly realtime: WorkerRealtimeEmitter,
    private readonly cancelChannel: AiCancelChannel,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
  ) {}

  async handle(data: GenerateAiReply): Promise<void> {
    const prepared = await this.prepare(data);
    if (!prepared) {
      return;
    }
    const { tenantId, userId, prompt } = prepared;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort('timeout');
    }, this.config.requestTimeoutMs);
    // Скасування користувачем приходить через Valkey: воркер усередині читання
    // потоку не опитує БД (див. AiCancelChannel)
    const unsubscribe = await this.cancelChannel.onCancel(data.messageId, () => {
      controller.abort('cancelled');
    });

    let text = '';
    let chunkSeq = 0;
    let lastPersistedAt = Date.now();
    let failure: AiMessageErrorCode | null = null;

    try {
      let pending = '';
      let lastFlushAt = Date.now();

      for await (const chunk of this.llm.generate(prompt, controller.signal)) {
        pending += chunk.text;
        const now = Date.now();

        // Коалесування: кадр віддається або по таймеру, або на межі абзацу —
        // інакше хвіст відповіді чекав би повний інтервал після останнього кадру
        const dueByTime = now - lastFlushAt >= this.config.streamFlushMs;
        const dueByParagraph = pending.endsWith('\n\n');
        if (pending.length > 0 && (dueByTime || dueByParagraph)) {
          text += pending;
          this.emitDelta(tenantId, userId, data, chunkSeq, pending);
          chunkSeq += 1;
          pending = '';
          lastFlushAt = now;
        }

        if (now - lastPersistedAt >= this.config.partialPersistMs) {
          await this.persistPartial(data.messageId, text);
          lastPersistedAt = now;
        }
      }

      if (pending.length > 0) {
        text += pending;
        this.emitDelta(tenantId, userId, data, chunkSeq, pending);
        chunkSeq += 1;
      }
    } catch (error) {
      failure = error instanceof LlmProviderError ? 'PROVIDER_UNAVAILABLE' : 'INTERNAL';
      this.logger.error(
        { err: error, messageId: data.messageId },
        `AI generation failed: ${failure}`,
      );
    } finally {
      clearTimeout(timeout);
      unsubscribe();
    }

    const aborted = controller.signal.aborted;
    const cancelledByUser = aborted && controller.signal.reason === 'cancelled';
    if (aborted && !cancelledByUser && failure === null) {
      failure = 'TIMEOUT';
    }

    await this.finalize({
      messageId: data.messageId,
      conversationId: data.conversationId,
      tenantId,
      userId,
      text,
      status: failure !== null ? 'FAILED' : cancelledByUser ? 'CANCELLED' : 'COMPLETE',
      errorCode: failure,
    });
  }

  /**
   * Фаза 1. Повертає null, коли працювати нема над чим — і це НЕ помилка:
   * повторна доставка вже завершеної відповіді має тихо вийти.
   */
  private async prepare(data: GenerateAiReply): Promise<{
    tenantId: string;
    userId: string;
    prompt: LlmRequest;
  } | null> {
    return this.transactions.withTenantTx(async (tx) => {
      const reply = await tx.aiMessage.findUnique({
        where: { id: data.messageId },
        include: { conversation: true },
      });

      if (reply?.conversationId !== data.conversationId) {
        this.logger.warn(`AI reply ${data.messageId} is gone — nothing to generate`);
        return null;
      }
      // Якір ідемпотентності: працюємо лише над PENDING/STREAMING
      if (reply.status !== 'PENDING' && reply.status !== 'STREAMING') {
        this.logger.debug(`AI reply ${data.messageId} already ${reply.status} — skipping`);
        return null;
      }

      const user = await tx.user.findUnique({
        where: { id: reply.conversation.userId },
        select: { role: true, locale: true },
      });
      if (!user) {
        return null;
      }

      const history = await tx.aiMessage.findMany({
        where: {
          conversationId: data.conversationId,
          seq: { lt: reply.seq },
          status: 'COMPLETE',
        },
        orderBy: { seq: 'desc' },
        take: this.config.historyTurns * 2,
        select: { role: true, content: true },
      });

      // Питання — це рядок РІВНО перед відповіддю: seq монотонний у межах розмови,
      // тому пара «питання/відповідь» це (seq-1, seq), без жодного пошуку
      const questionRow = await tx.aiMessage.findFirst({
        where: { conversationId: data.conversationId, seq: reply.seq - 1, role: 'USER' },
        select: { content: true },
      });
      if (!questionRow) {
        this.logger.warn(`AI reply ${data.messageId} has no question at seq ${String(reply.seq - 1)}`);
        return null;
      }

      // Ретрай перестрімлює з нуля, тому накопичений текст скидається — інакше
      // дві спроби склеїлись би в одну відповідь
      await tx.aiMessage.update({
        where: { id: reply.id },
        data: {
          status: 'STREAMING',
          content: '',
          errorCode: null,
          startedAt: new Date(),
          model: this.config.model,
        },
      });

      return {
        tenantId: reply.tenantId,
        userId: reply.conversation.userId,
        prompt: {
          messages: buildPrompt({
            question: questionRow.content,
            history: toHistory(history.reverse()),
            knowledge: [],
            user: { role: user.role, locale: user.locale },
          }),
          model: this.config.model,
          maxOutputTokens: this.config.maxOutputTokens,
        },
      };
    });
  }

  /**
   * Короткий самостійний UPDATE поза транзакцією. Це не підстраховка, а те, завдяки
   * чому «частковий текст переживає обрив» і «reconnect посеред генерації» взагалі
   * правдиві: перезавантажена сторінка читає стрічку і бачить згенероване досі.
   */
  private async persistPartial(messageId: string, text: string): Promise<void> {
    try {
      await this.transactions.withTenantTx((tx) =>
        tx.aiMessage.update({ where: { id: messageId }, data: { content: text } }),
      );
    } catch (error) {
      // Проміжний запис не має права валити генерацію — фінальний усе одно буде
      this.logger.warn(`Partial persist failed for ${messageId}: ${String(error)}`);
    }
  }

  /** Фаза 3: фінальний стан + емісія ПІСЛЯ комміту */
  private async finalize(input: {
    messageId: string;
    conversationId: string;
    tenantId: string;
    userId: string;
    text: string;
    status: 'COMPLETE' | 'FAILED' | 'CANCELLED';
    errorCode: AiMessageErrorCode | null;
  }): Promise<void> {
    await this.transactions.withTenantTx(async (tx) => {
      await tx.aiMessage.update({
        where: { id: input.messageId },
        data: {
          content: input.text,
          status: input.status,
          errorCode: input.errorCode,
          completedAt: new Date(),
        },
      });
      await tx.aiConversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: new Date() },
      });

      // Після комміту: клієнт, який у відповідь перечитає стрічку, гарантовано
      // побачить фінальний текст, а не той, що був до запису
      this.transactions.onCommit(tx, () => {
        this.realtime.aiCompleted(input.tenantId, input.userId, {
          conversationId: input.conversationId,
          messageId: input.messageId,
          status: input.status,
          errorCode: input.errorCode,
          occurredAt: new Date().toISOString(),
        });
      });
    });
  }

  private emitDelta(
    tenantId: string,
    userId: string,
    data: GenerateAiReply,
    chunkSeq: number,
    text: string,
  ): void {
    this.realtime.aiDelta(tenantId, userId, {
      conversationId: data.conversationId,
      messageId: data.messageId,
      chunkSeq,
      text,
    });
  }
}

function toHistory(rows: { role: string; content: string }[]): AiHistoryTurn[] {
  return rows.map((row) => ({
    role: row.role === 'USER' ? 'user' : 'assistant',
    content: row.content,
  }));
}
