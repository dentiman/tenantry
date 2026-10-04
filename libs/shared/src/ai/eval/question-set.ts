import { z } from 'zod';

/**
 * Набір питань для eval — спільний для `ai:docs:eval` (лише пошук) і `ai:answers:eval`
 * (відповіді, AI-5c). Розширення AI-5c — лише необовʼязкові поля: наявний файл лишається
 * валідним як є.
 */

/** Попередня репліка діалогу (AI-5c, design.md D2): `question` — останнє питання після них */
export const QuestionTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});
export type QuestionTurn = z.infer<typeof QuestionTurnSchema>;

export const EvalQuestionSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  language: z.string().min(1),
  role: z.enum(['ADMIN', 'USER']),
  question: z.string().min(1),
  /** Порожньо — питання без відповіді: правильна поведінка — нічого не знайти / відмовитись */
  expected: z.array(z.string()),
  /** Потрібні ВСІ очікувані сторінки (питання, що зачіпає кілька документів) */
  expectAll: z.boolean().optional(),
  /**
   * Попередні ходи — ЦІЛИМИ парами user → assistant, як їх відбирає прод (`selectHistoryPairs`):
   * непарне питання в історію не потрапило б, тож і тут воно — помилка набору
   */
  turns: z
    .array(QuestionTurnSchema)
    .refine(
      (turns) =>
        turns.length % 2 === 0 &&
        turns.every((turn, i) => turn.role === (i % 2 === 0 ? 'user' : 'assistant')),
      { message: 'turns must be complete user → assistant pairs' },
    )
    .optional(),
  /** Рядки, які відповідь має містити (без урахування регістру) */
  mustMention: z.array(z.string().min(1)).min(1).optional(),
});
export type EvalQuestion = z.infer<typeof EvalQuestionSchema>;

export const QuestionSetSchema = z
  .object({
    product: z.string().min(1),
    status: z.string().optional(),
    questions: z.array(EvalQuestionSchema).min(1),
  })
  .refine((set) => new Set(set.questions.map((q) => q.id)).size === set.questions.length, {
    message: 'question ids must be unique',
  });
export type QuestionSet = z.infer<typeof QuestionSetSchema>;

export function isAnswerable(question: Pick<EvalQuestion, 'expected'>): boolean {
  return question.expected.length > 0;
}
