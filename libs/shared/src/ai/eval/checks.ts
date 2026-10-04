import { CITATION_MARKER, citedNumbers } from '../knowledge/citations';
import { isAnswerable, type EvalQuestion } from './question-set';

/**
 * Детерміновані перевірки відповіді (AI-5c, design.md D3/I6) — чисті функції, без мережі.
 * `null` — перевірка до цього питання не застосовна (і не входить у частку в звіті).
 */

export interface SentExcerpt {
  readonly n: number;
  readonly path: string;
}

export interface CitationChecks {
  /** Усі номери `[n]` з тексту, по зростанню */
  readonly cited: number[];
  /** Кожен `[n]` веде на надісланий фрагмент (немає посилань — теж `true`) */
  readonly citationsValid: boolean;
  /** Питання з відповіддю: є текст і хоч одна валідна цитата */
  readonly answered: boolean | null;
  /** Валідні цитати ведуть на очікувану сторінку (`expectAll` — на всі) */
  readonly citationHit: boolean | null;
  /** Діагностика: очікувана сторінка серед НАДІСЛАНИХ фрагментів — промах пошуку чи генерації */
  readonly retrievalHit: boolean | null;
  /** Питання без відповіді: жодного посилання на документацію (проксі відмови) */
  readonly refusalOk: boolean | null;
}

function hits(paths: ReadonlySet<string>, question: EvalQuestion): boolean {
  return question.expectAll
    ? question.expected.every((path) => paths.has(path))
    : question.expected.some((path) => paths.has(path));
}

export function checkCitations(
  answer: string,
  excerpts: readonly SentExcerpt[],
  question: EvalQuestion,
): CitationChecks {
  const cited = [...citedNumbers(answer)].sort((a, b) => a - b);
  const byNumber = new Map(excerpts.map((excerpt) => [excerpt.n, excerpt.path]));
  const citedPaths = new Set(
    cited.flatMap((n) => {
      const path = byNumber.get(n);
      return path !== undefined ? [path] : [];
    }),
  );
  const validCount = cited.filter((n) => byNumber.has(n)).length;
  if (!isAnswerable(question)) {
    return {
      cited,
      citationsValid: validCount === cited.length,
      answered: null,
      citationHit: null,
      retrievalHit: null,
      refusalOk: cited.length === 0,
    };
  }
  return {
    cited,
    citationsValid: validCount === cited.length,
    answered: answer.trim() !== '' && validCount > 0,
    citationHit: hits(citedPaths, question),
    retrievalHit: hits(new Set(excerpts.map((e) => e.path)), question),
    refusalOk: null,
  };
}

/**
 * Числа: `1,000` / `1 000` (групи по 3) — тисячі; `0,5` → `0.5`; `1.2.3` лишається як є.
 * Тисячний пробіл — лише перед рівно трьома цифрами, щоб «крок 2 100» не злипався частіше,
 * ніж неминуче.
 */
const NUMBER = /\d{1,3}(?:[ ,\u00a0\u202f]\d{3}(?!\d))+(?:\.\d+)?|\d+(?:[.,]\d+)*/g;
const THOUSANDS = /^\d{1,3}(?:[ ,\u00a0\u202f]\d{3})+(?:\.\d+)?$/;

/** Нумерація списку на початку рядка (`1.`, `2)`, також після `#`, `-`, `*`, `>`) */
const LIST_NUMBERING = /^(\s*(?:[#>*+-]+\s*)*)\d+[.)](?=\s|$)/gm;
const URL = /https?:\/\/\S+/g;
const LINK_TARGET = /\]\([^)]*\)/g;

export function canonicalNumber(token: string): string {
  const plain = THOUSANDS.test(token)
    ? token.replace(/[ ,\u00a0\u202f]/g, '')
    : token.replace(/,/g, '.');
  const [head = '', ...rest] = plain.split('.');
  const intPart = head.replace(/^0+(?=\d)/, '');
  return [intPart, ...rest].join('.');
}

export function numbersIn(text: string): Set<string> {
  return new Set([...text.matchAll(NUMBER)].map((m) => canonicalNumber(m[0])));
}

/** Текст відповіді без того, що числом-фактом не є: цитати, нумерація, URL і цілі посилань */
function factualText(answer: string): string {
  return answer
    .replace(URL, ' ')
    .replace(LINK_TARGET, ']')
    .replace(CITATION_MARKER, ' ')
    .replace(LIST_NUMBERING, '$1');
}

/**
 * Числа відповіді, яких немає ні у фрагментах, ні в питанні, ні в попередніх репліках.
 * Одноцифрові цілі (кроки, кількості, порядкові) не рахуються.
 */
export function ungroundedNumbers(answer: string, grounding: readonly string[]): string[] {
  const known = new Set(grounding.flatMap((text) => [...numbersIn(text)]));
  return [...numbersIn(factualText(answer))].filter((n) => !/^\d$/.test(n) && !known.has(n));
}

export type Script = 'latin' | 'cyrillic';

const LATIN = /[A-Za-zÀ-ɏ]/g;
const CYRILLIC = /[Ѐ-ӿ]/g;
const CODE_BLOCK = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE = /`[^`\n]*`/g;

/** Домінантне письмо відповіді без коду, URL і цитат; `null` — букв немає */
export function dominantScript(text: string): Script | null {
  const prose = text
    .replace(CODE_BLOCK, ' ')
    .replace(INLINE_CODE, ' ')
    .replace(URL, ' ')
    .replace(CITATION_MARKER, ' ');
  const latin = prose.match(LATIN)?.length ?? 0;
  const cyrillic = prose.match(CYRILLIC)?.length ?? 0;
  if (latin + cyrillic === 0) return null;
  return cyrillic / (latin + cyrillic) >= 0.5 ? 'cyrillic' : 'latin';
}

/**
 * Мова відповіді = мова питання. `en` — латиниця; `uk` — кирилиця, і не суто російська
 * (є `ы э ъ ё`, але жодної з `і ї є ґ`); `ru` — кирилиця; інші мови — `null` (не перевіряється).
 */
export function languageOk(answer: string, language: string): boolean | null {
  const expected: Script | null =
    language === 'en' ? 'latin' : language === 'uk' || language === 'ru' ? 'cyrillic' : null;
  if (expected === null || answer.trim() === '') return null;
  const script = dominantScript(answer);
  if (script !== expected) return false;
  if (language === 'uk') {
    const lower = answer.toLowerCase();
    const russianOnly = /[ыэъё]/.test(lower) && !/[іїєґ]/.test(lower);
    return !russianOnly;
  }
  return true;
}

/** Обрізано лімітом виходу: `finish_reason = length`; без нього — `completion ≥ ліміт` */
export function isTruncated(
  finishReason: string | null,
  completionTokens: number | null,
  maxOutputTokens: number,
): boolean {
  if (finishReason !== null) return finishReason === 'length';
  return completionTokens !== null && completionTokens >= maxOutputTokens;
}

function collapse(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function mentionsOk(
  answer: string,
  mustMention: readonly string[] | undefined,
): boolean | null {
  if (!mustMention || mustMention.length === 0) return null;
  const haystack = collapse(answer);
  return mustMention.every((needle) => haystack.includes(collapse(needle)));
}

export interface AnswerChecks extends CitationChecks {
  readonly numbersGrounded: boolean;
  readonly ungroundedNumbers: string[];
  readonly languageOk: boolean | null;
  readonly truncated: boolean;
  readonly mentionsOk: boolean | null;
}

export interface AnswerCheckInput {
  readonly question: EvalQuestion;
  readonly answer: string;
  /** Надіслані фрагменти з текстом — для цитат і чисел */
  readonly excerpts: readonly (SentExcerpt & { readonly content: string })[];
  readonly finishReason: string | null;
  readonly completionTokens: number | null;
  readonly maxOutputTokens: number;
}

export function checkAnswer(input: AnswerCheckInput): AnswerChecks {
  const { question, answer } = input;
  const ungrounded = ungroundedNumbers(answer, [
    question.question,
    ...(question.turns ?? []).map((turn) => turn.content),
    ...input.excerpts.map((excerpt) => excerpt.content),
  ]);
  return {
    ...checkCitations(answer, input.excerpts, question),
    numbersGrounded: ungrounded.length === 0,
    ungroundedNumbers: ungrounded,
    languageOk: languageOk(answer, question.language),
    truncated: isTruncated(input.finishReason, input.completionTokens, input.maxOutputTokens),
    mentionsOk: mentionsOk(answer, question.mustMention),
  };
}
