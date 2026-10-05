import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantTransactions } from '@saas-skeleton/database';
import {
  AI_CONFIG,
  AiCancelChannel,
  AiMessageStateService,
  AiUsageLedger,
  AiUsageQuotaService,
  EmbeddingRequestError,
  KNOWLEDGE_SOURCE,
  AI_RUNTIME,
  LlmProviderError,
  MessageSubscriber,
  buildGenerationRequest,
  generateAiReplyCommand,
  ledgerTokensForEmbedding,
  ledgerTokensFromLlm,
  readAiSettings,
  toKnowledgeChunkRefs,
  type AiConfig,
  type AiGeneration,
  type AiRuntime,
  type AiHistoryRow,
  type AiOrganizationInstructions,
  type KnowledgeSelection,
  type KnowledgeSource,
  type LlmProvider,
  type LlmRequest,
  type LlmUsage,
  type MessageData,
  type MessageSubscriberContract,
  type UsageEntry,
  type UsageOutcome,
} from '@saas-skeleton/shared';
import { REALTIME_EVENTS, type AiMessageErrorCode } from '@saas-skeleton/contracts';
import { WorkerRealtimeEmitter } from '../realtime/worker-realtime.emitter';
import { ChunkCoalescer, type CoalescedFrame } from '../ai/chunk-coalescer';

type GenerateAiReply = MessageData<typeof generateAiReplyCommand>;

/** Скільки ЗАЙВИХ ходів історії читати понад `historyTurns`, щоб провалені/зупинені
 *  ходи (які selectHistoryPairs викидає) не крали місце у вікні непомітно */
const HISTORY_SLACK_TURNS = 5;

/** `knowledge_version` спроби, для якої знання так і не вдалося вибрати (AI-2a.3) */
const KNOWLEDGE_UNAVAILABLE = 'unavailable';

/** Усе, що читається до вибору знань — першою короткою транзакцією `prepare()` */
interface GenerationContext {
  readonly question: string;
  /** Рядки до питання в порядку `seq`; вікно `historyTurns` відбирає `buildGenerationRequest` */
  readonly historyRows: readonly AiHistoryRow[];
  readonly user: { readonly role: 'ADMIN' | 'USER'; readonly locale: string };
  readonly organization: AiOrganizationInstructions;
  /** Для realtime-адресації, якщо відповідь закривається, не дійшовши до claim() */
  readonly tenantId: string;
  readonly userId: string;
}

interface PreparedGeneration {
  readonly tenantId: string;
  readonly userId: string;
  readonly attempt: number;
  readonly prompt: LlmRequest;
  /** Провайдер ЦІЄЇ генерації (AI-5a): з налаштувань суперадміна поверх env */
  readonly provider: LlmProvider;
  /** Хто виставляє рахунок — ключ рядків журналу витрат (AI-5b) */
  readonly billingProvider: string;
}

/**
 * Одна спроба генерації для журналу витрат (AI-5b, design.md R2/R3): що провайдер устиг
 * повідомити — id запиту, usage. Пишеться рівно раз: у транзакції `restart()` (пішла на
 * ретрай), `finalize()` (остання) або власній (втрата власності)
 */
interface AttemptUsage {
  readonly attempt: number;
  readonly usage: LlmUsage | null;
  readonly requestId: string | null;
}

/** Фінальний стан відповіді → результат її останньої спроби в журналі */
function finalOutcome(
  status: 'COMPLETE' | 'FAILED' | 'CANCELLED',
  errorCode: AiMessageErrorCode | null,
): UsageOutcome {
  if (status === 'COMPLETE') {
    return 'complete';
  }
  if (status === 'CANCELLED') {
    return 'cancelled';
  }
  return errorCode === 'TIMEOUT' ? 'timeout' : 'failed';
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
export class AiGenerateReplySubscriber implements MessageSubscriberContract<
  typeof generateAiReplyCommand.schema
> {
  private readonly logger = new Logger(AiGenerateReplySubscriber.name);

  constructor(
    private readonly transactions: TenantTransactions,
    private readonly state: AiMessageStateService,
    private readonly realtime: WorkerRealtimeEmitter,
    private readonly cancelChannel: AiCancelChannel,
    @Inject(AI_RUNTIME) private readonly runtime: AiRuntime,
    @Inject(KNOWLEDGE_SOURCE) private readonly knowledgeSource: KnowledgeSource,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    private readonly usageQuota: AiUsageQuotaService,
    private readonly ledger: AiUsageLedger,
  ) {}

  async handle(data: GenerateAiReply): Promise<void> {
    const prepared = await this.prepare(data);
    if (!prepared) {
      return;
    }
    const { tenantId, userId, prompt, provider } = prepared;
    let attempt = prepared.attempt;
    // Рядок журналу для спроби — з тим, що провайдер устиг повідомити (AI-5b, design.md R2)
    const attemptEntry = (current: AttemptUsage, outcome: UsageOutcome): UsageEntry => ({
      kind: 'generation',
      outcome,
      userId,
      messageId: data.messageId,
      attempt: current.attempt,
      provider: prepared.billingProvider,
      model: current.usage?.model ?? prompt.model,
      requestedModel: prompt.model,
      tokens: ledgerTokensFromLlm(current.usage),
      reportedCost: current.usage?.reportedCost ?? null,
      requestId: current.requestId,
    });

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
    // Id запиту ПОТОЧНОЇ спроби (AI-5b): приходить першим кадром, зберігається з частковим
    // текстом одразу — щоб спробу впалого воркера можна було дооцінити (design.md R3)
    let requestId: string | null = null;
    let requestIdPersisted = false;
    // Спробу, що пішла на ретрай чи програла restart(), уже записано в журнал його транзакцією
    let attemptRecorded = false;

    try {
      streamLoop: for (;;) {
        providerCalls += 1;
        try {
          for await (const chunk of provider.generate(prompt, controller.signal)) {
            if (chunk.usage) {
              usage = chunk.usage;
            }
            if (chunk.requestId && requestId === null) {
              requestId = chunk.requestId;
            }
            const now = Date.now();
            const frame = coalescer.push(chunk.text, now);
            if (frame) {
              this.emitDelta(tenantId, userId, data, attempt, frame);
            }

            if (
              now - lastPersistedAt >= this.config.partialPersistMs ||
              (requestId !== null && !requestIdPersisted)
            ) {
              const stillOwned = await this.persistPartial(
                data.messageId,
                attempt,
                coalescer.accumulatedText,
                coalescer.chunkCount,
                requestId,
              );
              requestIdPersisted = requestId !== null;
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
            const restarted = await this.restart(data.messageId, attempt, (succeeded) =>
              attemptEntry({ attempt, usage, requestId }, succeeded ? 'retried' : 'superseded'),
            );
            if (!restarted) {
              lostOwnership = true;
              attemptRecorded = true;
              break streamLoop;
            }
            attempt = restarted.attempt;
            requestId = null;
            requestIdPersisted = false;
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
      // Мовчки: жодної дельти більше, жодної фіналізації (design.md D1). Але спроба платна —
      // вона йде в журнал витрат власною короткою транзакцією (AI-5b, design.md R3)
      if (!attemptRecorded) {
        await this.recordLostAttempt(attemptEntry({ attempt, usage, requestId }, 'superseded'));
      }
      return;
    }

    const aborted = controller.signal.aborted;
    const cancelledByUser = aborted && controller.signal.reason === 'cancelled';
    if (aborted && !cancelledByUser && failure === null) {
      failure = 'TIMEOUT';
    }
    const status = failure !== null ? 'FAILED' : cancelledByUser ? 'CANCELLED' : 'COMPLETE';

    await this.finalize({
      messageId: data.messageId,
      conversationId: data.conversationId,
      tenantId,
      userId,
      attempt,
      text: coalescer.accumulatedText,
      chunkCount: coalescer.chunkCount,
      status,
      errorCode: failure,
      usage,
      attemptEntry: attemptEntry({ attempt, usage, requestId }, finalOutcome(status, failure)),
    });
  }

  /**
   * Три фази (AI-2a.3, design.md D3), бо вибір знань тепер може бути HTTP-викликом
   * (embedding питання), а ТРАНЗАКЦІЯ НЕ ТРИМАЄТЬСЯ ЧЕРЕЗ ВИКЛИК МОДЕЛІ — і
   * embedding-моделі теж:
   *
   * 1. `readContext()` — коротка транзакція: рядок, питання, історія, налаштування;
   * 2. `knowledgeSource.select()` — поза транзакцією (пошук відкриває власну);
   * 3. `claim()` — коротка транзакція, ОСТАННІЙ крок, як і раніше (design.md D1).
   *
   * Між фазами рядок може змінитись — це безпечно: `claim()` лишається єдиним
   * арбітром власності й тихо програє, якщо рядок уже захоплено чи закрито.
   * Повертає `null`, коли працювати нема над чим (це НЕ помилка).
   */
  private async prepare(data: GenerateAiReply): Promise<PreparedGeneration | null> {
    const context = await this.readContext(data);
    if (!context) {
      return null;
    }

    // Асистента вимкнули (платформа, дозвіл tenant-у чи сам Tenant Admin) після того, як
    // питання стало в чергу (AI-5a, design.md D6): закриваємо без виклику моделі
    if (!(await this.runtime.availableForCurrentTenant())) {
      await this.cancelUnavailable(data, context);
      return null;
    }

    // Провайдер і модель — на кожну генерацію з налаштувань суперадміна (AI-5a, design.md
    // D5). Не налаштовано чи не розшифровується ключ — явний FAILED після claim(), як і
    // збій embeddings нижче
    let generation: AiGeneration | null = null;
    try {
      generation = await this.runtime.generation();
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : 'unknown', messageId: data.messageId },
        'AI provider is not usable with the current settings',
      );
    }

    // Фільтр `audience` — за роллю юзера на момент генерації; у джерело йдуть лише
    // роль і питання (§9.1). Помилка embedding — не привід відповідати без джерел
    // (design.md D4): відповідь буде явно FAILED, але лише після claim()
    let knowledge: KnowledgeSelection | null = null;
    let knowledgeFailure: AiMessageErrorCode = 'INTERNAL';
    try {
      knowledge = await this.knowledgeSource.select({
        role: context.user.role,
        question: context.question,
      });
    } catch (error) {
      knowledgeFailure =
        error instanceof EmbeddingRequestError ? 'PROVIDER_UNAVAILABLE' : 'INTERNAL';
      this.logger.error(
        { err: error, messageId: data.messageId },
        `AI knowledge selection failed: ${knowledgeFailure}`,
      );
    }

    // Версія знань і фрагменти пишуться тим самим фенсингованим UPDATE, що
    // захоплює рядок (ai-1b, design.md D7; AI-2a.3, design.md D6)
    const billingProvider = generation?.billingProvider ?? 'unknown';
    const claimed = await this.transactions.withTenantTx(async (tx) => {
      // Стан ДО захоплення: перезахоплений STREAMING — спроба впалого воркера (AI-5b, R3)
      const before = await tx.aiMessage.findUnique({
        where: { id: data.messageId },
        select: { status: true, attempt: true, providerRequestId: true, model: true },
      });
      const result = await this.state.claim(tx, data.messageId, data.conversationId, {
        leaseMs: this.config.leaseMs,
        model: generation?.model ?? this.config.model,
        knowledgeVersion: knowledge?.version ?? KNOWLEDGE_UNAVAILABLE,
        knowledgeChunks: knowledge?.excerpts ? toKnowledgeChunkRefs(knowledge.excerpts) : null,
      });

      // Журнал витрат (AI-5b, design.md R3) — у ЦІЙ Ж транзакції, і навіть коли claim()
      // програв: embedding питання вже оплачено. Транзакція комітиться — програш claim()
      // не помилка, а `null`
      const entries: UsageEntry[] = [];
      const embedding = knowledge?.queryEmbedding;
      if (embedding) {
        entries.push({
          kind: 'query_embedding',
          outcome: 'complete',
          userId: context.userId,
          messageId: data.messageId,
          provider: embedding.billing?.provider ?? 'unknown',
          model: embedding.billing?.model ?? 'unknown',
          tokens: ledgerTokensForEmbedding(embedding.inputTokens),
          reportedCost: embedding.billing?.reportedCost ?? null,
          requestId: embedding.billing?.requestId ?? null,
        });
      }
      if (result && before?.status === 'STREAMING' && before.attempt > 0) {
        // Попередня спроба не дожила до finalize(): usage немає, але id запиту (якщо встиг)
        // дасть добору фактичну вартість
        entries.push({
          kind: 'generation',
          outcome: 'abandoned',
          userId: context.userId,
          messageId: data.messageId,
          attempt: before.attempt,
          provider: billingProvider,
          model: before.model ?? generation?.model ?? this.config.model,
          tokens: null,
          reportedCost: null,
          requestId: before.providerRequestId ?? null,
        });
      }
      await this.ledger.record(tx, entries);
      return result;
    });
    if (!claimed) {
      this.logger.debug(`AI reply ${data.messageId} already claimed or terminal — skipping`);
      return null;
    }

    if (generation === null || knowledge === null) {
      await this.finalize({
        messageId: data.messageId,
        conversationId: data.conversationId,
        tenantId: claimed.tenantId,
        userId: claimed.userId,
        attempt: claimed.attempt,
        text: '',
        chunkCount: 0,
        status: 'FAILED',
        errorCode: generation === null ? 'PROVIDER_UNAVAILABLE' : knowledgeFailure,
        usage: null,
        // Провайдера генерації не викликали — рядка спроби немає
        attemptEntry: null,
      });
      return null;
    }

    return {
      tenantId: claimed.tenantId,
      userId: claimed.userId,
      attempt: claimed.attempt,
      // Той самий запит будує eval відповідей (AI-5c): eval міряє рівно те, що йде в прод
      prompt: buildGenerationRequest({
        question: context.question,
        historyRows: context.historyRows,
        historyTurns: this.config.historyTurns,
        user: context.user,
        organization: context.organization,
        knowledge,
        model: generation.model,
        maxOutputTokens: this.config.maxOutputTokens,
      }),
      provider: generation.provider,
      billingProvider,
    };
  }

  /**
   * Закриття відповіді, коли асистент недоступний tenant-у (AI-5a): той самий умовний
   * перехід, що для RETIRED-розмови, плюс `completed` після комміту — відкрита панель
   * перестає чекати на відповідь, яка вже не прийде.
   */
  private async cancelUnavailable(
    data: GenerateAiReply,
    context: GenerationContext,
  ): Promise<void> {
    await this.transactions.withTenantTx(async (tx) => {
      const cancelled = await this.state.cancelRetired(tx, data.messageId);
      if (!cancelled) {
        return;
      }
      this.transactions.onCommit(tx, () => {
        this.realtime.toUser(context.tenantId, context.userId, REALTIME_EVENTS.aiMessageCompleted, {
          conversationId: data.conversationId,
          messageId: data.messageId,
          status: 'CANCELLED',
          errorCode: null,
          occurredAt: new Date().toISOString(),
        });
      });
    });
    this.logger.log(
      `AI reply ${data.messageId} cancelled — assistant is unavailable for the tenant`,
    );
  }

  /**
   * Перша фаза `prepare()`: читання й перевірки, ЩО НЕ ЗАЛЕЖАТЬ від `attempt`
   * (питання, історія, юзер, налаштування). Без claim() — він у третій фазі.
   */
  private async readContext(data: GenerateAiReply): Promise<GenerationContext | null> {
    return this.transactions.withTenantTx(async (tx) => {
      const reply = await tx.aiMessage.findUnique({
        where: { id: data.messageId },
        include: { conversation: true },
      });

      if (reply?.conversationId !== data.conversationId) {
        this.logger.warn(`AI reply ${data.messageId} is gone — nothing to generate`);
        return null;
      }

      // Розмову вже закрили («нова розмова») до того, як цю відповідь узяли в роботу
      // (ai-1e, живий прогін implementation §7.1): ніхто її не побачить, тож закриваємо
      // CANCELLED, не заклеймивши і не звернувшись до моделі — раніше за claim() навмисно
      if (reply.conversation.status === 'RETIRED') {
        await this.state.cancelRetired(tx, data.messageId);
        this.logger.log(
          `AI reply ${data.messageId} cancelled — conversation ${data.conversationId} is retired`,
        );
        return null;
      }

      // Повторна доставка вже обробленої чи живої відповіді виходить ДО embedding-виклику
      // (AI-2a.3): та сама умова, що в claim(), але claim() лишається арбітром — це лише
      // економія виклику, а не перевірка власності
      const leaseLive = reply.leaseExpiresAt !== null && reply.leaseExpiresAt > new Date();
      if (reply.status !== 'PENDING' && !(reply.status === 'STREAMING' && !leaseLive)) {
        this.logger.debug(`AI reply ${data.messageId} already claimed or terminal — skipping`);
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
        this.logger.warn(
          `AI reply ${data.messageId} has no question at seq ${String(reply.seq - 1)}`,
        );
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

      // Персона й інструкції організації (AI-1c) — у тій самій транзакції, під RLS.
      // `reply.tenantId` — власна колонка рядка, не аргумент сервісу; RLS однаково
      // не дасть прочитати чужий рядок. Читається раз на доставку: restart() усередині
      // неї бере той самий промпт — так само, як зі знаннями
      const tenant = await tx.tenant.findUnique({
        where: { id: reply.tenantId },
        select: { settings: true },
      });
      const aiSettings = readAiSettings(tenant?.settings);
      if (!aiSettings.valid) {
        // Без тексту: це конфігурація тенанта, у лог вона не йде
        this.logger.warn(
          `AI settings of tenant ${reply.tenantId} are invalid — using boundaries only`,
        );
      }

      return {
        question: questionRow.content,
        historyRows: historyRows.reverse(),
        user: { role: user.role, locale: user.locale },
        organization: aiSettings.settings,
        tenantId: reply.tenantId,
        userId: reply.conversation.userId,
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
    providerRequestId: string | null,
  ): Promise<boolean> {
    try {
      return await this.transactions.withTenantTx((tx) =>
        this.state.persistPartial(tx, messageId, attempt, text, chunkCount, providerRequestId),
      );
    } catch (error) {
      this.logger.warn(`Partial persist failed for ${messageId}: ${String(error)}`);
      return true;
    }
  }

  /**
   * Перезапуск усередині доставки після тимчасової відмови (design.md D2). Спроба, що
   * відмовила, пишеться в журнал витрат тією ж транзакцією (AI-5b, design.md R3):
   * `retried`, або `superseded`, якщо restart() програв фенсинг
   */
  private async restart(
    messageId: string,
    ownedAttempt: number,
    failedAttempt: (restarted: boolean) => UsageEntry,
  ): Promise<{ attempt: number } | null> {
    return this.transactions.withTenantTx(async (tx) => {
      const restarted = await this.state.restart(tx, messageId, ownedAttempt, {
        leaseMs: this.config.leaseMs,
      });
      await this.ledger.record(tx, [failedAttempt(restarted !== null)]);
      return restarted;
    });
  }

  /**
   * Спроба, що втратила власність посеред стріму (AI-5b, design.md R3): відповідь уже не
   * наша, але гроші витрачено. Збій запису не валить доставку — лише лог
   */
  private async recordLostAttempt(entry: UsageEntry): Promise<void> {
    try {
      await this.transactions.withTenantTx((tx) => this.ledger.record(tx, [entry]));
    } catch (error) {
      this.logger.error(
        { err: error, messageId: entry.messageId },
        'AI usage of a superseded attempt was not recorded',
      );
    }
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
    /** Остання спроба для журналу витрат; `null` — провайдера не викликали */
    attemptEntry: UsageEntry | null;
  }): Promise<boolean> {
    return this.transactions.withTenantTx(async (tx) => {
      const finalized = await this.state.finalize(tx, input.messageId, input.attempt, {
        status: input.status,
        errorCode: input.errorCode,
        text: input.text,
        chunkCount: input.chunkCount,
        usage: input.usage,
      });
      // Спроба платна незалежно від того, чи ми ще власники рядка (AI-5b, design.md R3):
      // програний фенсинг лише міняє її результат на `superseded`
      if (input.attemptEntry) {
        await this.ledger.record(tx, [
          finalized ? input.attemptEntry : { ...input.attemptEntry, outcome: 'superseded' },
        ]);
      }
      if (!finalized) {
        return false;
      }

      // Списання квоти (ai-1d, design.md D4) — ПІСЛЯ generation, у ТІЙ САМІЙ транзакції,
      // що й фіналізація рядка. Лише коли `usage` справді є: немає usage — немає що
      // списувати (design.md D6, провалена/зупинена спроба нічого не додає лічильнику)
      if (input.usage) {
        await this.usageQuota.deduct(tx, input.tenantId, input.userId, new Date(), {
          promptTokens: input.usage.promptTokens,
          cachedPromptTokens: input.usage.cachedPromptTokens ?? 0,
          completionTokens: input.usage.completionTokens,
        });
      }

      await tx.aiConversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: new Date() },
      });

      // Після комміту: клієнт, який у відповідь перечитає стрічку, гарантовано
      // побачить фінальний текст, а не той, що був до запису
      this.transactions.onCommit(tx, () => {
        this.logUsage(input.messageId, input.status, input.usage);
        this.realtime.toUser(input.tenantId, input.userId, REALTIME_EVENTS.aiMessageCompleted, {
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
    this.realtime.toUser(tenantId, userId, REALTIME_EVENTS.aiMessageDelta, {
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
