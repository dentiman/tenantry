import type { AiKnowledgeDocument, AiUserContext } from '../prompt/prompt-builder';

/**
 * Що потрібно джерелу, щоб вибрати знання для відповіді (ai-1b design.md D6).
 *
 * Лише роль і питання — ні tenantId, ні ідентичності юзера: allowlist §9.1 не
 * розширюється. Питання статичному джерелу не потрібне, але FTS (AI-4) без нього не
 * обійдеться; рівень 2 (AI-2) читатиме тенанта з CLS/RLS, як будь-який доменний код.
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
}

/**
 * Шов між конвеєром і джерелом знань (docs/ai-assistant.md §7.4). Повний корпус →
 * FTS → рівень 2 — це нові реалізації цього інтерфейсу, а не правка субскрайбера.
 * Асинхронний, бо наступні реалізації читатимуть БД.
 */
export interface KnowledgeSource {
  select(query: KnowledgeQuery): Promise<KnowledgeSelection>;
}

export const KNOWLEDGE_SOURCE = Symbol('KNOWLEDGE_SOURCE');
