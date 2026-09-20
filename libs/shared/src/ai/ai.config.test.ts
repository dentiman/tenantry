import { describe, expect, it } from 'vitest';
import { loadAiConfig } from './ai.config';

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
  });

  it('читає задані значення', () => {
    const config = loadAiConfig({
      AI_ENABLED: 'true',
      AI_HISTORY_TURNS: '4',
      AI_STREAM_FLUSH_MS: '250',
    });

    expect(config.enabled).toBe(true);
    expect(config.historyTurns).toBe(4);
    expect(config.streamFlushMs).toBe(250);
  });

  it('невідомий провайдер валить старт і називає змінну, а не відкочується на fake', () => {
    expect(() => loadAiConfig({ AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER/);
  });

  it('нечислове або недодатне значення відкидається з іменем змінної', () => {
    expect(() => loadAiConfig({ AI_HISTORY_TURNS: 'many' })).toThrow(/AI_HISTORY_TURNS/);
    expect(() => loadAiConfig({ AI_MAX_OUTPUT_TOKENS: '0' })).toThrow(/AI_MAX_OUTPUT_TOKENS/);
  });
});
