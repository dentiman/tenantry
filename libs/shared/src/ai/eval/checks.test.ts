import { describe, expect, it } from 'vitest';
import {
  canonicalNumber,
  checkAnswer,
  checkCitations,
  dominantScript,
  isTruncated,
  languageOk,
  mentionsOk,
  ungroundedNumbers,
} from './checks';
import type { EvalQuestion } from './question-set';

const answerable: EvalQuestion = {
  id: 'q1',
  category: 'exact',
  language: 'en',
  role: 'ADMIN',
  question: 'How are WhatsApp conversations billed?',
  expected: ['pricing.md'],
};
const unanswerable: EvalQuestion = { ...answerable, id: 'q2', category: 'none', expected: [] };
const excerpts = [
  { n: 1, path: 'glossary.md' },
  { n: 2, path: 'pricing.md' },
];

describe('checkCitations', () => {
  it('валідна цитата на очікувану сторінку: answered, hit, retrieval hit', () => {
    expect(checkCitations('Per conversation [2].', excerpts, answerable)).toEqual({
      cited: [2],
      citationsValid: true,
      answered: true,
      citationHit: true,
      retrievalHit: true,
      refusalOk: null,
    });
  });

  it('вигаданий номер — citations_valid false; цитата не на ту сторінку — без hit', () => {
    const result = checkCitations('See [1] and [7].', excerpts, answerable);
    expect(result.citationsValid).toBe(false);
    expect(result.answered).toBe(true);
    expect(result.citationHit).toBe(false);
    expect(result.retrievalHit).toBe(true);
  });

  it('без цитат на питання з відповіддю — не answered', () => {
    expect(checkCitations('I do not know.', excerpts, answerable).answered).toBe(false);
  });

  it('expectAll вимагає всі очікувані сторінки серед цитат', () => {
    const question = { ...answerable, expected: ['pricing.md', 'glossary.md'], expectAll: true };
    expect(checkCitations('[2]', excerpts, question).citationHit).toBe(false);
    expect(checkCitations('[1, 2]', excerpts, question).citationHit).toBe(true);
  });

  it('питання без відповіді: будь-яке посилання — провалена відмова', () => {
    expect(checkCitations('Not covered.', excerpts, unanswerable)).toMatchObject({
      refusalOk: true,
      answered: null,
      citationHit: null,
    });
    expect(checkCitations('It is [1].', excerpts, unanswerable).refusalOk).toBe(false);
  });
});

describe('numbers', () => {
  it('нормалізація: тисячі, десяткова кома, провідні нулі, версії', () => {
    expect(canonicalNumber('1,000')).toBe('1000');
    expect(canonicalNumber('1 000')).toBe('1000');
    expect(canonicalNumber('0,5')).toBe('0.5');
    expect(canonicalNumber('007')).toBe('7');
    expect(canonicalNumber('1.2.3')).toBe('1.2.3');
  });

  it('число, якого немає у фрагментах, — ungrounded; цитати, нумерація й одноцифрові — ні', () => {
    const answer =
      '1. Open the page [12].\n2. The fee is 0,05 USD for 1,000 messages, 25 max, 3 tries.';
    expect(ungroundedNumbers(answer, ['Fee: 0.05 per 1000 messages.'])).toEqual(['25']);
  });

  it('числа з питання й історії вважаються відомими; URL і цілі посилань не рахуються', () => {
    const answer = 'Use PAY-12 with 30 days, see [docs](https://x.io/v/2024) or https://y.io/77.';
    expect(ungroundedNumbers(answer, ['What does PAY-12 do?', 'You said 30 days.'])).toEqual([]);
  });

  it('checkAnswer: grounding — питання, turns і фрагменти', () => {
    const checks = checkAnswer({
      question: {
        ...answerable,
        turns: [
          { role: 'user', content: 'limit 250?' },
          { role: 'assistant', content: 'yes' },
        ],
      },
      answer: 'The limit is 250 and the fee 99 [2].',
      excerpts: [{ n: 2, path: 'pricing.md', content: 'fee 99' }],
      finishReason: 'stop',
      completionTokens: 10,
      maxOutputTokens: 100,
    });
    expect(checks.numbersGrounded).toBe(true);
    expect(checks.truncated).toBe(false);
    expect(checks.languageOk).toBe(true);
    expect(checks.mentionsOk).toBeNull();
  });
});

describe('language', () => {
  it('домінантне письмо без коду й цитат', () => {
    expect(dominantScript('Відкрийте `Settings → General` [1].')).toBe('cyrillic');
    expect(dominantScript('Open the MASAV page')).toBe('latin');
    expect(dominantScript('```\nкод\n``` 123')).toBeNull();
  });

  it('uk: кирилиця, але не суто російська; en: латиниця; інші мови не перевіряються', () => {
    expect(languageOk('Відкрийте налаштування MASAV.', 'uk')).toBe(true);
    expect(languageOk('Откройте эти настройки.', 'uk')).toBe(false);
    expect(languageOk('Open settings.', 'uk')).toBe(false);
    expect(languageOk('Open settings.', 'en')).toBe(true);
    expect(languageOk('Відкрийте налаштування.', 'en')).toBe(false);
    expect(languageOk('Ouvrez', 'fr')).toBeNull();
  });
});

describe('truncation and mentions', () => {
  it('finish_reason length; без нього — completion ≥ ліміт', () => {
    expect(isTruncated('length', 10, 100)).toBe(true);
    expect(isTruncated('stop', 100, 100)).toBe(false);
    expect(isTruncated(null, 100, 100)).toBe(true);
    expect(isTruncated(null, 99, 100)).toBe(false);
    expect(isTruncated(null, null, 100)).toBe(false);
  });

  it('mustMention без регістру й зайвих пробілів; не задано — null', () => {
    expect(mentionsOk('Open  Billing   settings', ['billing settings'])).toBe(true);
    expect(mentionsOk('Open billing', ['billing', 'invoice'])).toBe(false);
    expect(mentionsOk('x', undefined)).toBeNull();
  });
});
