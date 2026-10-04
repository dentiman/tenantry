import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@saas-skeleton/database';
import { OPENROUTER_BILLING } from './billing';
import type { GenerationLookup } from './openrouter-generation';
import { estimateCost } from './tariff';
import { findTariff } from './usage-ledger';

/**
 * Добір фактичної вартості для рядків `pending` (AI-5b, design.md D4/R5).
 *
 * System scope: крос-tenant, `saas_platform` (BYPASSRLS) — єдиний, кому журнал дозволено
 * UPDATE. Мережевий виклик — ПОЗА будь-якою транзакцією, кожен UPDATE — окремий оператор,
 * умовний на `cost_status = 'pending'`: паралельний добір не перепише вже доібраний рядок.
 */

/** Пауза після N-ї невдалої спроби (1-ша спроба — через хвилину після виклику) */
export const RECONCILE_BACKOFF_MS: readonly number[] = [
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
];
/** Після стількох невдач рядок стає `unknown` і лишає розрахункову вартість */
export const RECONCILE_MAX_ATTEMPTS = RECONCILE_BACKOFF_MS.length + 1;
export const RECONCILE_BATCH = 100;

export interface ReconcileResult {
  readonly checked: number;
  readonly reconciled: number;
  readonly retried: number;
  readonly givenUp: number;
}

/**
 * `lookup` — `null`, коли OpenRouter зараз не налаштовано (немає ключа чи провайдер інший):
 * спроба все одно витрачається, тож без OpenRouter рядки не висять у `pending` вічно.
 */
export async function reconcilePendingUsage(
  prisma: Pick<PrismaClient, 'aiUsageEvent' | 'aiModelPrice'>,
  lookup: ((requestId: string) => Promise<GenerationLookup>) | null,
  now: Date = new Date(),
  logger: Pick<Logger, 'warn'> = new Logger('AiUsageReconcile'),
): Promise<ReconcileResult> {
  const rows = await prisma.aiUsageEvent.findMany({
    where: { costStatus: 'pending', reconcileAfter: { lte: now } },
    orderBy: { reconcileAfter: 'asc' },
    take: RECONCILE_BATCH,
  });
  let reconciled = 0;
  let retried = 0;
  let givenUp = 0;

  for (const row of rows) {
    const result: GenerationLookup =
      row.provider === OPENROUTER_BILLING && row.providerRequestId && lookup
        ? await lookup(row.providerRequestId)
        : { status: 'retry', reason: lookup ? 'not-openrouter' : 'not-configured' };

    if (result.status === 'found') {
      // Модель рядка НЕ перезаписується: запис генерації називає її з датою
      // (`openai/gpt-5.6-luna-20260709`), стрім — без неї, і звіт «за моделлю» розщепився б
      // на дві групи. Назва із запису — лише запасний ключ тарифу
      let estimatedCost = row.estimatedCost;
      let priceId = row.priceId;
      // Заморожена оцінка не переписується (design.md R5): лише туди, де її ще не було
      if (estimatedCost === null) {
        const tariff = await findTariff(prisma, row.provider, row.occurredAt, [
          row.model,
          ...(result.model && result.model !== row.model ? [result.model] : []),
        ]);
        estimatedCost = tariff ? estimateCost(result.tokens, tariff) : null;
        priceId = estimatedCost !== null && tariff ? tariff.id : null;
      }
      const { count } = await prisma.aiUsageEvent.updateMany({
        where: { id: row.id, costStatus: 'pending' },
        data: {
          costStatus: 'reported',
          reportedCost: result.cost,
          inputTokens: result.tokens.inputTokens,
          cachedReadTokens: result.tokens.cachedReadTokens,
          cacheWriteTokens: result.tokens.cacheWriteTokens,
          outputTokens: result.tokens.outputTokens,
          reasoningTokens: result.tokens.reasoningTokens,
          estimatedCost,
          priceId,
          reconcileAttempts: row.reconcileAttempts + 1,
          reconcileAfter: null,
        },
      });
      reconciled += count;
      continue;
    }

    const attempts = row.reconcileAttempts + 1;
    if (attempts >= RECONCILE_MAX_ATTEMPTS) {
      await prisma.aiUsageEvent.updateMany({
        where: { id: row.id, costStatus: 'pending' },
        data: { costStatus: 'unknown', reconcileAttempts: attempts, reconcileAfter: null },
      });
      givenUp += 1;
      logger.warn(
        `AI usage ${row.id}: provider cost unavailable after ${String(attempts)} attempts (${result.reason}) — keeping the estimate`,
      );
      continue;
    }
    await prisma.aiUsageEvent.updateMany({
      where: { id: row.id, costStatus: 'pending' },
      data: {
        reconcileAttempts: attempts,
        reconcileAfter: new Date(now.getTime() + (RECONCILE_BACKOFF_MS[attempts - 1] ?? 0)),
      },
    });
    retried += 1;
  }

  return { checked: rows.length, reconciled, retried, givenUp };
}
