import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvalConfigFileSchema } from './eval-config';
import { QuestionSetSchema } from './question-set';

const DOCS = join(__dirname, '../../../../../docs/ai-sources');
const read = (name: string): unknown => JSON.parse(readFileSync(join(DOCS, name), 'utf8'));

describe('QuestionSetSchema', () => {
  it('закомічений приклад конфігурацій валідний як є', () => {
    expect(EvalConfigFileSchema.safeParse(read('answer-eval-configs.json')).success).toBe(true);
  });

  // Набір питань FMS — чужі дані, у публічному репо його немає; перевіряється, лише де лежить локально
  it.skipIf(!existsSync(join(DOCS, 'fms-eval.json')))(
    'локальний fms-eval.json валідний як є',
    () => {
      expect(QuestionSetSchema.safeParse(read('fms-eval.json')).success).toBe(true);
    },
  );

  const base = {
    id: 'd1',
    category: 'dialogue',
    language: 'en',
    role: 'ADMIN',
    question: 'And for USER?',
    expected: ['a.md'],
  };

  it('turns — цілими парами user → assistant; mustMention — непорожній', () => {
    const ok = {
      ...base,
      turns: [
        { role: 'user', content: 'Where is billing?' },
        { role: 'assistant', content: 'Settings → Billing.' },
      ],
      mustMention: ['Billing'],
    };
    expect(QuestionSetSchema.safeParse({ product: 'fms', questions: [ok] }).success).toBe(true);
    for (const turns of [
      [{ role: 'user', content: 'x' }],
      [
        { role: 'assistant', content: 'x' },
        { role: 'user', content: 'y' },
      ],
    ]) {
      expect(
        QuestionSetSchema.safeParse({ product: 'fms', questions: [{ ...base, turns }] }).success,
      ).toBe(false);
    }
    expect(
      QuestionSetSchema.safeParse({ product: 'fms', questions: [{ ...base, mustMention: [] }] })
        .success,
    ).toBe(false);
  });
});
