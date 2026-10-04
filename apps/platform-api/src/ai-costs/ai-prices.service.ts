import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SystemPrismaService, type AiModelPrice } from '@saas-skeleton/database';
import type {
  AiModelPriceHistoryQuery,
  AiModelPriceHistoryResponse,
  AiModelPriceListResponse,
  AiModelPriceQuery,
  AiModelPriceResponse,
  AiModelPriceSyncResponse,
  CreateAiModelPrice,
} from '@saas-skeleton/contracts/platform';
import { syncOpenRouterPrices } from '@saas-skeleton/shared/ai/costs/openrouter-prices';
import { parseTiers } from '@saas-skeleton/shared/ai/costs/tariff';
import type { PlatformJwtPayload } from '../auth/decorators/current-operator.decorator';

/**
 * Тарифи моделей (AI-5b, docs/ai-platform-controls.md §3.3, design.md D2/R6/R7). Таблиця
 * append-only: ручний тариф і синхронізація лише ДОДАЮТЬ рядки, тариф на момент T — останній
 * з `valid_from ≤ T`. Пише control plane під `saas_platform`.
 */
@Injectable()
export class AiPricesService {
  private readonly logger = new Logger(AiPricesService.name);

  constructor(private readonly prisma: SystemPrismaService) {}

  /** Чинні тарифи: останній рядок кожної пари (провайдер, модель) з `valid_from ≤ зараз` */
  async list(query: AiModelPriceQuery): Promise<AiModelPriceListResponse> {
    const { page, limit } = query;
    const now = new Date();
    const filters = [Prisma.sql`p.valid_from <= ${now}`];
    if (query.search) {
      filters.push(Prisma.sql`p.model ILIKE ${`%${escapeLike(query.search)}%`}`);
    }
    if (query.provider) {
      filters.push(Prisma.sql`p.provider = ${query.provider.toLowerCase()}`);
    }
    const where = Prisma.join(filters, ' AND ');
    const current = Prisma.sql`
      SELECT DISTINCT ON (p.provider, p.model) p.id
      FROM ai_model_prices p WHERE ${where}
      ORDER BY p.provider, p.model, p.valid_from DESC`;

    const [ids, counted] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM (${current}) c JOIN ai_model_prices p ON p.id = c.id
        ORDER BY p.provider, p.model
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (${current}) c`,
    ]);
    const rows = await this.prisma.aiModelPrice.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      orderBy: [{ provider: 'asc' }, { model: 'asc' }],
    });
    const total = Number(counted[0]?.n ?? 0);
    return {
      items: rows.map(toResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Уся історія ціни моделі, новіші першими (включно з майбутніми ручними) */
  async history(query: AiModelPriceHistoryQuery): Promise<AiModelPriceHistoryResponse> {
    const rows = await this.prisma.aiModelPrice.findMany({
      where: { provider: query.provider.toLowerCase(), model: query.model },
      orderBy: { validFrom: 'desc' },
    });
    return { items: rows.map(toResponse) };
  }

  async create(
    data: CreateAiModelPrice,
    operator: PlatformJwtPayload,
  ): Promise<AiModelPriceResponse> {
    const row = await this.prisma.aiModelPrice.create({
      data: {
        provider: data.provider,
        model: data.model,
        inputPerMillion: new Prisma.Decimal(data.inputPerMillion),
        outputPerMillion: new Prisma.Decimal(data.outputPerMillion),
        cacheReadPerMillion:
          data.cacheReadPerMillion != null ? new Prisma.Decimal(data.cacheReadPerMillion) : null,
        cacheWritePerMillion:
          data.cacheWritePerMillion != null ? new Prisma.Decimal(data.cacheWritePerMillion) : null,
        requestPrice: new Prisma.Decimal(data.requestPrice ?? '0'),
        validFrom: data.validFrom ? new Date(data.validFrom) : new Date(),
        source: 'manual',
        createdBy: operator.email,
      },
    });
    this.logger.log(`AI model price added by ${operator.email}: ${row.provider} ${row.model}`);
    return toResponse(row);
  }

  /** Кнопка «Sync» — та сама функція, що щоденний cron воркера (design.md R7) */
  async sync(operator: PlatformJwtPayload): Promise<AiModelPriceSyncResponse> {
    const result = await syncOpenRouterPrices(this.prisma, { actor: operator.email });
    this.logger.log(
      `AI model prices synced by ${operator.email}: ${String(result.created)} new, ${String(result.errors.length)} list errors`,
    );
    return { ...result, errors: [...result.errors] };
  }
}

function toResponse(row: AiModelPrice): AiModelPriceResponse {
  const tiers = parseTiers(row.tiers);
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    inputPerMillion: row.inputPerMillion.toString(),
    outputPerMillion: row.outputPerMillion.toString(),
    cacheReadPerMillion: row.cacheReadPerMillion?.toString() ?? null,
    cacheWritePerMillion: row.cacheWritePerMillion?.toString() ?? null,
    requestPrice: row.requestPrice.toString(),
    tiers: tiers.length > 0 ? tiers : null,
    currency: 'USD',
    validFrom: row.validFrom.toISOString(),
    source: row.source === 'manual' ? 'manual' : 'openrouter-sync',
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
