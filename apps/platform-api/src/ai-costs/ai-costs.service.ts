import { Injectable } from '@nestjs/common';
import { Prisma, SystemPrismaService } from '@saas-skeleton/database';
import type {
  AiUsageEvent,
  AiUsageEventListResponse,
  AiUsageEventQuery,
  AiUsageKind,
  AiCostStatus,
  PlatformAiCostTotals,
  PlatformAiCostsBreakdownQuery,
  PlatformAiCostsBreakdownResponse,
  PlatformAiCostsQuery,
  PlatformAiCostsSummaryResponse,
} from '@saas-skeleton/contracts/platform';

/**
 * Звітність суперадміна за журналом витрат (AI-5b, docs/ai-platform-controls.md §3.5,
 * design.md D6/R10). Крос-tenant читання — лише тут, через `SystemPrismaService`
 * (BYPASSRLS). Рахується на льоту з `ai_usage_events` за індексом `(occurred_at)`; денних
 * агрегатів немає, поки виміряно не стане повільно (рішення власника, design.md).
 *
 * Гроші SQL повертає `::text` — без проходу через float ні в драйвері, ні в JS.
 */

/** Сирий рядок підсумків: токени — bigint (сума може перевищити int), гроші — text */
interface TotalsRow {
  calls: bigint;
  input_tokens: bigint;
  cached_read_tokens: bigint;
  cache_write_tokens: bigint;
  output_tokens: bigint;
  reasoning_tokens: bigint;
  reported_cost: string;
  estimated_cost: string;
  cost: string;
}

const TOTALS = Prisma.sql`
  count(*) AS calls,
  coalesce(sum(e.input_tokens), 0)::bigint AS input_tokens,
  coalesce(sum(e.cached_read_tokens), 0)::bigint AS cached_read_tokens,
  coalesce(sum(e.cache_write_tokens), 0)::bigint AS cache_write_tokens,
  coalesce(sum(e.output_tokens), 0)::bigint AS output_tokens,
  coalesce(sum(e.reasoning_tokens), 0)::bigint AS reasoning_tokens,
  coalesce(sum(e.reported_cost), 0)::text AS reported_cost,
  coalesce(sum(e.estimated_cost), 0)::text AS estimated_cost,
  coalesce(sum(coalesce(e.reported_cost, e.estimated_cost)), 0)::text AS cost`;

function totals(row: TotalsRow | undefined): PlatformAiCostTotals {
  return {
    calls: Number(row?.calls ?? 0),
    inputTokens: Number(row?.input_tokens ?? 0),
    cachedReadTokens: Number(row?.cached_read_tokens ?? 0),
    cacheWriteTokens: Number(row?.cache_write_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    reasoningTokens: Number(row?.reasoning_tokens ?? 0),
    reportedCost: money(row?.reported_cost),
    estimatedCost: money(row?.estimated_cost),
    cost: money(row?.cost),
  };
}

/** `NUMERIC::text` → канонічний десятковий рядок (без хвостових нулів) */
function money(value: string | null | undefined): string {
  return value == null ? '0' : new Prisma.Decimal(value).toString();
}

/** Як `money()`, але для одного рядка журналу: `null` лишається `null` (невідомо, не нуль) */
function moneyOrNull(value: string | null | undefined): string | null {
  return value == null ? null : new Prisma.Decimal(value).toString();
}

@Injectable()
export class AiCostsService {
  constructor(private readonly prisma: SystemPrismaService) {}

  async summary(query: PlatformAiCostsQuery): Promise<PlatformAiCostsSummaryResponse> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const period = Prisma.sql`e.occurred_at >= ${from} AND e.occurred_at < ${to}`;

    const [totalsRows, statusRows, replyRows, retriedRows, cacheRows, reconcileRows] =
      await Promise.all([
        this.prisma.$queryRaw<TotalsRow[]>`SELECT ${TOTALS} FROM ai_usage_events e WHERE ${period}`,
        this.prisma.$queryRaw<{ cost_status: string; n: bigint }[]>`
          SELECT e.cost_status, count(*) AS n FROM ai_usage_events e WHERE ${period}
          GROUP BY e.cost_status`,
        // Відповідь = усі рядки з її message_id (спроби + embedding питання); результат
        // відповіді — outcome її ОСТАННЬОЇ спроби генерації
        this.prisma.$queryRaw<
          {
            replies: bigint;
            completed: bigint;
            average_completed: string | null;
            failed_spend: string | null;
          }[]
        >`
          WITH reply AS (
            SELECT e.tenant_id, e.message_id,
              sum(coalesce(e.reported_cost, e.estimated_cost)) AS cost,
              (array_agg(e.outcome ORDER BY e.attempt DESC NULLS LAST)
                FILTER (WHERE e.kind = 'generation'))[1] AS last_outcome
            FROM ai_usage_events e
            WHERE ${period} AND e.message_id IS NOT NULL
            GROUP BY e.tenant_id, e.message_id
          )
          SELECT
            count(*) FILTER (WHERE last_outcome IS NOT NULL) AS replies,
            count(*) FILTER (WHERE last_outcome = 'complete') AS completed,
            (avg(cost) FILTER (WHERE last_outcome = 'complete'))::text AS average_completed,
            (sum(cost) FILTER (WHERE last_outcome IS NOT NULL AND last_outcome <> 'complete'))::text
              AS failed_spend
          FROM reply`,
        this.prisma.$queryRaw<{ spend: string | null }[]>`
          SELECT sum(coalesce(e.reported_cost, e.estimated_cost))::text AS spend
          FROM ai_usage_events e
          WHERE ${period} AND e.kind = 'generation'
            AND e.outcome IN ('retried', 'superseded', 'abandoned')`,
        // Базові ціни тарифу, замороженого в рядку; ступені тут не враховано (наближення,
        // docs/ai-platform-controls.md §7)
        this.prisma.$queryRaw<{ savings: string | null }[]>`
          SELECT sum(
            e.cached_read_tokens
              * (p.input_per_million - coalesce(p.cache_read_per_million, p.input_per_million))
              / 1000000
          )::text AS savings
          FROM ai_usage_events e JOIN ai_model_prices p ON p.id = e.price_id
          WHERE ${period} AND e.cached_read_tokens > 0`,
        this.prisma.$queryRaw<
          { rows: bigint; reported: string | null; estimated: string | null }[]
        >`
          SELECT count(*) AS rows, sum(e.reported_cost)::text AS reported,
            sum(e.estimated_cost)::text AS estimated
          FROM ai_usage_events e
          WHERE ${period} AND e.reported_cost IS NOT NULL AND e.estimated_cost IS NOT NULL`,
      ]);

    const status = { reported: 0, estimated: 0, pending: 0, unknown: 0 };
    for (const row of statusRows) {
      if (row.cost_status in status) {
        status[row.cost_status as keyof typeof status] = Number(row.n);
      }
    }
    const reply = replyRows[0];
    const reconcile = reconcileRows[0];
    const reported = new Prisma.Decimal(reconcile?.reported ?? 0);
    const estimated = new Prisma.Decimal(reconcile?.estimated ?? 0);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      currency: 'USD',
      totals: totals(totalsRows[0]),
      status,
      replies: {
        count: Number(reply?.replies ?? 0),
        completed: Number(reply?.completed ?? 0),
        averageCompletedCost:
          reply?.average_completed != null
            ? new Prisma.Decimal(reply.average_completed).toDecimalPlaces(10).toString()
            : null,
        failedSpend: money(reply?.failed_spend),
        retriedSpend: money(retriedRows[0]?.spend),
      },
      cacheSavings: money(
        cacheRows[0]?.savings != null
          ? new Prisma.Decimal(cacheRows[0].savings).toDecimalPlaces(10).toString()
          : null,
      ),
      reconciliation: {
        rows: Number(reconcile?.rows ?? 0),
        reportedCost: reported.toString(),
        estimatedCost: estimated.toString(),
        difference: reported.sub(estimated).toString(),
      },
    };
  }

  async breakdown(query: PlatformAiCostsBreakdownQuery): Promise<PlatformAiCostsBreakdownResponse> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const period = Prisma.sql`e.occurred_at >= ${from} AND e.occurred_at < ${to}`;
    type Row = TotalsRow & { key: string; label: string };

    let rows: Row[];
    switch (query.by) {
      case 'tenant':
        rows = await this.prisma.$queryRaw<Row[]>`
          SELECT e.tenant_id AS key, coalesce(min(t.name), e.tenant_id) AS label, ${TOTALS}
          FROM ai_usage_events e LEFT JOIN tenants t ON t.id = e.tenant_id
          WHERE ${period} GROUP BY e.tenant_id ORDER BY sum(coalesce(e.reported_cost, e.estimated_cost)) DESC NULLS LAST, key`;
        break;
      case 'model':
        rows = await this.prisma.$queryRaw<Row[]>`
          SELECT e.provider || ' ' || e.model AS key, e.model || ' (' || e.provider || ')' AS label,
            ${TOTALS}
          FROM ai_usage_events e
          WHERE ${period} GROUP BY e.provider, e.model ORDER BY sum(coalesce(e.reported_cost, e.estimated_cost)) DESC NULLS LAST, key`;
        break;
      case 'kind':
        rows = await this.prisma.$queryRaw<Row[]>`
          SELECT e.kind AS key, e.kind AS label, ${TOTALS}
          FROM ai_usage_events e
          WHERE ${period} GROUP BY e.kind ORDER BY key`;
        break;
      case 'day':
        rows = await this.prisma.$queryRaw<Row[]>`
          SELECT to_char(date_trunc('day', e.occurred_at), 'YYYY-MM-DD') AS key,
            to_char(date_trunc('day', e.occurred_at), 'YYYY-MM-DD') AS label, ${TOTALS}
          FROM ai_usage_events e
          WHERE ${period} GROUP BY date_trunc('day', e.occurred_at) ORDER BY key`;
        break;
    }

    return {
      by: query.by,
      items: rows.map((row) => ({ key: row.key, label: row.label, ...totals(row) })),
    };
  }

  /** Сирий рядок журналу для `events()`: гроші — `::text`, `total` — вікно на всю вибірку */
  private async eventRows(query: AiUsageEventQuery): Promise<{ rows: EventRow[]; total: number }> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const limit = query.limit;
    const offset = (query.page - 1) * limit;

    const conditions = [Prisma.sql`e.occurred_at >= ${from} AND e.occurred_at < ${to}`];
    if (query.tenantId) {
      conditions.push(Prisma.sql`e.tenant_id = ${query.tenantId}`);
    }
    if (query.kind) {
      conditions.push(Prisma.sql`e.kind = ${query.kind}`);
    }
    if (query.costStatus) {
      conditions.push(Prisma.sql`e.cost_status = ${query.costStatus}`);
    }
    if (query.search) {
      const like = `%${query.search}%`;
      conditions.push(
        Prisma.sql`(e.model ILIKE ${like} OR e.source_id ILIKE ${like} OR e.message_id ILIKE ${like})`,
      );
    }
    const where = Prisma.join(conditions, ' AND ');

    const rows = await this.prisma.$queryRaw<EventRow[]>`
      SELECT e.id, e.tenant_id, coalesce(t.name, e.tenant_id) AS tenant_label,
        e.occurred_at, e.kind, e.outcome, e.user_id, e.message_id, e.source_id, e.attempt,
        e.provider, e.model, e.input_tokens, e.cached_read_tokens, e.cache_write_tokens,
        e.output_tokens, e.reasoning_tokens, e.reported_cost::text AS reported_cost,
        e.estimated_cost::text AS estimated_cost, e.cost_status, e.provider_request_id,
        count(*) OVER()::bigint AS total
      FROM ai_usage_events e LEFT JOIN tenants t ON t.id = e.tenant_id
      WHERE ${where}
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT ${limit} OFFSET ${offset}`;

    return { rows, total: Number(rows[0]?.total ?? 0) };
  }

  /**
   * Окремі рядки журналу (не зведення) — для розбору конкретних викликів, напр. звірка з
   * прогоном `pnpm ai:answers:eval` за `source_id`. Той самий період-фільтр, що в summary/
   * breakdown; сортування фіксоване — найновіші перші.
   */
  async events(query: AiUsageEventQuery): Promise<AiUsageEventListResponse> {
    const { rows, total } = await this.eventRows(query);
    return {
      items: rows.map((row): AiUsageEvent => ({
        id: row.id,
        tenantId: row.tenant_id,
        tenantLabel: row.tenant_label,
        occurredAt: row.occurred_at.toISOString(),
        kind: row.kind as AiUsageKind,
        outcome: row.outcome,
        userId: row.user_id,
        messageId: row.message_id,
        sourceId: row.source_id,
        attempt: row.attempt,
        provider: row.provider,
        model: row.model,
        inputTokens: row.input_tokens,
        cachedReadTokens: row.cached_read_tokens,
        cacheWriteTokens: row.cache_write_tokens,
        outputTokens: row.output_tokens,
        reasoningTokens: row.reasoning_tokens,
        reportedCost: moneyOrNull(row.reported_cost),
        estimatedCost: moneyOrNull(row.estimated_cost),
        cost: moneyOrNull(row.reported_cost ?? row.estimated_cost),
        costStatus: row.cost_status as AiCostStatus,
        providerRequestId: row.provider_request_id,
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }
}

interface EventRow {
  id: string;
  tenant_id: string;
  tenant_label: string;
  occurred_at: Date;
  kind: string;
  outcome: string;
  user_id: string | null;
  message_id: string | null;
  source_id: string | null;
  attempt: number | null;
  provider: string;
  model: string;
  input_tokens: number | null;
  cached_read_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  reported_cost: string | null;
  estimated_cost: string | null;
  cost_status: string;
  provider_request_id: string | null;
  total: bigint;
}
