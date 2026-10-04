import { Prisma } from '@saas-skeleton/database';
import { z } from 'zod';

/**
 * Тариф і розрахункова вартість (AI-5b, docs/ai-platform-controls.md §3.3, design.md D2/R6).
 *
 * Гроші — лише `Prisma.Decimal`, ніколи JS float: ціни OpenRouter — USD за ТОКЕН рядками
 * (`"0.00000002"`), у таблиці — за 1M токенів, і множення/ділення йде десятковою арифметикою.
 */

type Decimal = Prisma.Decimal;

const MILLION = new Prisma.Decimal(1_000_000);

const decimalText = z.string().regex(/^\d+(\.\d+)?$/);

/**
 * Ступінь ціни: від `minPromptTokens` токенів промпту (включно) діють ці ціни замість базових.
 * Відсутнє поле — береться базове (OpenRouter `pricing.overrides` теж не завжди містить усе).
 */
export const TariffTierSchema = z.object({
  minPromptTokens: z.number().int().nonnegative(),
  inputPerMillion: decimalText.optional(),
  outputPerMillion: decimalText.optional(),
  cacheReadPerMillion: decimalText.optional(),
  cacheWritePerMillion: decimalText.optional(),
});
export type TariffTier = z.infer<typeof TariffTierSchema>;

export const TariffTiersSchema = z.array(TariffTierSchema);

/** Те, що потрібно розрахунку з рядка `ai_model_prices` */
export interface TariffPrices {
  readonly inputPerMillion: Decimal;
  readonly outputPerMillion: Decimal;
  /** NULL — кеш не тарифікується окремо: кешовані токени йдуть за ціною input */
  readonly cacheReadPerMillion: Decimal | null;
  readonly cacheWritePerMillion: Decimal | null;
  readonly requestPrice: Decimal;
  readonly tiers: unknown;
}

/** Токени одного виклику, як їх пише журнал. `null` — невідомо */
export interface UsageTokens {
  readonly inputTokens: number | null;
  readonly cachedReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly outputTokens: number | null;
}

/** Зіпсований JSON ступенів не валить запис журналу — розрахунок іде за базовими цінами */
export function parseTiers(raw: unknown): TariffTier[] {
  const parsed = TariffTiersSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
}

/**
 * Ціни, що діють для виклику з `inputTokens` токенів промпту: найвищий ступінь, чий поріг
 * ≤ токенів промпту ЦЬОГО виклику (так рахує OpenRouter, інакше звірка фактичної з
 * розрахунковою давала б хибні розбіжності на довгих промптах).
 */
export function effectivePrices(
  tariff: TariffPrices,
  inputTokens: number,
): Omit<TariffPrices, 'tiers'> {
  const tier = parseTiers(tariff.tiers)
    .filter((candidate) => candidate.minPromptTokens <= inputTokens)
    .sort((a, b) => b.minPromptTokens - a.minPromptTokens)[0];
  if (!tier) {
    return tariff;
  }
  return {
    inputPerMillion: pick(tier.inputPerMillion, tariff.inputPerMillion),
    outputPerMillion: pick(tier.outputPerMillion, tariff.outputPerMillion),
    cacheReadPerMillion:
      tier.cacheReadPerMillion !== undefined
        ? new Prisma.Decimal(tier.cacheReadPerMillion)
        : tariff.cacheReadPerMillion,
    cacheWritePerMillion:
      tier.cacheWritePerMillion !== undefined
        ? new Prisma.Decimal(tier.cacheWritePerMillion)
        : tariff.cacheWritePerMillion,
    requestPrice: tariff.requestPrice,
  };
}

/**
 * `(input − cached_read − cache_write) × input + cached_read × cache_read +
 *  cache_write × cache_write + output × output + за_запит` (reasoning уже в output).
 *
 * `null`, коли токени промпту чи відповіді невідомі: оцінка з нулів збрехала б, що виклик
 * нічого не коштував (design.md R1 — «NULL, коли тарифу чи даних немає, ніколи не 0»).
 */
export function estimateCost(tokens: UsageTokens, tariff: TariffPrices): Decimal | null {
  if (tokens.inputTokens === null || tokens.outputTokens === null) {
    return null;
  }
  const prices = effectivePrices(tariff, tokens.inputTokens);
  const cachedRead = tokens.cachedReadTokens ?? 0;
  const cacheWrite = tokens.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, tokens.inputTokens - cachedRead - cacheWrite);
  const perMillion = new Prisma.Decimal(uncached)
    .mul(prices.inputPerMillion)
    .add(new Prisma.Decimal(cachedRead).mul(prices.cacheReadPerMillion ?? prices.inputPerMillion))
    .add(new Prisma.Decimal(cacheWrite).mul(prices.cacheWritePerMillion ?? prices.inputPerMillion))
    .add(new Prisma.Decimal(tokens.outputTokens).mul(prices.outputPerMillion));
  return perMillion.div(MILLION).add(prices.requestPrice);
}

/**
 * Скільки зекономив кеш: кешовані токени за ціною input мінус за ціною читання з кешу.
 * Нуль, коли кеш окремо не тарифікується або кешованих токенів немає
 */
export function cacheSavings(tokens: UsageTokens, tariff: TariffPrices): Decimal {
  const cachedRead = tokens.cachedReadTokens ?? 0;
  if (cachedRead === 0 || tokens.inputTokens === null) {
    return new Prisma.Decimal(0);
  }
  const prices = effectivePrices(tariff, tokens.inputTokens);
  if (prices.cacheReadPerMillion === null) {
    return new Prisma.Decimal(0);
  }
  return new Prisma.Decimal(cachedRead)
    .mul(prices.inputPerMillion.sub(prices.cacheReadPerMillion))
    .div(MILLION);
}

/** USD за токен (рядок OpenRouter) → USD за 1M токенів, десятково */
export function perTokenToPerMillion(perToken: string): Decimal {
  return new Prisma.Decimal(perToken).mul(MILLION);
}

function pick(value: string | undefined, fallback: Decimal): Decimal {
  return value !== undefined ? new Prisma.Decimal(value) : fallback;
}
