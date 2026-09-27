import type { LlmMessage } from '../llm/llm-provider';
import {
  renderOrganizationInstructions,
  type AiOrganizationInstructions,
} from './organization-instructions';

/**
 * Контекст користувача в промпті — ЗАКРИТИЙ allowlist, і він закритий ТИПОМ,
 * а не дисципліною (docs/ai-assistant-plan.md §5.1).
 *
 * Тут немає ні `email`, ні `name`, ні назви тенанта, і додати їх не можна, не
 * змінивши цей інтерфейс — тобто не поговоривши про приватність явно. Саме це,
 * а не обіцянка в доку, і є гарантією, що особисті дані не їдуть до провайдера.
 *
 * `role` потрібна для фільтра `audience` у знаннях (AI-1), `locale` — щоб
 * відповідь була мовою людини.
 */
export interface AiUserContext {
  readonly role: 'ADMIN' | 'USER';
  readonly locale: string;
}

/** Один минулий хід розмови */
export interface AiHistoryTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/**
 * Документ знань. З ai-1b їх дає `KnowledgeSource` (корпус рівня 1, вже
 * відфільтрований за `audience`); AI-2 (рівень 2) приєднується тим самим входом,
 * не переписуючи підпис функції й її викликачів. Лише статична документація
 * продукту — жодних даних тенанта (§9.1).
 */
export interface AiKnowledgeDocument {
  readonly slug: string;
  readonly title: string;
  readonly body: string;
}

export interface BuildPromptInput {
  readonly question: string;
  readonly history: readonly AiHistoryTurn[];
  readonly knowledge: readonly AiKnowledgeDocument[];
  readonly user: AiUserContext;
  /**
   * Персона/інструкції організації з `settings.ai` (AI-1c). Відсутні чи порожні —
   * промпт рівно той, що до AI-1c. Не дані юзера, а конфігурація від адміна.
   */
  readonly organization?: AiOrganizationInstructions;
}

/**
 * НЕЗМІННІ МЕЖІ асистента — живуть у коді й ЗАВЖДИ йдуть першим повідомленням
 * (AI-1c, docs/ai-assistant-implementation.md §15). Тенант може лише ДОДАТИ
 * персону окремим повідомленням (після корпусу знань), але не прибрати чи замінити їх: жоден
 * вхід `buildPrompt` не потрапляє в це повідомлення.
 *
 * Текст свідомо той самий, що в AI-0…AI-1b, байт у байт: тоді «тенант без
 * налаштувань отримує попередній промпт» — тест, а не обіцянка. Не мінятись
 * мимохідь — зміна тексту міняє кешований префікс УСІХ тенантів.
 */
export const ASSISTANT_BOUNDARIES = [
  'You are the in-app help assistant for this workspace application.',
  'You answer questions about how to use the product: where a feature lives, what a setting does, how a workflow goes.',
  'You have NO access to the user\'s business data. You cannot read, create, or change records, and you cannot perform actions on their behalf.',
  'If you are asked about specific data ("how many customers do I have"), say plainly that you cannot see their data, and point to the screen where they can look it up themselves.',
  'If the documentation below does not cover the question, say so instead of guessing.',
  'Answer in the language the user wrote in. Keep answers short and concrete; use Markdown.',
].join('\n');

/**
 * ПОРЯДОК ТУТ — ЦЕ ПИТАННЯ ЦІНИ, а не смаку: prompt caching у всіх кандидатів
 * працює по ПРЕФІКСУ, тому від найстабільнішого до найзміннішого —
 * межі → знання → інструкції організації → контекст юзера → історія → питання.
 *
 * Межі й корпус однакові для ВСІХ тенантів інсталяції (корпус різниться лише
 * за роллю), а ключ провайдера один на інсталяцію — тож цей ~11k-токенний
 * префікс кешується спільно на всю інсталяцію. Інструкції організації
 * різняться за тенантом, тому йдуть ПІСЛЯ корпусу: інакше кожен тенант із
 * персоною мав би власний префікс (холодний хід ×N тенантів), а кожна правка
 * персони скидала б кеш усього корпусу — саме це показав живий прогін
 * 2026-09-27 (docs/ai-assistant-implementation.md §15). Підпорядкованість меж
 * тримає не позиція, а огорожа й формулювання самого блоку організації.
 */
export function buildPrompt(input: BuildPromptInput): LlmMessage[] {
  const messages: LlmMessage[] = [
    { role: 'system', content: ASSISTANT_BOUNDARIES },
  ];

  if (input.knowledge.length > 0) {
    messages.push({
      role: 'system',
      content: [
        'Product documentation:',
        ...input.knowledge.map((doc) => `\n## ${doc.title} (${doc.slug})\n${doc.body}`),
      ].join('\n'),
    });
  }

  const organization = renderOrganizationInstructions(input.organization);
  if (organization !== null) {
    messages.push({ role: 'system', content: organization });
  }

  messages.push({
    role: 'system',
    content: `User context: role=${input.user.role}, locale=${input.user.locale}.`,
  });

  for (const turn of input.history) {
    messages.push({ role: turn.role, content: turn.content });
  }

  messages.push({ role: 'user', content: input.question });

  return messages;
}
