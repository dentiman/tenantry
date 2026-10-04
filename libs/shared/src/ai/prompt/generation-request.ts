import type { LlmRequest } from '../llm/llm-provider';
import type { KnowledgeSelection } from '../knowledge/knowledge-source';
import { selectHistoryPairs, type AiHistoryRow } from './history';
import type { AiOrganizationInstructions } from './organization-instructions';
import { buildPrompt, type AiUserContext } from './prompt-builder';

export interface GenerationRequestInput {
  readonly question: string;
  /** Рядки розмови ДО питання, у порядку `seq`; вікно `historyTurns` відбирається тут */
  readonly historyRows: readonly AiHistoryRow[];
  readonly historyTurns: number;
  readonly user: AiUserContext;
  readonly organization: AiOrganizationInstructions;
  readonly knowledge: Pick<KnowledgeSelection, 'documents' | 'excerpts'>;
  readonly model: string;
  readonly maxOutputTokens: number;
}

/**
 * Запит до моделі для ОДНІЄЇ відповіді (AI-5c, design.md D1/I1) — спільний для воркера й
 * eval відповідей (`pnpm ai:answers:eval`), щоб eval міряв рівно той промпт і ті параметри,
 * що йдуть у прод. Чиста: читання БД, вибір знань і провайдер — у викликача.
 */
export function buildGenerationRequest(input: GenerationRequestInput): LlmRequest {
  return {
    messages: buildPrompt({
      question: input.question,
      history: selectHistoryPairs(input.historyRows, input.historyTurns),
      knowledge: input.knowledge.documents,
      excerpts: input.knowledge.excerpts,
      user: input.user,
      organization: input.organization,
    }),
    model: input.model,
    maxOutputTokens: input.maxOutputTokens,
  };
}
