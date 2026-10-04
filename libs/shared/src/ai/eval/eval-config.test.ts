import { describe, expect, it } from 'vitest';
import { EvalConfigFileSchema, resolveEvalConfigs, type EvalDefaults } from './eval-config';

const defaults: EvalDefaults = {
  model: 'openai/gpt-5.6-luna',
  maxOutputTokens: 1024,
  historyTurns: 10,
  finalChunks: 5,
  maxContextTokens: 2500,
  searchMode: 'hybrid',
  maxDistance: 0.8,
};

describe('resolveEvalConfigs', () => {
  it('не задане поле — з чинних налаштувань; задане — з файлу; maxDistance null — без порогу', () => {
    const file = EvalConfigFileSchema.parse({
      configs: [
        { name: 'current' },
        { name: 'lean', finalChunks: 3, model: 'other/model', maxDistance: null },
      ],
    });
    const [current, lean] = resolveEvalConfigs(file, defaults);
    expect(current).toEqual({ name: 'current', ...defaults, overridden: [] });
    expect(lean).toMatchObject({
      model: 'other/model',
      finalChunks: 3,
      maxDistance: null,
      maxOutputTokens: 1024,
      searchMode: 'hybrid',
    });
    expect(lean?.overridden).toEqual(['model', 'finalChunks', 'maxDistance']);
  });

  it('невідоме поле, дубль імені чи поза межами — помилка схеми', () => {
    expect(
      EvalConfigFileSchema.safeParse({ configs: [{ name: 'a', temperature: 0 }] }).success,
    ).toBe(false);
    expect(
      EvalConfigFileSchema.safeParse({ configs: [{ name: 'a' }, { name: 'a' }] }).success,
    ).toBe(false);
    expect(
      EvalConfigFileSchema.safeParse({ configs: [{ name: 'a', finalChunks: 50 }] }).success,
    ).toBe(false);
  });
});
