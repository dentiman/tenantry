import { Injectable } from '@nestjs/common';
import { Prisma } from '@saas-skeleton/database';
import type { LlmUsage } from '../llm/llm-provider';
import { OPENROUTER_BILLING } from './billing';
import { estimateCost, type UsageTokens } from './tariff';

/**
 * Журнал витрат AI (AI-5b, docs/ai-platform-controls.md §3.2, design.md R1–R4).
 *
 * Один рядок на платний виклик провайдера. Пише ЛИШЕ в транзакцію викликача (`tx` — завжди
 * перший аргумент, як у `publish`): рядок спроби комітиться разом із переходом стану
 * відповіді, а не окремо від нього. Сам провайдера не викликає — і не має: виклик моделі
 * всередині транзакції заборонений (правило 18).
 *
 * Розрахункова вартість заморожується тут, за тарифом, чинним на `occurredAt`, і далі не
 * переписується (добір дописує її лише туди, де вона ще NULL — design.md R5).
 */

export type UsageKind = 'generation' | 'query_embedding' | 'ingest_embedding' | 'eval';

/** design.md R2: один kind `generation` на всі спроби, а різниця — в `outcome` */
export type UsageOutcome =
  'complete' | 'failed' | 'cancelled' | 'timeout' | 'retried' | 'superseded' | 'abandoned';

export type CostStatus = 'reported' | 'estimated' | 'pending' | 'unknown';

export interface LedgerTokens extends UsageTokens {
  readonly reasoningTokens: number | null;
}

export interface UsageEntry {
  readonly kind: UsageKind;
  readonly outcome: UsageOutcome;
  readonly occurredAt?: Date;
  readonly userId?: string | null;
  readonly messageId?: string | null;
  readonly sourceId?: string | null;
  readonly attempt?: number | null;
  /** Білінговий ключ (`billingProviderFor`) */
  readonly provider: string;
  /** Модель, як її назвав провайдер; без usage — запитана */
  readonly model: string;
  /** Запитана модель — запасний ключ тарифу, якщо роутер назвав модель інакше */
  readonly requestedModel?: string;
  /** `null` — usage немає (Stop, обрив, падіння) */
  readonly tokens: LedgerTokens | null;
  readonly reportedCost: string | null;
  readonly requestId: string | null;
}

/** Перша спроба добору — через хвилину: OpenRouter публікує запис генерації не миттєво */
export const FIRST_RECONCILE_DELAY_MS = 60_000;

/**
 * Статус вартості (design.md R4): провайдер назвав суму → `reported`; є токени без суми, і
 * добрати нема в кого → `estimated`; OpenRouter без суми, але з id запиту → `pending` (добір
 * через `GET /generation`); інакше — `unknown`.
 */
export function costStatusFor(
  entry: Pick<UsageEntry, 'provider' | 'tokens' | 'reportedCost' | 'requestId'>,
): CostStatus {
  if (entry.reportedCost !== null) {
    return 'reported';
  }
  if (entry.provider === OPENROUTER_BILLING && entry.requestId !== null) {
    return 'pending';
  }
  return entry.tokens !== null ? 'estimated' : 'unknown';
}

/** `LlmUsage` спроби → токени журналу; `null` — usage-кадру не було */
export function ledgerTokensFromLlm(usage: LlmUsage | null): LedgerTokens | null {
  if (!usage) {
    return null;
  }
  return {
    inputTokens: usage.promptTokens,
    cachedReadTokens: usage.cachedPromptTokens ?? null,
    cacheWriteTokens: usage.cacheWriteTokens ?? null,
    outputTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens ?? null,
  };
}

/** Токени embedding-виклику: лише вхід, виходу немає (0, а не невідомо) */
export function ledgerTokensForEmbedding(inputTokens: number): LedgerTokens {
  return {
    inputTokens,
    cachedReadTokens: null,
    cacheWriteTokens: null,
    outputTokens: 0,
    reasoningTokens: null,
  };
}

@Injectable()
export class AiUsageLedger {
  async record(tx: Prisma.TransactionClient, entries: readonly UsageEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const rows: Prisma.AiUsageEventCreateManyInput[] = [];
    for (const entry of entries) {
      const occurredAt = entry.occurredAt ?? new Date();
      const tariff = await findTariff(tx, entry.provider, occurredAt, [
        entry.model,
        ...(entry.requestedModel && entry.requestedModel !== entry.model
          ? [entry.requestedModel]
          : []),
      ]);
      const estimated = tariff && entry.tokens ? estimateCost(entry.tokens, tariff) : null;
      const status = costStatusFor(entry);
      rows.push({
        occurredAt,
        kind: entry.kind,
        outcome: entry.outcome,
        userId: entry.userId ?? null,
        messageId: entry.messageId ?? null,
        sourceId: entry.sourceId ?? null,
        attempt: entry.attempt ?? null,
        provider: entry.provider,
        model: entry.model,
        inputTokens: entry.tokens?.inputTokens ?? null,
        cachedReadTokens: entry.tokens?.cachedReadTokens ?? null,
        cacheWriteTokens: entry.tokens?.cacheWriteTokens ?? null,
        outputTokens: entry.tokens?.outputTokens ?? null,
        reasoningTokens: entry.tokens?.reasoningTokens ?? null,
        reportedCost: entry.reportedCost,
        providerRequestId: entry.requestId,
        estimatedCost: estimated,
        priceId: estimated !== null && tariff ? tariff.id : null,
        costStatus: status,
        reconcileAfter:
          status === 'pending' ? new Date(occurredAt.getTime() + FIRST_RECONCILE_DELAY_MS) : null,
      });
    }
    await tx.aiUsageEvent.createMany({ data: rows });
  }
}

/**
 * Тариф на момент T — останній рядок з `valid_from ≤ T` (design.md R6). Моделі — у порядку
 * пріоритету: спершу та, яку назвав провайдер, потім запитана
 */
export async function findTariff(
  tx: Pick<Prisma.TransactionClient, 'aiModelPrice'>,
  provider: string,
  at: Date,
  models: readonly string[],
): Promise<Prisma.AiModelPriceGetPayload<object> | null> {
  for (const model of models) {
    const tariff = await tx.aiModelPrice.findFirst({
      where: { provider, model, validFrom: { lte: at } },
      orderBy: { validFrom: 'desc' },
    });
    if (tariff) {
      return tariff;
    }
  }
  return null;
}
