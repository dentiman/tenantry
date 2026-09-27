import { describe, expect, it } from 'vitest';
import { createLlmProvider } from './ai-llm.module';
import { loadAiConfig } from './ai.config';
import { FakeLlmProvider } from './llm/fake-llm.provider';
import { LlmProviderError } from './llm/llm-provider';
import { OpenAiCompatProvider } from './llm/openai-compat.provider';

/** Вибір провайдера за конфігом (ai-1a, design.md D5) — без мережі: конструктор лише будує клієнт */
describe('createLlmProvider', () => {
  const OPENAI_COMPAT = {
    AI_ENABLED: 'true',
    AI_PROVIDER: 'openai-compat',
    AI_BASE_URL: 'https://openrouter.ai/api/v1',
    AI_API_KEY: 'sk-or-test',
    AI_MODEL: 'openai/gpt-5.6-luna',
  };

  it('за замовчуванням — FakeLlmProvider', () => {
    expect(createLlmProvider(loadAiConfig({}))).toBeInstanceOf(FakeLlmProvider);
  });

  it('openai-compat з повним конфігом — OpenAiCompatProvider', () => {
    expect(createLlmProvider(loadAiConfig(OPENAI_COMPAT))).toBeInstanceOf(OpenAiCompatProvider);
  });

  it('увімкнений openai-compat без ключа валить старт з іменем AI_API_KEY', () => {
    const config = loadAiConfig({ ...OPENAI_COMPAT, AI_API_KEY: '' });
    expect(() => createLlmProvider(config)).toThrow(/AI_API_KEY: required/);
  });

  it('вимкнений openai-compat без ключа піднімається, а кожен виклик — НЕ-ретрай-придатна відмова', async () => {
    const provider = createLlmProvider(loadAiConfig({ AI_PROVIDER: 'openai-compat' }));
    const iterate = async (): Promise<void> => {
      for await (const chunk of provider.generate(
        { messages: [], model: 'x', maxOutputTokens: 1 },
        new AbortController().signal,
      )) {
        expect.unreachable(`unexpected chunk ${chunk.text}`);
      }
    };
    await expect(iterate()).rejects.toBeInstanceOf(LlmProviderError);
    await expect(iterate()).rejects.toMatchObject({ retryable: false });
  });
});
