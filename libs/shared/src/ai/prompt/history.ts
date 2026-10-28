import type { AiHistoryTurn } from './prompt-builder';

/** Рядок повідомлення, з якого відбирається історія — саме те, що читає БД */
export interface AiHistoryRow {
  readonly seq: number;
  readonly role: 'USER' | 'ASSISTANT';
  readonly status: 'PENDING' | 'STREAMING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
  readonly content: string;
}

/**
 * Відбирає ЗАВЕРШЕНІ пари питання/відповідь для контексту моделі
 * (docs/notes/ai-assistant-review-gaps.md п.2, design.md D8).
 *
 * Пара — це (USER seq=k, ASSISTANT seq=k+1, ASSISTANT.status === COMPLETE). Питання,
 * чия відповідь провалилась або була зупинена, у контекст НЕ потрапляє — інакше
 * непарне питання спотворило б історію, а FAILED/CANCELLED текст моделі не варто
 * повторювати як приклад.
 *
 * `rows` приходить у БУДЬ-ЯКОМУ порядку (викликач гарантує зростання `seq`, ця
 * функція не сортує сама — вона чиста й не знає про Prisma orderBy), і функція
 * повертає ОСТАННІ `turns` пар у порядку розмови (найстаріша перша).
 */
export function selectHistoryPairs(rows: readonly AiHistoryRow[], turns: number): AiHistoryTurn[] {
  const pairs: AiHistoryTurn[][] = [];

  for (let i = 0; i < rows.length - 1; i += 1) {
    const question = rows[i];
    const answer = rows[i + 1];
    if (
      question &&
      answer &&
      question.role === 'USER' &&
      answer.role === 'ASSISTANT' &&
      answer.seq === question.seq + 1 &&
      answer.status === 'COMPLETE'
    ) {
      pairs.push([
        { role: 'user', content: question.content },
        { role: 'assistant', content: answer.content },
      ]);
      i += 1; // пара спожита — не пробувати ASSISTANT-рядок як початок наступної
    }
  }

  // `.slice(-0)` === `.slice(0)` у JS — без цієї гілки `turns: 0` віддав би ВСЮ історію
  return (turns > 0 ? pairs.slice(-turns) : []).flat();
}
