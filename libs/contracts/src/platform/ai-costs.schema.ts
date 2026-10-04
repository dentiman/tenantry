import { z } from 'zod';
import { PaginationQuerySchema, paginatedResponseSchema } from '../pagination/pagination.schema';

/**
 * Журнал витрат AI і тарифи — звітність суперадміна (AI-5b, docs/ai-platform-controls.md §3.5).
 *
 * Гроші на дроті — ДЕСЯТКОВІ РЯДКИ USD, ніколи `number`: значення `NUMERIC(18,10)` не
 * переживають float (design.md R10). Фронт показує їх як є або форматує рядком.
 */
export const MoneySchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'Decimal string');

/** Ціна на вводі: невідʼємна, ≤ 8 цифр до коми й ≤ 10 після — межі `NUMERIC(18,10)` */
export const PriceInputSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,10})?$/, 'Non-negative decimal, up to 10 fractional digits');

export const AiUsageKindSchema = z.enum([
  'generation',
  'query_embedding',
  'ingest_embedding',
  'eval',
]);
export const AiCostStatusSchema = z.enum(['reported', 'estimated', 'pending', 'unknown']);

/** Напіввідкритий період `[from, to)`, не довший за рік — звіт рахується на льоту з журналу */
export const PlatformAiCostsQuerySchema = z
  .object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), {
    message: '`from` must be before `to`',
    path: ['to'],
  })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 24 * 60 * 60 * 1000, {
    message: 'The period must not exceed 366 days',
    path: ['to'],
  });

export const PlatformAiCostsBreakdownBySchema = z.enum(['tenant', 'model', 'kind', 'day']);

export const PlatformAiCostsBreakdownQuerySchema = z
  .object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    by: PlatformAiCostsBreakdownBySchema,
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), {
    message: '`from` must be before `to`',
    path: ['to'],
  })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 24 * 60 * 60 * 1000, {
    message: 'The period must not exceed 366 days',
    path: ['to'],
  });

/** Підсумки групи рядків журналу */
export const PlatformAiCostTotalsSchema = z.object({
  calls: z.number().int(),
  inputTokens: z.number().int(),
  cachedReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  outputTokens: z.number().int(),
  reasoningTokens: z.number().int(),
  /** Сума фактичних вартостей (що списав провайдер) */
  reportedCost: MoneySchema,
  /** Сума розрахункових (токени × тариф) */
  estimatedCost: MoneySchema,
  /** Найкраще відоме: фактична, а без неї — розрахункова */
  cost: MoneySchema,
});

export const PlatformAiCostsSummaryResponseSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  currency: z.literal('USD'),
  totals: PlatformAiCostTotalsSchema,
  /** Скільки рядків у якому стані вартості */
  status: z.object({
    reported: z.number().int(),
    estimated: z.number().int(),
    pending: z.number().int(),
    unknown: z.number().int(),
  }),
  replies: z.object({
    /** Відповіді, що мали хоч одну спробу генерації */
    count: z.number().int(),
    completed: z.number().int(),
    /** Середня вартість завершеної відповіді: усі її спроби + embedding питання */
    averageCompletedCost: MoneySchema.nullable(),
    /** Усе, витрачене на відповіді, що завершились не успіхом (FAILED, CANCELLED, TIMEOUT) */
    failedSpend: MoneySchema,
    /** Спроби, що пішли на ретрай, втратили власність або загинули з воркером */
    retriedSpend: MoneySchema,
  }),
  /** Скільки зекономив кеш провайдера за базовими цінами тарифу */
  cacheSavings: MoneySchema,
  /** Рядки, для яких відомі обидві вартості — звірка «фактична проти розрахункової» */
  reconciliation: z.object({
    rows: z.number().int(),
    reportedCost: MoneySchema,
    estimatedCost: MoneySchema,
    /** Фактична − розрахункова; велике значення — застарілий тариф */
    difference: MoneySchema,
  }),
});

export const PlatformAiCostsBreakdownItemSchema = PlatformAiCostTotalsSchema.extend({
  /** tenant id / `provider model` / kind / `YYYY-MM-DD` (UTC) */
  key: z.string(),
  /** Назва tenant-а, модель із провайдером, kind чи дата */
  label: z.string(),
});

export const PlatformAiCostsBreakdownResponseSchema = z.object({
  by: PlatformAiCostsBreakdownBySchema,
  items: z.array(PlatformAiCostsBreakdownItemSchema),
});

// ------------------------------------------------------------------ тарифи

export const AiModelPriceSourceSchema = z.enum(['openrouter-sync', 'manual']);

export const AiModelPriceTierSchema = z.object({
  minPromptTokens: z.number().int().nonnegative(),
  inputPerMillion: MoneySchema.optional(),
  outputPerMillion: MoneySchema.optional(),
  cacheReadPerMillion: MoneySchema.optional(),
  cacheWritePerMillion: MoneySchema.optional(),
});

export const AiModelPriceResponseSchema = z.object({
  id: z.uuid(),
  /** `openrouter`, `fake` або хост base URL */
  provider: z.string(),
  model: z.string(),
  /** USD за 1M токенів */
  inputPerMillion: MoneySchema,
  outputPerMillion: MoneySchema,
  cacheReadPerMillion: MoneySchema.nullable(),
  cacheWritePerMillion: MoneySchema.nullable(),
  /** USD за запит */
  requestPrice: MoneySchema,
  tiers: z.array(AiModelPriceTierSchema).nullable(),
  currency: z.literal('USD'),
  validFrom: z.iso.datetime(),
  source: AiModelPriceSourceSchema,
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

/** Чинні тарифи (останній рядок кожної пари провайдер + модель) з пошуком */
export const AiModelPriceQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  provider: z.string().trim().max(200).optional(),
});

export const AiModelPriceListResponseSchema = paginatedResponseSchema(AiModelPriceResponseSchema);

export const AiModelPriceHistoryQuerySchema = z.object({
  provider: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(200),
});

export const AiModelPriceHistoryResponseSchema = z.object({
  items: z.array(AiModelPriceResponseSchema),
});

/**
 * Ручний тариф: новий рядок з `validFrom` (дефолт — зараз), історія не переписується. Для
 * моделей OpenRouter наступна синхронізація витіснить ручну ціну, якщо та відрізняється
 */
export const CreateAiModelPriceSchema = z.object({
  provider: z.string().trim().toLowerCase().min(1).max(200),
  model: z.string().trim().min(1).max(200),
  inputPerMillion: PriceInputSchema,
  outputPerMillion: PriceInputSchema,
  cacheReadPerMillion: PriceInputSchema.nullable().optional(),
  cacheWritePerMillion: PriceInputSchema.nullable().optional(),
  requestPrice: PriceInputSchema.optional(),
  validFrom: z.iso.datetime().optional(),
});

export const AiModelPriceSyncResponseSchema = z.object({
  fetchedAt: z.iso.datetime(),
  created: z.number().int(),
  unchanged: z.number().int(),
  skipped: z.number().int(),
  /** Збій одного списку не скасовує інший */
  errors: z.array(z.object({ list: z.enum(['models', 'embeddings']), message: z.string() })),
});
