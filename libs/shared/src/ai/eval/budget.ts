import { getEncoding } from 'js-tiktoken';
import { Prisma } from '@saas-skeleton/database';
import { FAKE_BILLING } from '../costs/billing';
import { estimateCost, type TariffPrices } from '../costs/tariff';
import type { LlmMessage } from '../llm/llm-provider';
import { JUDGE_MAX_OUTPUT_TOKENS } from './judge';

/**
 * Бюджет eval відповідей (AI-5c, design.md D6/I8): оцінка ДО старту за тарифами (верхня
 * межа: повний контекст фрагментів і повний ліміт виходу) і живий запобіжник під час прогону.
 * Гроші — лише `Prisma.Decimal`.
 */

type Decimal = Prisma.Decimal;

const tokenizer = getEncoding('cl100k_base');

/** Службові токени на повідомлення чату (роль, розмітка) — груба, але стабільна надбавка */
const MESSAGE_OVERHEAD_TOKENS = 4;
/** Заголовок блоку фрагментів, якого немає в промпті-заготовці без фрагментів */
const EXCERPT_BLOCK_TOKENS = 80;
/** Інструкції судді й обгортка питання/відповіді */
const JUDGE_OVERHEAD_TOKENS = 600;

export function countTokens(text: string): number {
  return tokenizer.encode(text).length;
}

export function promptTokens(messages: readonly LlmMessage[]): number {
  return messages.reduce(
    (sum, message) => sum + countTokens(message.content) + MESSAGE_OVERHEAD_TOKENS,
    0,
  );
}

export interface CallEstimate {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Генерація: промпт без фрагментів (межі, організація, контекст, історія, питання) +
 * `maxContextTokens` + заголовок блоку; вихід — увесь ліміт
 */
export function generationEstimate(
  messagesWithoutExcerpts: readonly LlmMessage[],
  maxContextTokens: number,
  maxOutputTokens: number,
): CallEstimate {
  return {
    inputTokens: promptTokens(messagesWithoutExcerpts) + maxContextTokens + EXCERPT_BLOCK_TOKENS,
    outputTokens: maxOutputTokens,
  };
}

/** Суддя бачить те саме (питання, фрагменти) плюс відповідь до повного ліміту */
export function judgeEstimate(generation: CallEstimate): CallEstimate {
  return {
    inputTokens: generation.inputTokens + generation.outputTokens + JUDGE_OVERHEAD_TOKENS,
    outputTokens: JUDGE_MAX_OUTPUT_TOKENS,
  };
}

export function callCost(estimate: CallEstimate, tariff: TariffPrices): Decimal {
  return (
    estimateCost(
      {
        inputTokens: estimate.inputTokens,
        cachedReadTokens: null,
        cacheWriteTokens: null,
        outputTokens: estimate.outputTokens,
      },
      tariff,
    ) ?? new Prisma.Decimal(0)
  );
}

/** Модель-кандидат чи суддя без тарифу: оцінка неможлива, прогін не стартує (design.md, 5a) */
export class MissingTariffError extends Error {
  constructor(
    readonly provider: string,
    readonly model: string,
  ) {
    super(
      `No price for ${provider} / ${model} in ai_model_prices — the cost of the run cannot be estimated. ` +
        'Sync prices (platform-web → AI → Prices → Sync with OpenRouter, or the ai.sync-model-prices cron) ' +
        'or add a manual price, then run again.',
    );
    this.name = 'MissingTariffError';
  }
}

/** Тариф для оцінки: `fake` — безкоштовний і тарифу не потребує */
export async function requireTariff(
  provider: string,
  model: string,
  find: (provider: string, model: string) => Promise<TariffPrices | null>,
): Promise<TariffPrices | null> {
  if (provider === FAKE_BILLING) return null;
  const tariff = await find(provider, model);
  if (!tariff) throw new MissingTariffError(provider, model);
  return tariff;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly estimate: Decimal,
    readonly limit: Decimal,
  ) {
    super(
      `Estimated cost ${estimate.toFixed()} USD exceeds --max-cost ${limit.toFixed()} USD; nothing was called.`,
    );
    this.name = 'BudgetExceededError';
  }
}

/** Живий запобіжник: сума відомих витрат прогону проти ліміту (`null` — без ліміту, лише fake) */
export class BudgetGuard {
  private spentSoFar = new Prisma.Decimal(0);

  constructor(readonly limit: Decimal | null) {}

  add(cost: Decimal): void {
    this.spentSoFar = this.spentSoFar.add(cost);
  }

  get spent(): Decimal {
    return this.spentSoFar;
  }

  /** Перетнули ліміт — далі не викликаємо нічого */
  get exceeded(): boolean {
    return this.limit !== null && this.spentSoFar.gte(this.limit);
  }

  /** Перевірка оцінки до старту */
  assertEstimate(estimate: Decimal): void {
    if (this.limit !== null && estimate.gt(this.limit)) {
      throw new BudgetExceededError(estimate, this.limit);
    }
  }
}
