import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';
import { AI_CONFIG, type AiConfig } from './ai.config';

/** Хто з двох рубежів вичерпаний — панель показує їх однаково (design.md D3), але лишається місце розрізнити пізніше */
export type AiUsageQuotaScope = 'user' | 'tenant';

export interface AiUsageDelta {
  readonly promptTokens: number;
  /** Підмножина promptTokens, НЕ додається зверху (design.md D5) */
  readonly cachedPromptTokens: number;
  readonly completionTokens: number;
}

/**
 * Квоти токенів асистента (ai-1d, docs/ai-assistant.md §8, design.md D1–D4).
 *
 * Рівно один рядок на (tenant, user, period) — тенантний підсумок НЕ окремий писаний
 * рядок, а SUM по рядках тенанта за період у момент перевірки (design.md D1): один
 * шлях запису, без ризику розходження.
 *
 * Обидва методи очікують викликача всередині `TenantTransactions.withTenantTx` — RLS
 * і атомарність інкременту залежать від того самого `tx`, що й решта AI-сервісів.
 */
@Injectable()
export class AiUsageQuotaService {
  constructor(@Inject(AI_CONFIG) private readonly config: AiConfig) {}

  /**
   * Перевірка ДО публікації (design.md D3, D4): читає власний рядок юзера і агрегат
   * тенанта за поточний період, повертає перший вичерпаний рубіж або `null` —
   * «можна». Порівняння за принципом «≥ ліміту» — оптимістичне: перевищити можна
   * рівно на один хід, що вже минув цю перевірку (design.md D4, точне формулювання
   * меж перевищення — там само).
   */
  async checkQuota(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    now: Date,
  ): Promise<{ readonly scope: AiUsageQuotaScope } | null> {
    const periodStart = startOfUtcDay(now);

    const [userRow, tenantAgg] = await Promise.all([
      tx.aiUsageCounter.findUnique({
        where: { tenantId_userId_periodStart: { tenantId, userId, periodStart } },
        select: { promptTokens: true, completionTokens: true },
      }),
      tx.aiUsageCounter.aggregate({
        where: { tenantId, periodStart },
        _sum: { promptTokens: true, completionTokens: true },
      }),
    ]);

    const userTotal = (userRow?.promptTokens ?? 0) + (userRow?.completionTokens ?? 0);
    if (userTotal >= this.config.quotaUserDailyTokens) {
      return { scope: 'user' };
    }

    const tenantTotal = (tenantAgg._sum.promptTokens ?? 0) + (tenantAgg._sum.completionTokens ?? 0);
    if (tenantTotal >= this.config.quotaTenantDailyTokens) {
      return { scope: 'tenant' };
    }

    return null;
  }

  /**
   * Списання ПІСЛЯ генерації (design.md D4) — атомарний `INSERT ... ON CONFLICT DO
   * UPDATE` СИРИМ SQL, а не Prisma `upsert()`: під справжнім конкурентним
   * навантаженням (два `deduct()` для того самого (tenant, user, period), що
   * стартують до того, як перший рядок закомічено) Prisma-рушій `upsert()` для
   * композитного унікального ключа спостережувано розганяється в SELECT-потім-
   * INSERT/UPDATE — не атомарно, і другий виклик падає на unique-порушенні замість
   * тихого переходу в DO UPDATE (спіймано e2e-тестом на справжньому Postgres,
   * ai-usage-quota.e2e-spec.ts). Сире `INSERT ... ON CONFLICT` — той самий
   * рядковий лок, яким Postgres і задумав цю гонку розв'язувати.
   *
   * Викликається всередині `withTenantTx` — той самий `tx`, на якому вже стоїть
   * `set_config('app.tenant_id', ...)`, тож RLS (`FOR ALL ... USING/WITH CHECK`)
   * застосовується і до INSERT-, і до UPDATE-гілки конфлікту так само, як до
   * будь-якого іншого запиту в цій транзакції (CLAUDE.md rule 16 стосується сирих
   * запитів ПОЗА `withTenantTx`, не цього випадку).
   */
  async deduct(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    now: Date,
    usage: AiUsageDelta,
  ): Promise<void> {
    const periodStart = startOfUtcDay(now);
    await tx.$executeRaw`
      INSERT INTO ai_usage_counters
        (id, tenant_id, user_id, period_start, prompt_tokens, cached_prompt_tokens, completion_tokens, updated_at)
      VALUES
        (${randomUUID()}, ${tenantId}, ${userId}, ${periodStart}, ${usage.promptTokens}, ${usage.cachedPromptTokens}, ${usage.completionTokens}, now())
      ON CONFLICT (tenant_id, user_id, period_start) DO UPDATE SET
        prompt_tokens = ai_usage_counters.prompt_tokens + EXCLUDED.prompt_tokens,
        cached_prompt_tokens = ai_usage_counters.cached_prompt_tokens + EXCLUDED.cached_prompt_tokens,
        completion_tokens = ai_usage_counters.completion_tokens + EXCLUDED.completion_tokens,
        updated_at = now()
    `;
  }
}

/** Початок доби UTC, якій належить `date` (design.md D2) */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
