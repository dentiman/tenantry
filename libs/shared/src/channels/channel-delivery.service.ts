import { Injectable, Logger } from '@nestjs/common';
import { TenantTransactions } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';
import type { ChatMessageFailure, ContactAddressKind } from '@saas-skeleton/contracts';
import { CryptoService } from '../crypto/crypto.service';
import { NonRetryableMessageError } from '../messaging/messaging.errors';
import type { ChannelAdapter, ChannelCredentials } from './channel-adapter';
import { ChannelAdapterRegistry } from './channel-adapter-registry';
import { classifySendFailure, type OutboundContext } from './channel-send';
import { replyWindow } from './reply-window';
import { ChannelLogService, last4 } from './channel-log.service';
import { ChannelStatusService, type MessageRef } from './channel-status.service';

/** Скільки разів воркер пробує надіслати одне повідомлення, перш ніж воно стане FAILED */
export const DELIVERY_MAX_ATTEMPTS = 5;
/** Жорсткий таймаут одного виклику провайдера */
export const SEND_TIMEOUT_MS = 15_000;
/** Скільки чекаємо квитанцію з нашим id, перш ніж визнати доставку непідтвердженою (design.md D11) */
export const UNCONFIRMED_WAIT_MS = 60_000;

/**
 * Повторювана відмова: кидається обробнику ПІСЛЯ того, як рядок повернуто в `QUEUED`, щоб pg-boss
 * повторив із backoff. Усі інші кінцеві результати — `FAILED` у рядку, а робота завершується
 * нормально: впала назавжди робота блокувала б строго впорядкований ключ розмови (design.md D2).
 */
export class RetryableDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableDeliveryError';
  }
}

export interface DeliveryResult {
  /** Повідомлення, стан якого змінився й про яке браузер має перечитати; `null` — нічого нового */
  updated: MessageRef[];
}

interface ClaimedMessage {
  id: string;
  conversation_id: string;
  channel_id: string;
  body: string | null;
  payload: unknown;
  attempts: number;
}

interface SendPlan {
  kind: 'send';
  ref: MessageRef;
  adapter: ChannelAdapter;
  creds: ChannelCredentials;
  ctx: Omit<OutboundContext, 'signal'>;
  accountId: string;
  /** Секрети акаунта: їх не має бути в тексті помилки, що йде в журнал */
  secrets: string[];
  channelId: string;
  attempts: number;
}

type ClaimResult = SendPlan | { kind: 'done'; result: DeliveryResult };

/**
 * Доставка одного збереженого вихідного повідомлення (CHAT-2b, design.md D1–D4, D11).
 *
 * Три фази, і виклик провайдера НІКОЛИ не сидить у транзакції (backend-conventions §5):
 * 1. коротка транзакція: умовне захоплення `QUEUED → SENDING`, друга (авторитетна) перевірка
 *    вікна, збір усього потрібного адаптеру;
 * 2. сам `adapter.send` із таймаутом, без транзакції;
 * 3. коротка транзакція: результат — SENT + `external_id` (і запарковані квитанції), або FAILED із
 *    причиною, або повернення в QUEUED + виняток для повтору.
 *
 * Ідемпотентність тримає не inbox-маркер, а САМ рядок: друга робота на те саме повідомлення не
 * захопить його (`status = 'QUEUED'`) і не надішле вдруге.
 */
@Injectable()
export class ChannelDeliveryService {
  private readonly logger = new Logger(ChannelDeliveryService.name);

  constructor(
    private readonly registry: ChannelAdapterRegistry,
    private readonly transactions: TenantTransactions,
    private readonly crypto: CryptoService,
    private readonly statuses: ChannelStatusService,
    private readonly logs: ChannelLogService,
  ) {}

  async deliver(messageId: string): Promise<DeliveryResult> {
    const claim = await this.transactions.withTenantTx((tx) => this.claim(tx, messageId));
    if (claim.kind === 'done') {
      return claim.result;
    }

    let outcome:
      { externalId: string } | { failure: Awaited<ReturnType<typeof classifyForStorage>> };
    const started = Date.now();
    try {
      const { externalId } = await claim.adapter.send(
        { ...claim.ctx, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) },
        claim.creds,
      );
      outcome = { externalId };
    } catch (error) {
      outcome = { failure: classifyForStorage(error) };
    }

    const durationMs = Date.now() - started;
    const settled = await this.transactions.withTenantTx((tx) =>
      this.settle(tx, claim, outcome, durationMs),
    );
    if (settled.retry) {
      // Поза транзакцією: повернення в QUEUED уже закомічено, і виняток його не відкотить
      throw settled.retry;
    }
    return { updated: settled.updated };
  }

  // -------------------------------------------------------------------------
  // Фаза 1: захоплення
  // -------------------------------------------------------------------------

  private async claim(tx: Prisma.TransactionClient, messageId: string): Promise<ClaimResult> {
    const rows = await tx.$queryRaw<ClaimedMessage[]>`
      UPDATE chat_messages
      SET status = 'SENDING', attempts = attempts + 1, sending_started_at = now()
      WHERE id = ${messageId} AND status = 'QUEUED' AND direction = 'OUTBOUND'
      RETURNING id, conversation_id, channel_id, body, payload, attempts`;
    const claimed = rows[0];
    if (!claimed) {
      return { kind: 'done', result: await this.notClaimable(tx, messageId) };
    }

    const ref: MessageRef = { messageId: claimed.id, conversationId: claimed.conversation_id };
    const conversation = await tx.conversation.findUniqueOrThrow({
      where: { id: claimed.conversation_id },
      select: { customerLastMessageAt: true, contactId: true },
    });
    const channel = await tx.channel.findUniqueOrThrow({
      where: { id: claimed.channel_id },
      select: { externalId: true, accountId: true, provider: true },
    });
    const adapter = this.registry.get(channel.provider);
    if (!adapter) {
      // Адаптера під цей provider нема (вимкнений dev-інструмент?): повторювати даремно
      await this.markFailed(tx, claimed.id, {
        class: 'PERMANENT',
        code: 'no_adapter',
        title: 'No adapter is registered for this channel',
      });
      return { kind: 'done', result: { updated: [ref] } };
    }

    // Шаблон — єдиний спосіб писати поза вікном (CHAT-3a): для нього вікно не перевіряється
    const template = templateOf(claimed.payload);

    // Авторитетна перевірка вікна: робота могла простояти в черзі повз межу (design.md D3)
    if (!template && !isFreeformAllowed(adapter, conversation.customerLastMessageAt, new Date())) {
      await this.markFailed(tx, claimed.id, {
        class: 'WINDOW_CLOSED',
        code: 'window_closed',
        title: 'The 24-hour freeform window is closed',
      });
      return { kind: 'done', result: { updated: [ref] } };
    }

    const address = conversation.contactId
      ? await tx.channelContactAddress.findFirst({
          where: { contactId: conversation.contactId },
          orderBy: { createdAt: 'asc' },
          select: { kind: true, value: true },
        })
      : null;
    if (!address || claimed.body === null) {
      await this.markFailed(tx, claimed.id, {
        class: 'PERMANENT',
        code: 'no_recipient',
        title: 'The conversation has no recipient address',
      });
      return { kind: 'done', result: { updated: [ref] } };
    }

    const creds = await this.credentials(tx, channel.accountId);
    return {
      kind: 'send',
      ref,
      adapter,
      creds,
      ctx: {
        channelExternalId: channel.externalId,
        to: { kind: address.kind as ContactAddressKind, value: address.value },
        messageId: claimed.id,
        body: claimed.body,
        ...(template && { template }),
        attempt: claimed.attempts,
      },
      accountId: channel.accountId,
      secrets: [creds.accessToken, creds.appSecret].filter(
        (value): value is string => value !== null,
      ),
      channelId: claimed.channel_id,
      attempts: claimed.attempts,
    };
  }

  /**
   * Рядок не в `QUEUED`: або це вже зроблено (SENT та далі — нічого), або попередня спроба
   * обірвалася посеред відправки (`SENDING` без `external_id`) — тоді НЕ шлемо наосліп (D11).
   */
  private async notClaimable(
    tx: Prisma.TransactionClient,
    messageId: string,
  ): Promise<DeliveryResult> {
    const row = await tx.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        status: true,
        externalId: true,
        sendingStartedAt: true,
        direction: true,
      },
    });
    if (row?.direction !== 'OUTBOUND') {
      throw new NonRetryableMessageError(`Outbound message ${messageId} not found`);
    }
    if (row.status !== 'SENDING' || row.externalId !== null) {
      return { updated: [] };
    }

    const startedAt = row.sendingStartedAt?.getTime() ?? 0;
    if (Date.now() - startedAt < UNCONFIRMED_WAIT_MS) {
      // Це очікування і є повтор: квитанція з нашим id може встигнути й виставити external_id
      throw new RetryableDeliveryError(
        `Delivery of ${messageId} is unconfirmed; waiting for a receipt`,
      );
    }

    const failed = await tx.$executeRaw`
      UPDATE chat_messages
      SET status = 'FAILED',
          failure = ${JSON.stringify({
            class: 'TRANSIENT',
            code: 'outcome_unknown',
            title: 'Delivery could not be confirmed',
            unconfirmed: true,
          } satisfies ChatMessageFailure)}::jsonb
      WHERE id = ${messageId} AND status = 'SENDING' AND external_id IS NULL`;
    this.logger.warn(`Message ${messageId} failed as unconfirmed (no receipt within the wait)`);
    return { updated: failed > 0 ? [{ messageId, conversationId: row.conversationId }] : [] };
  }

  // -------------------------------------------------------------------------
  // Фаза 3: результат
  // -------------------------------------------------------------------------

  private async settle(
    tx: Prisma.TransactionClient,
    plan: SendPlan,
    outcome: { externalId: string } | { failure: StoredFailure },
    durationMs: number,
  ): Promise<DeliveryResult & { retry: RetryableDeliveryError | null }> {
    // Кожна спроба — один запис журналу викликів: що відбулося, але не що було сказано (CHAT-3a)
    await this.logs.record(tx, {
      accountId: plan.accountId,
      operation: 'send',
      ok: 'externalId' in outcome,
      httpStatus: 'externalId' in outcome ? 200 : (outcome.failure.httpStatus ?? null),
      errorCode: 'externalId' in outcome ? null : outcome.failure.failure.code,
      errorTitle: 'externalId' in outcome ? null : outcome.failure.failure.title,
      durationMs,
      messageId: plan.ref.messageId,
      detail: {
        endpoint: `${plan.ctx.channelExternalId}/messages`,
        recipientLast4: last4(plan.ctx.to.value),
        ...('externalId' in outcome && { providerMessageId: outcome.externalId }),
      },
      secrets: plan.secrets,
    });

    if ('externalId' in outcome) {
      // Статус піднімається до SENT лише з QUEUED/SENDING: квитанція за нашим opaque id могла
      // встигнути раніше (DELIVERED/FAILED) — її результат не відкочуємо
      await tx.$executeRaw`
        UPDATE chat_messages
        SET external_id = ${outcome.externalId},
            status = CASE WHEN status IN ('QUEUED', 'SENDING') THEN 'SENT' ELSE status END,
            sent_at = COALESCE(sent_at, now()),
            failure = CASE WHEN status IN ('QUEUED', 'SENDING') THEN NULL ELSE failure END
        WHERE id = ${plan.ref.messageId} AND (external_id IS NULL OR external_id = ${outcome.externalId})`;
      const applied = await this.statuses.applyPending(tx, {
        id: plan.ref.messageId,
        externalId: outcome.externalId,
        channelId: plan.channelId,
      });
      return {
        updated: [plan.ref, ...applied.filter((m) => m.messageId !== plan.ref.messageId)],
        retry: null,
      };
    }

    const { failure } = outcome.failure;
    const retryable = failure.class === 'RATE_LIMITED' || failure.class === 'TRANSIENT';
    if (retryable && plan.attempts < DELIVERY_MAX_ATTEMPTS) {
      await tx.$executeRaw`
        UPDATE chat_messages SET status = 'QUEUED', sending_started_at = NULL
        WHERE id = ${plan.ref.messageId} AND status = 'SENDING'`;
      return {
        updated: [],
        retry: new RetryableDeliveryError(
          `Delivery of ${plan.ref.messageId} failed (${failure.class}); attempt ${String(plan.attempts)}`,
        ),
      };
    }

    await this.markFailed(tx, plan.ref.messageId, failure);
    if (failure.class === 'AUTH') {
      // Облікові дані відхилено: акаунт потребує повторної авторизації (design.md D6)
      await tx.messagingAccount.updateMany({
        where: { id: plan.accountId, status: 'CONNECTED' },
        data: { status: 'NEEDS_REAUTH', lastError: `${failure.code}: ${failure.title}` },
      });
    }
    return { updated: [plan.ref], retry: null };
  }

  private async markFailed(
    tx: Prisma.TransactionClient,
    messageId: string,
    failure: ChatMessageFailure,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE chat_messages SET status = 'FAILED', failure = ${JSON.stringify(failure)}::jsonb
      WHERE id = ${messageId} AND status IN ('QUEUED', 'SENDING')`;
  }

  private async credentials(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<ChannelCredentials> {
    const row = await tx.messagingAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { appSecret: true, credentials: true, verifyToken: true },
    });
    return {
      appSecret: row.appSecret ? this.crypto.decrypt(row.appSecret) : null,
      accessToken: row.credentials ? this.crypto.decrypt(row.credentials) : null,
      verifyToken: row.verifyToken,
    };
  }
}

interface StoredFailure {
  failure: ChatMessageFailure;
  retryAfterSeconds?: number;
  httpStatus?: number;
}

function classifyForStorage(error: unknown): StoredFailure {
  const classified = classifySendFailure(error);
  return {
    failure: { class: classified.errorClass, code: classified.code, title: classified.title },
    ...(classified.retryAfterSeconds !== undefined && {
      retryAfterSeconds: classified.retryAfterSeconds,
    }),
    ...(classified.httpStatus !== undefined && { httpStatus: classified.httpStatus }),
  };
}

/** Шаблон повідомлення (`payload.template`), якщо це шаблон, а не текст */
function templateOf(payload: unknown): { name: string; language: string } | undefined {
  const template = (payload as { template?: { name?: unknown; language?: unknown } } | null)
    ?.template;
  return typeof template?.name === 'string' && typeof template.language === 'string'
    ? { name: template.name, language: template.language }
    : undefined;
}

/** Вікно вільного тексту від ЧАСУ ПРОВАЙДЕРА останнього вхідного; без вікна в провайдера — завжди можна */
export function isFreeformAllowed(
  adapter: Pick<ChannelAdapter, 'capabilities'>,
  customerLastMessageAt: Date | null,
  now: Date,
): boolean {
  return replyWindow(adapter, customerLastMessageAt, now).canReply;
}
