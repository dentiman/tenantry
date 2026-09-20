import { describe, expect, it } from 'vitest';
import { buildPrompt, type BuildPromptInput } from './prompt-builder';

const base: BuildPromptInput = {
  question: 'Where do I change the workspace name?',
  history: [],
  knowledge: [],
  user: { role: 'USER', locale: 'en' },
};

describe('buildPrompt', () => {
  it('починає системною інструкцією, яка оголошує межі асистента', () => {
    const messages = buildPrompt(base);

    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('NO access');
  });

  it('ставить знання ПЕРЕД історією — кеш працює по префіксу', () => {
    const messages = buildPrompt({
      ...base,
      knowledge: [{ slug: 'settings', title: 'Settings', body: 'Open Settings → General.' }],
      history: [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
      ],
    });

    const knowledgeAt = messages.findIndex((m) => m.content.includes('Open Settings → General.'));
    const historyAt = messages.findIndex((m) => m.content === 'earlier question');

    expect(knowledgeAt).toBeGreaterThan(-1);
    expect(knowledgeAt).toBeLessThan(historyAt);
  });

  it('питання йде ОСТАННІМ', () => {
    const messages = buildPrompt({
      ...base,
      history: [{ role: 'assistant', content: 'earlier answer' }],
    });

    expect(messages.at(-1)).toEqual({ role: 'user', content: base.question });
  });

  it('порожні знання не додають порожнього системного повідомлення (стан AI-0)', () => {
    const withoutKnowledge = buildPrompt(base);
    const withKnowledge = buildPrompt({
      ...base,
      knowledge: [{ slug: 's', title: 'T', body: 'B' }],
    });

    expect(withKnowledge).toHaveLength(withoutKnowledge.length + 1);
  });

  it('історія зберігає порядок і ролі', () => {
    const messages = buildPrompt({
      ...base,
      history: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
      ],
    });

    expect(messages.slice(-4)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'user', content: base.question },
    ]);
  });

  it('у промпт не потрапляє нічого поза allowlist-ом role/locale', () => {
    // Спроба протягнути email/ім'я/назву тенанта не компілюється (AiUserContext
    // закритий типом); цей тест стереже РАНТАЙМ — що жодне з цих значень не
    // просочилось якимось іншим шляхом
    const messages = buildPrompt({
      ...base,
      question: 'plain question',
      history: [{ role: 'user', content: 'plain history' }],
    });

    const joined = messages.map((m) => m.content).join('\n');
    expect(joined).toContain('role=USER');
    expect(joined).toContain('locale=en');
    expect(joined).not.toMatch(/@/); // жодної email-подібної підстроки
  });
});
