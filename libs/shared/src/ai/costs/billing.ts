/**
 * Білінговий ключ провайдера (AI-5b, design.md R1): ним позначено і рядок журналу, і тариф.
 * Не назва класу провайдера, а той, хто виставляє рахунок: один `OpenAiCompatProvider`
 * ходить і в OpenRouter, і в DeepSeek, а платимо ми різним компаніям за різними цінами.
 */
export const OPENROUTER_BILLING = 'openrouter';
export const FAKE_BILLING = 'fake';

const OPENROUTER_HOST = 'openrouter.ai';

/**
 * `fake` → `fake`; OpenAI-сумісний бекенд на `openrouter.ai` → `openrouter`; будь-який інший —
 * хост base URL (`api.deepseek.com`): для нього тарифи вводяться вручну.
 */
export function billingProviderFor(
  provider: 'fake' | 'openai-compat',
  baseUrl: string | null | undefined,
): string {
  if (provider === 'fake') {
    return FAKE_BILLING;
  }
  const host = hostOf(baseUrl);
  if (host === null) {
    return 'unknown';
  }
  return isOpenRouterHost(host) ? OPENROUTER_BILLING : host;
}

export function isOpenRouterHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === OPENROUTER_HOST || normalized.endsWith(`.${OPENROUTER_HOST}`);
}

/**
 * Чи повертає провайдер фактичну вартість сам. Такому тариф не обов'язковий; іншим модель
 * без тарифу активувати не можна (design.md R8)
 */
export function reportsCost(billingProvider: string): boolean {
  return billingProvider === OPENROUTER_BILLING || billingProvider === FAKE_BILLING;
}

function hostOf(baseUrl: string | null | undefined): string | null {
  if (!baseUrl) {
    return null;
  }
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}
