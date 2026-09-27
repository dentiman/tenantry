import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantTransactions } from '@saas-skeleton/database';
import {
  AI_CONFIG,
  AiCancelChannel,
  AiMessageStateService,
  LLM_PROVIDER,
  LlmProviderError,
  MessageSubscriber,
  buildPrompt,
  generateAiReplyCommand,
  selectHistoryPairs,
  type AiConfig,
  type LlmProvider,
  type LlmRequest,
  type LlmUsage,
  type MessageData,
  type MessageSubscriberContract,
} from '@saas-skeleton/shared';
import type { AiMessageErrorCode } from '@saas-skeleton/contracts';
import { WorkerRealtimeEmitter } from '../realtime/worker-realtime.emitter';
import { ChunkCoalescer, type CoalescedFrame } from '../ai/chunk-coalescer';

type GenerateAiReply = MessageData<typeof generateAiReplyCommand>;

/** Скільки ЗАЙВИХ ходів історії читати понад `historyTurns`, щоб провалені/зупинені
 *  ходи (які selectHistoryPairs викидає) не крали місце у вікні непомітно */
const HISTORY_SLACK_TURNS = 5;

interface PreparedGeneration {
  readonly tenantId: string;
  readonly userId: string;
  readonly attempt: number;
  readonly prompt: LlmRequest;
}

/**
 * Генерація відповіді асистента (docs/ai-assistant.md §6, AI-0.1 design.md).
 *
 * Координатор, а не виконавець усього: власність рядка, ретраї й накопичення
 * дельт винесено в `AiMessageStateService` і `ChunkCoalescer` (design.md D8) —
 * тут лишається послідовність кроків.
 *
 * ГОЛОВНЕ ПРАВИЛО не змінилось з AI-0: ТРАНЗАКЦІЯ НЕ ТРИМАЄТЬСЯ ЧЕРЕЗ ВИКЛИК МОДЕЛІ.
 * `prepare()` — коротка транзакція (читання + `claim()`). Стрім, ретраї всередині
 * доставки (design.md D2) і періодична перевірка Stop (D4) — поза транзакцією.
 * `finalize()` — знову коротка транзакція, і саме вона виставляє фінальний стан
 * та емітує `ai.message-completed.v1` ПІСЛЯ комміту.
 *
 * Власність генерації — це `attempt`, встановлений `claim()`: КОЖЕН запис
 * (проміжний, рестарт, фінал) фенситься тим самим номером, і нуль оновлених
 * рядків означає, що спробу випереджено. У такому разі координатор МОВЧКИ
 * зупиняється — жодних дельт, жодної фіналізації (design.md D1).
 */
@Injectable()
@MessageSubscriber({ definition: generateAiReplyCommand, id: 'ai-generator' })
export class AiGenerateReplySubscriber
  implements MessageSubscriberContract<typeof generateAiReplyCommand.schema>
{
  private readonly logger = new Logger(AiGenerateReplySubscriber.name);

  constructor(
    private readonly transactions: TenantTransactions,
    private readonly state: AiMessageStateService,
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
    let attempt = prepared.attempt;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort('timeout');
    }, this.config.requestTimeoutMs);
    // Швидкий шлях: Valkey pub/sub (докладніше — AiCancelChannel)
    const unsubscribeCancel = await this.cancelChannel.onCancel(data.messageId, () => {
      controller.abort('cancelled');
    });
    // Гонка «Stop до підписки» (design.md D4): маркер у БД міг зʼявитись до
    // рядка вище — одна перевірка одразу після підписки її закриває
    if (!controller.signal.aborted && (await this.checkCancelRequested(data.messageId))) {
      controller.abort('cancelled');
    }
    // Незалежно від кадрів провайдера (D4): мовчазний провайдер (`__stall__`) теж
    // мусить зупинитись, а не чекати, поки надійде кадр, аби перевірити abort
    const cancelCheckTimer = setInterval(() => {
      if (controller.signal.aborted) {
        return;
      }
      this.checkCancelRequested(data.messageId)
        .then((cancelled) => {
          if (cancelled) {
            controller.abort('cancelled');
          }
        })
        .catch(() => undefined);
    }, this.config.cancelCheckMs);

    let coalescer = new ChunkCoalescer(this.config.streamFlushMs);
    let lastPersistedAt = Date.now();
    let failure: AiMessageErrorCode | null = null;
    let lostOwnership = false;
    let providerCalls = 0;
    // Облік токенів ПОТОЧНОЇ спроби (ai-1a, design.md D7): скидається разом із
    // коалесером на restart(), тож у рядок потрапляє usage спроби, що дала текст
    let usage: LlmUsage | null = null;

    try {
      streamLoop: for (;;) {
        providerCalls += 1;
        try {
          for await (const chunk of this.llm.generate(prompt, controller.signal)) {
            if (chunk.usage) {
              usage = chunk.usage;
            }
            const now = Date.now();
            const frame = coalescer.push(chunk.text, now);
            if (frame) {
              this.emitDelta(tenantId, userId, data, attempt, frame);
            }

            if (now - lastPersistedAt >= this.config.partialPersistMs) {
              const stillOwned = await this.persistPartial(
                data.messageId,
                attempt,
                coalescer.accumulatedText,
                coalescer.chunkCount,
              );
              lastPersistedAt = now;
              if (!stillOwned) {
                lostOwnership = true;
                controller.abort('superseded');
                break;
              }
            }
          }

          if (lostOwnership) {
            break streamLoop;
          }

          const tail = coalescer.flush();
          if (tail) {
            this.emitDelta(tenantId, userId, data, attempt, tail);
          }
          break streamLoop; // успіх — вихід зі стрім-циклу
        } catch (error) {
          // Ретрай усередині ЦІЄЇ доставки (design.md D2) — НЕ через pg-boss:
          // обробник не бачить `retryCount` черги, тож лише тут відомо, чи
          // лишився бюджет. Черга ретраїть окремо, і лише падіння процесу
          const retryable = error instanceof LlmProviderError && error.retryable;
          const budgetLeft = providerCalls <= this.config.providerRetries;
          const alreadyAborted = controller.signal.aborted;
          // Retry-After (ai-1a, design.md D4): не раніше, ніж попросив бекенд; а якщо
          // він просить більше за AI_RETRY_DELAY_MS — не ретраїти взагалі: довшої паузи
          // бюджет оренди (AiLeaseGuard) не покриває, а раніший повтор — гарантований 429
          const waitFitsBudget =
            !(error instanceof LlmProviderError) ||
            error.retryAfterMs === undefined ||
            error.retryAfterMs <= this.config.retryDelayMs;
          if (retryable && budgetLeft && !alreadyAborted && waitFitsBudget) {
            await this.waitForRetry(controller.signal);
            // TS-CFA хибно тягне «aborted було false до await» крізь сам await
            // (не бачить, що `controller.abort()` викликається асинхронно, з
            // колбеків onCancel/cancelCheckTimer) — тому й `no-unnecessary-condition`
            // тут хибне спрацювання: чекання МОГЛО перерватись Stop-ом чи timeout-ом
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- див. коментар вище
            if (controller.signal.aborted) {
              // Stop або timeout сталися ПІД ЧАС паузи — постобробка нижче
              // визначить статус за причиною abort, ретраю не буде
              break streamLoop;
            }
            const restarted = await this.restart(data.messageId, attempt);
            if (!restarted) {
              lostOwnership = true;
              break streamLoop;
            }
            attempt = restarted.attempt;
            // Нова спроба — новий коалесер: попередній текст скинуто (АТОМАРНО,
            // разом із рядком, у restart()), клієнт побачить chunkSeq 0 нового
            // attempt і викине накопичене від попередньої (design.md D6)
            coalescer = new ChunkCoalescer(this.config.streamFlushMs);
            usage = null;
            continue streamLoop;
          }

          failure = error instanceof LlmProviderError ? 'PROVIDER_UNAVAILABLE' : 'INTERNAL';
          this.logger.error(
            { err: error, messageId: data.messageId },
            `AI generation failed: ${failure}`,
          );
          break streamLoop;
        }
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(cancelCheckTimer);
      unsubscribeCancel();
    }

    if (lostOwnership) {
      // Мовчки: жодної дельти більше, жодної фіналізації (design.md D1)
      return;
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
      attempt,
      text: coalescer.accumulatedText,
      chunkCount: coalescer.chunkCount,
      status: failure !== null ? 'FAILED' : cancelledByUser ? 'CANCELLED' : 'COMPLETE',
      errorCode: failure,
      usage,
    });
  }

  /**
   * Читання й перевірки, ЩО НЕ ЗАЛЕЖАТЬ від `attempt` (питання, історія, юзер),
   * плюс саме захоплення власності `claim()` — останнім кроком тієї ж транзакції.
   * Повертає `null`, коли працювати нема над чим: рядок зник, юзера чи питання
   * не знайдено, або `claim()` каже, що рядок уже захоплено/термінальний — це
   * НЕ помилка, повторна доставка вже обробленої відповіді тихо виходить.
   */
  private async prepare(data: GenerateAiReply): Promise<PreparedGeneration | null> {
    return this.transactions.withTenantTx(async (tx) => {
      const reply = await tx.aiMessage.findUnique({
        where: { id: data.messageId },
        include: { conversation: true },
      });

      if (reply?.conversationId !== data.conversationId) {
        this.logger.warn(`AI reply ${data.messageId} is gone — nothing to generate`);
        return null;
      }

      const user = await tx.user.findUnique({
        where: { id: reply.conversation.userId },
        select: { role: true, locale: true },
      });
      if (!user) {
        return null;
      }

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

      // seq < reply.seq - 1 (НЕ reply.seq): рядок reply.seq - 1 — саме questionRow вище,
      // і buildPrompt() додає його окремо як `question`. Включити його сюди теж означало б
      // надіслати моделі те саме питання двічі (docs/ai-assistant-review-gaps.md п.2).
      //
      // Статус НЕ фільтрується тут: провалений/зупинений хід має піти з контексту ЦІЛОЮ
      // парою, а не лишити своє питання без пари — цим займається selectHistoryPairs.
      // Слек понад historyTurns*2 рядків — щоб такі невдалі ходи не крали місце в вікні
      // в НЕПОМІЧЕНИЙ спосіб (design.md D8): вибірка каже, скільки рядків прочитано, а не
      // скільки ЗАВЕРШЕНИХ пар серед них.
      const historyRows = await tx.aiMessage.findMany({
        where: { conversationId: data.conversationId, seq: { lt: reply.seq - 1 } },
        orderBy: { seq: 'desc' },
        take: (this.config.historyTurns + HISTORY_SLACK_TURNS) * 2,
        select: { seq: true, role: true, status: true, content: true },
      });
      const history = selectHistoryPairs(historyRows.reverse(), this.config.historyTurns);

      // Захоплення власності — ОСТАННІМ кроком, коли вже відомо, що є з чим
      // генерувати (design.md D1). Той самий якір ідемпотентності, що раніше
      // тримав прямий статус-чек: PENDING/STREAMING-з-простроченою-орендою — так,
      // усе інше — тихий вихід
      const claimed = await this.state.claim(tx, data.messageId, data.conversationId, {
        leaseMs: this.config.leaseMs,
        model: this.config.model,
      });
      if (!claimed) {
        this.logger.debug(`AI reply ${data.messageId} already claimed or terminal — skipping`);
        return null;
      }

      return {
        tenantId: claimed.tenantId,
        userId: claimed.userId,
        attempt: claimed.attempt,
        prompt: {
          messages: buildPrompt({
            question: questionRow.content,
            history,
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
   * Короткий самостійний запис поза генераційним потоком — те, завдяки чому
   * «частковий текст переживає обрив» і «reconnect посеред генерації» взагалі
   * правдиві. `false` — власність утрачено, викликач має зупинити стрім МОВЧКИ.
   * Помилка запису (не фенсингу) не має права звалити генерацію — лишається
   * `true`, фінальний запис усе одно розставить крапки над «і».
   */
  private async persistPartial(
    messageId: string,
    attempt: number,
    text: string,
    chunkCount: number,
  ): Promise<boolean> {
    try {
      return await this.transactions.withTenantTx((tx) =>
        this.state.persistPartial(tx, messageId, attempt, text, chunkCount),
      );
    } catch (error) {
      this.logger.warn(`Partial persist failed for ${messageId}: ${String(error)}`);
      return true;
    }
  }

  /** Перезапуск усередині доставки після тимчасової відмови (design.md D2) */
  private async restart(
    messageId: string,
    ownedAttempt: number,
  ): Promise<{ attempt: number } | null> {
    return this.transactions.withTenantTx((tx) =>
      this.state.restart(tx, messageId, ownedAttempt, { leaseMs: this.config.leaseMs }),
    );
  }

  /** Читання маркера Stop (design.md D4). Помилка читання — не привід зупиняти генерацію */
  private async checkCancelRequested(messageId: string): Promise<boolean> {
    try {
      return await this.transactions.withTenantTx((tx) =>
        this.state.isCancelRequested(tx, messageId),
      );
    } catch (error) {
      this.logger.warn(`Cancel check failed for ${messageId}: ${String(error)}`);
      return false;
    }
  }

  /**
   * Фінальний стан + емісія ПІСЛЯ комміту. `false` — власність утрачено між
   * останнім записом і фіналізацією: викликач не робить нічого більше.
   */
  private async finalize(input: {
    messageId: string;
    conversationId: string;
    tenantId: string;
    userId: string;
    attempt: number;
    text: string;
    chunkCount: number;
    status: 'COMPLETE' | 'FAILED' | 'CANCELLED';
    errorCode: AiMessageErrorCode | null;
    usage: LlmUsage | null;
  }): Promise<boolean> {
    return this.transactions.withTenantTx(async (tx) => {
      const finalized = await this.state.finalize(tx, input.messageId, input.attempt, {
        status: input.status,
        errorCode: input.errorCode,
        text: input.text,
        chunkCount: input.chunkCount,
        usage: input.usage,
      });
      if (!finalized) {
        return false;
      }

      await tx.aiConversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: new Date() },
      });

      // Після комміту: клієнт, який у відповідь перечитає стрічку, гарантовано
      // побачить фінальний текст, а не той, що був до запису
      this.transactions.onCommit(tx, () => {
        this.logUsage(input.messageId, input.status, input.usage);
        this.realtime.aiCompleted(input.tenantId, input.userId, {
          conversationId: input.conversationId,
          messageId: input.messageId,
          status: input.status,
          errorCode: input.errorCode,
          occurredAt: new Date().toISOString(),
        });
      });
      return true;
    });
  }

  /**
   * Один рядок на відповідь — саме звідси ручний прогін із живим ключем читає
   * `cached_tokens` другого ходу (docs/ai-assistant.md §5.3). Лише числа й модель:
   * ні тексту, ні промпту (приватність, docs/ai-assistant-implementation.md §6)
   */
  private logUsage(messageId: string, status: string, usage: LlmUsage | null): void {
    if (!usage) {
      return;
    }
    this.logger.log(
      {
        messageId,
        status,
        model: usage.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedPromptTokens: usage.cachedPromptTokens,
      },
      'AI reply usage',
    );
  }

  private emitDelta(
    tenantId: string,
    userId: string,
    data: GenerateAiReply,
    attempt: number,
    frame: CoalescedFrame,
  ): void {
    this.realtime.aiDelta(tenantId, userId, {
      conversationId: data.conversationId,
      messageId: data.messageId,
      attempt,
      chunkSeq: frame.chunkSeq,
      text: frame.text,
    });
  }

  /**
   * Пауза перед ретраєм, яка миттєво завершується на abort (Stop або timeout).
   * Завжди `AI_RETRY_DELAY_MS`: `Retry-After`, що в нього вміщується, цим уже
   * задоволений, а той, що не вміщується, до паузи не доходить (design.md D4)
   */
  private waitForRetry(signal: AbortSignal): Promise<void> {
    const ms = this.config.retryDelayMs;
    if (ms <= 0 || signal.aborted) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      function onAbort(): void {
        clearTimeout(timer);
        resolve();
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
