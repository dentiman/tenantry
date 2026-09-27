import { describe, expect, it } from 'vitest';
import { loadAiConfig, requireProviderCredentials } from './ai.config';

describe('loadAiConfig', () => {
  it('без жодної змінної дає вимкнений асистент на фейковому провайдері', () => {
    const config = loadAiConfig({});

    // Дефолт false: скелетон без провайдера не має показувати напівробочого асистента
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe('fake');
    expect(config.maxOutputTokens).toBe(1024);
    expect(config.historyTurns).toBe(10);
    expect(config.requestTimeoutMs).toBe(60_000);
    expect(config.streamFlushMs).toBe(120);
    expect(config.partialPersistMs).toBe(2_000);
    // AI-0.1 (design.md D1–D4)
    expect(config.providerRetries).toBe(1);
    expect(config.retryDelayMs).toBe(2_000);
    expect(config.pendingTimeoutMs).toBe(300_000);
    expect(config.cancelCheckMs).toBe(2_000);
    // leaseMs — ПОХІДНЕ від requestTimeoutMs, не власна змінна оточення (design.md D1)
    expect(config.leaseMs).toBe(60_000 + 30_000);
  });

  it('читає задані значення', () => {
    const config = loadAiConfig({
      AI_ENABLED: 'true',
      AI_HISTORY_TURNS: '4',
      AI_STREAM_FLUSH_MS: '250',
      AI_PROVIDER_RETRIES: '3',
      AI_RETRY_DELAY_MS: '500',
      AI_PENDING_TIMEOUT_MS: '60000',
      AI_CANCEL_CHECK_MS: '1000',
      AI_REQUEST_TIMEOUT_MS: '45000',
    });

    expect(config.enabled).toBe(true);
    expect(config.historyTurns).toBe(4);
    expect(config.streamFlushMs).toBe(250);
    expect(config.providerRetries).toBe(3);
    expect(config.retryDelayMs).toBe(500);
    expect(config.pendingTimeoutMs).toBe(60_000);
    expect(config.cancelCheckMs).toBe(1_000);
    // leaseMs перераховується від заданого requestTimeoutMs, а не лишається дефолтним
    expect(config.leaseMs).toBe(45_000 + 30_000);
  });

  it('невідомий провайдер валить старт і називає змінну, а не відкочується на fake', () => {
    expect(() => loadAiConfig({ AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER/);
  });

  it('нечислове або недодатне значення відкидається з іменем змінної', () => {
    expect(() => loadAiConfig({ AI_HISTORY_TURNS: 'many' })).toThrow(/AI_HISTORY_TURNS/);
    expect(() => loadAiConfig({ AI_MAX_OUTPUT_TOKENS: '0' })).toThrow(/AI_MAX_OUTPUT_TOKENS/);
  });

  it('AI_PROVIDER_RETRIES: 0 — легальне значення (жодного ретраю), на відміну від решти лічильників', () => {
    const config = loadAiConfig({ AI_PROVIDER_RETRIES: '0' });
    expect(config.providerRetries).toBe(0);
  });

  it('без AI_BASE_URL/AI_API_KEY облікові дані — null, а модель — дефолтна fake-1', () => {
    const config = loadAiConfig({});
    expect(config.baseUrl).toBeNull();
    expect(config.apiKey).toBeNull();
    expect(config.model).toBe('fake-1');
    expect(config.modelConfigured).toBe(false);
  });

  it('AI_BASE_URL, що не є http(s)-URL, валить старт з іменем змінної', () => {
    expect(() => loadAiConfig({ AI_BASE_URL: 'openrouter.ai' })).toThrow(/AI_BASE_URL/);
    expect(() => loadAiConfig({ AI_BASE_URL: 'ftp://openrouter.ai/api/v1' })).toThrow(/AI_BASE_URL/);
  });
});

describe('requireProviderCredentials (ai-1a, design.md D5)', () => {
  const FULL = {
    AI_ENABLED: 'true',
    AI_PROVIDER: 'openai-compat',
    AI_BASE_URL: 'https://openrouter.ai/api/v1',
    AI_API_KEY: 'sk-or-test-key',
    AI_MODEL: 'openai/gpt-5.6-luna',
  };

  it('fake облікових даних не потребує', () => {
    expect(requireProviderCredentials(loadAiConfig({ AI_ENABLED: 'true' }))).toBeNull();
  });

  it('openai-compat з усіма змінними повертає облікові дані', () => {
    expect(requireProviderCredentials(loadAiConfig(FULL))).toEqual({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-test-key',
      model: 'openai/gpt-5.6-luna',
    });
  });

  it.each(['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL'])(
    'увімкнений openai-compat без %s валить старт і називає змінну',
    (name) => {
      const config = loadAiConfig({ ...FULL, [name]: '' });
      expect(() => requireProviderCredentials(config)).toThrow(new RegExp(`${name}: required`));
    },
  );

  it('повідомлення про помилку не містить ключа', () => {
    const config = loadAiConfig({ ...FULL, AI_MODEL: '' });
    expect(() => requireProviderCredentials(config)).toThrow(/AI_MODEL/);
    try {
      requireProviderCredentials(config);
    } catch (error) {
      expect(String(error)).not.toContain('sk-or-test-key');
    }
  });

  it('вимкнений асистент піднімається без ключа', () => {
    const config = loadAiConfig({ AI_PROVIDER: 'openai-compat' });
    expect(requireProviderCredentials(config)).toBeNull();
  });
});
