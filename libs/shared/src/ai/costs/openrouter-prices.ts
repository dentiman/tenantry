import { Prisma, type PrismaClient } from '@saas-skeleton/database';
import { z } from 'zod';
import { OPENROUTER_BILLING } from './billing';
import { perTokenToPerMillion, type TariffTier } from './tariff';

/**
 * Синхронізація тарифів з OpenRouter (AI-5b, docs/ai-platform-controls.md §3.3, design.md
 * D5/R7). Два ПУБЛІЧНІ списки без ключа: чат-моделі (`/models`) і embeddings
 * (`/embeddings/models` — у першому їх немає). Ціни — USD за токен рядками → за 1M, Decimal.
 *
 * Одна функція і для cron-а воркера, і для кнопки platform-api: мережа — ДО будь-якого
 * запису (правило 18), потім одне читання останніх рядків і один `createMany` змін.
 */

export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

const priceText = z.string().regex(/^\d+(\.\d+)?$/);

const PricingSchema = z.object({
  prompt: z.string(),
  completion: z.string(),
  request: z.string().optional(),
  input_cache_read: z.string().optional(),
  input_cache_write: z.string().optional(),
  overrides: z
    .array(
      z.object({
        min_prompt_tokens: z.number().int().nonnegative(),
        prompt: z.string().optional(),
        completion: z.string().optional(),
        input_cache_read: z.string().optional(),
        input_cache_write: z.string().optional(),
      }),
    )
    .optional()
    .catch(undefined),
});

const ModelListSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1), pricing: z.unknown() })),
});

export type PriceList = 'models' | 'embeddings';

/** Тариф моделі в нормалізованій формі, ще не записаний */
export interface SyncedPrice {
  readonly model: string;
  readonly inputPerMillion: Prisma.Decimal;
  readonly outputPerMillion: Prisma.Decimal;
  readonly cacheReadPerMillion: Prisma.Decimal | null;
  readonly cacheWritePerMillion: Prisma.Decimal | null;
  readonly requestPrice: Prisma.Decimal;
  readonly tiers: TariffTier[] | null;
}

export interface PriceSyncResult {
  readonly fetchedAt: string;
  /** Нові рядки тарифів (нова модель або змінена ціна) */
  readonly created: number;
  readonly unchanged: number;
  /** Моделі без фіксованої ціни (роутери з `-1`) чи з неочікуваною формою */
  readonly skipped: number;
  /** Збій одного списку не валить інший (design.md R7) */
  readonly errors: readonly { readonly list: PriceList; readonly message: string }[];
}

/**
 * Один запис списку → тариф. `null` — ціни немає або вона не фіксована: роутери на кшталт
 * `openrouter/auto` мають `-1` (ціна залежить від обраної моделі) — такий тариф збрехав би.
 */
export function normalizeOpenRouterPricing(model: string, raw: unknown): SyncedPrice | null {
  const parsed = PricingSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const pricing = parsed.data;
  const fixed = (value: string | undefined): boolean =>
    value === undefined || priceText.safeParse(value).success;
  if (
    !priceText.safeParse(pricing.prompt).success ||
    !priceText.safeParse(pricing.completion).success ||
    !fixed(pricing.request) ||
    !fixed(pricing.input_cache_read) ||
    !fixed(pricing.input_cache_write)
  ) {
    return null;
  }
  const tiers = (pricing.overrides ?? [])
    .filter(
      (tier) =>
        fixed(tier.prompt) &&
        fixed(tier.completion) &&
        fixed(tier.input_cache_read) &&
        fixed(tier.input_cache_write),
    )
    .map((tier): TariffTier => ({
      minPromptTokens: tier.min_prompt_tokens,
      ...perMillionField('inputPerMillion', tier.prompt),
      ...perMillionField('outputPerMillion', tier.completion),
      ...perMillionField('cacheReadPerMillion', tier.input_cache_read),
      ...perMillionField('cacheWritePerMillion', tier.input_cache_write),
    }))
    .sort((a, b) => a.minPromptTokens - b.minPromptTokens);
  return {
    model,
    inputPerMillion: perTokenToPerMillion(pricing.prompt),
    outputPerMillion: perTokenToPerMillion(pricing.completion),
    cacheReadPerMillion:
      pricing.input_cache_read !== undefined
        ? perTokenToPerMillion(pricing.input_cache_read)
        : null,
    cacheWritePerMillion:
      pricing.input_cache_write !== undefined
        ? perTokenToPerMillion(pricing.input_cache_write)
        : null,
    // За запит — уже USD за запит, не за токен
    requestPrice: new Prisma.Decimal(pricing.request ?? '0'),
    tiers: tiers.length > 0 ? tiers : null,
  };
}

function perMillionField(
  key: 'inputPerMillion' | 'outputPerMillion' | 'cacheReadPerMillion' | 'cacheWritePerMillion',
  perToken: string | undefined,
): Partial<TariffTier> {
  return perToken === undefined ? {} : { [key]: perTokenToPerMillion(perToken).toString() };
}

/** Чи той самий тариф (ступені — теж: їхня зміна — нова ціна, design.md D5) */
export function samePrice(
  current: {
    readonly inputPerMillion: Prisma.Decimal;
    readonly outputPerMillion: Prisma.Decimal;
    readonly cacheReadPerMillion: Prisma.Decimal | null;
    readonly cacheWritePerMillion: Prisma.Decimal | null;
    readonly requestPrice: Prisma.Decimal;
    readonly tiers: unknown;
  },
  next: SyncedPrice,
): boolean {
  const eq = (a: Prisma.Decimal | null, b: Prisma.Decimal | null): boolean =>
    a === null || b === null ? a === b : a.equals(b);
  return (
    eq(current.inputPerMillion, next.inputPerMillion) &&
    eq(current.outputPerMillion, next.outputPerMillion) &&
    eq(current.cacheReadPerMillion, next.cacheReadPerMillion) &&
    eq(current.cacheWritePerMillion, next.cacheWritePerMillion) &&
    eq(current.requestPrice, next.requestPrice) &&
    canonicalTiers(current.tiers) === canonicalTiers(next.tiers)
  );
}

/** Ступені у порівнюваній формі: числа як Decimal-рядки, порядок за порогом */
function canonicalTiers(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return '[]';
  }
  const normalize = (value: unknown): string | null =>
    typeof value === 'string' ? new Prisma.Decimal(value).toString() : null;
  return JSON.stringify(
    (raw as Record<string, unknown>[])
      .map((tier) => [
        tier.minPromptTokens,
        normalize(tier.inputPerMillion),
        normalize(tier.outputPerMillion),
        normalize(tier.cacheReadPerMillion),
        normalize(tier.cacheWritePerMillion),
      ])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
  );
}

async function fetchList(
  list: PriceList,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<{ prices: SyncedPrice[]; skipped: number }> {
  const path = list === 'models' ? '/models' : '/embeddings/models';
  let response: Response;
  try {
    response = await fetchFn(`${OPENROUTER_API_BASE}${path}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && error.name === 'TimeoutError'
        ? `OpenRouter ${list} list timed out after ${String(timeoutMs)} ms`
        : `OpenRouter ${list} list is unreachable`,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`OpenRouter ${list} list responded ${String(response.status)}`);
  }
  const parsed = ModelListSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new Error(`OpenRouter ${list} list has an unexpected shape`);
  }
  const prices: SyncedPrice[] = [];
  let skipped = 0;
  for (const item of parsed.data.data) {
    const price = normalizeOpenRouterPricing(item.id, item.pricing);
    if (price) {
      prices.push(price);
    } else {
      skipped += 1;
    }
  }
  return { prices, skipped };
}

export interface PriceSyncOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: Date;
  readonly actor?: string | null;
}

/**
 * Синхронізація. Порівняння — з ОСТАННІМ рядком моделі будь-якого джерела (design.md R7):
 * ручний тариф на модель OpenRouter витісняється наступною синхронізацією, якщо ціна інша.
 * Пише лише `saas_platform` (worker system-scope або platform-api).
 */
export async function syncOpenRouterPrices(
  prisma: Pick<PrismaClient, 'aiModelPrice'>,
  options: PriceSyncOptions = {},
): Promise<PriceSyncResult> {
  const fetchFn = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? new Date();

  // Мережа — до будь-якого звернення до БД
  const lists: PriceList[] = ['models', 'embeddings'];
  const results = await Promise.allSettled(
    lists.map((list) => fetchList(list, fetchFn, timeoutMs)),
  );
  const errors: { list: PriceList; message: string }[] = [];
  const byModel = new Map<string, SyncedPrice>();
  let skipped = 0;
  results.forEach((result, index) => {
    const list = lists[index] ?? 'models';
    if (result.status === 'rejected') {
      errors.push({
        list,
        message: result.reason instanceof Error ? result.reason.message : 'unknown error',
      });
      return;
    }
    skipped += result.value.skipped;
    for (const price of result.value.prices) {
      byModel.set(price.model, price);
    }
  });

  let created = 0;
  let unchanged = 0;
  if (byModel.size > 0) {
    const latest = await prisma.aiModelPrice.findMany({
      where: { provider: OPENROUTER_BILLING, model: { in: [...byModel.keys()] } },
      orderBy: [{ model: 'asc' }, { validFrom: 'desc' }],
      distinct: ['model'],
    });
    const current = new Map(latest.map((row) => [row.model, row]));
    const rows: Prisma.AiModelPriceCreateManyInput[] = [];
    for (const price of byModel.values()) {
      const existing = current.get(price.model);
      if (existing && samePrice(existing, price)) {
        unchanged += 1;
        continue;
      }
      rows.push({
        provider: OPENROUTER_BILLING,
        model: price.model,
        inputPerMillion: price.inputPerMillion,
        outputPerMillion: price.outputPerMillion,
        cacheReadPerMillion: price.cacheReadPerMillion,
        cacheWritePerMillion: price.cacheWritePerMillion,
        requestPrice: price.requestPrice,
        tiers: price.tiers ?? Prisma.DbNull,
        validFrom: now,
        source: 'openrouter-sync',
        createdBy: options.actor ?? null,
      });
    }
    if (rows.length > 0) {
      // skipDuplicates: дві одночасні синхронізації (cron і кнопка) в ту саму мілісекунду
      const { count } = await prisma.aiModelPrice.createMany({ data: rows, skipDuplicates: true });
      created = count;
    }
  }

  return { fetchedAt: now.toISOString(), created, unchanged, skipped, errors };
}
