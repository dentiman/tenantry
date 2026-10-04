import { describe, expect, it } from 'vitest';
import { buildGenerationRequest } from './generation-request';
import type { AiHistoryRow } from './history';
import { buildPrompt } from './prompt-builder';

const rows: AiHistoryRow[] = [
  { seq: 1, role: 'USER', status: 'COMPLETE', content: 'first?' },
  { seq: 2, role: 'ASSISTANT', status: 'COMPLETE', content: 'first.' },
  { seq: 3, role: 'USER', status: 'COMPLETE', content: 'second?' },
  { seq: 4, role: 'ASSISTANT', status: 'COMPLETE', content: 'second.' },
];

const base = {
  question: 'third?',
  historyRows: rows,
  user: { role: 'ADMIN', locale: 'en' },
  organization: { persona: '', instructions: '' },
  knowledge: { documents: [] },
  model: 'm-1',
  maxOutputTokens: 77,
} as const;

describe('buildGenerationRequest', () => {
  it('застосовує вікно historyTurns і повертає промпт buildPrompt, модель і ліміт без температури', () => {
    const request = buildGenerationRequest({ ...base, historyTurns: 1 });
    expect(request).toEqual({
      messages: buildPrompt({
        question: 'third?',
        history: [
          { role: 'user', content: 'second?' },
          { role: 'assistant', content: 'second.' },
        ],
        knowledge: [],
        user: base.user,
        organization: base.organization,
      }),
      model: 'm-1',
      maxOutputTokens: 77,
    });
    expect(request).not.toHaveProperty('temperature');
  });

  it('historyTurns 0 — без історії; excerpts [] — явний блок «нічого не знайдено»', () => {
    const request = buildGenerationRequest({
      ...base,
      historyTurns: 0,
      knowledge: { documents: [], excerpts: [] },
    });
    expect(request.messages.filter((m) => m.role !== 'system')).toEqual([
      { role: 'user', content: 'third?' },
    ]);
    expect(request.messages.some((m) => m.content.includes('found no excerpts'))).toBe(true);
  });
});
