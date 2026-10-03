import type { AiKnowledgeDocument, AiUserContext } from '../prompt/prompt-builder';
import type { KnowledgeExcerpt } from './citations';

/**
 * Що потрібно джерелу, щоб вибрати знання для відповіді (ai-1b design.md D6).
 *
 * Лише роль і питання — ні tenantId, ні ідентичності юзера: allowlist §9.1 не
 * розширюється. Питання статичному джерелу не потрібне, але PostgreSQL retrieval
 * (AI-2a) використовуватиме його для embedding/FTS. Тенант приходить із CLS/RLS.
 */
export interface KnowledgeQuery {
  readonly role: AiUserContext['role'];
  readonly question: string;
}

export interface KnowledgeSelection {
  /** Версія знань, якими відповідали — пишеться в `ai_messages.knowledge_version` */
  readonly version: string;
  /** У порядку, в якому вони йдуть у промпт (стабільний префікс для кешу) */
  readonly documents: readonly AiKnowledgeDocument[];
  /**
   * Фрагменти, знайдені retrieval-ом для ЦЬОГО питання (AI-2a.3). `undefined` —
   * джерело без retrieval (статичний корпус); `[]` — пошук нічого не знайшов, і
   * промпт мусить сказати це явно, а не мовчки відповідати без джерел.
   */
  readonly excerpts?: readonly KnowledgeExcerpt[];
}

/**
 * Шов між конвеєром і джерелом знань (docs/ai-assistant.md §7.4). Повний корпус →
 * pgvector/FTS — це нові реалізації цього інтерфейсу, а не правка субскрайбера.
 * Асинхронний, бо наступні реалізації читатимуть БД.
 */
export interface KnowledgeSource {
  select(query: KnowledgeQuery): Promise<KnowledgeSelection>;
}

export const KNOWLEDGE_SOURCE = Symbol('KNOWLEDGE_SOURCE');
