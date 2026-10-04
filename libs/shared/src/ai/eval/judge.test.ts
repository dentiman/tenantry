import { describe, expect, it } from 'vitest';
import { buildJudgeRequest, parseJudgeOutput } from './judge';

describe('parseJudgeOutput', () => {
  it('валідний JSON, також в ```json-огорожі й з текстом довкола', () => {
    const verdict = { grounded: 5, answers_question: 4, refusal_correct: true, note: 'ok' };
    expect(parseJudgeOutput(JSON.stringify(verdict))).toEqual({ ok: true, verdict });
    expect(parseJudgeOutput(`Sure:\n\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\``)).toEqual({
      ok: true,
      verdict,
    });
  });

  it('не JSON — invalid-json; JSON не тієї форми — schema', () => {
    expect(parseJudgeOutput('## Here is what I found')).toEqual({
      ok: false,
      error: 'invalid-json',
    });
    expect(parseJudgeOutput('{grounded: 5}')).toEqual({ ok: false, error: 'invalid-json' });
    expect(
      parseJudgeOutput(
        '{"grounded": 7, "answers_question": 4, "refusal_correct": true, "note": ""}',
      ),
    ).toEqual({ ok: false, error: 'schema' });
    expect(parseJudgeOutput('{"grounded": 5}')).toEqual({ ok: false, error: 'schema' });
    const long = parseJudgeOutput(
      JSON.stringify({
        grounded: 3,
        answers_question: 3,
        refusal_correct: false,
        note: 'x'.repeat(500),
      }),
    );
    expect(long.ok && long.verdict.note.length).toBe(300);
  });
});

describe('buildJudgeRequest', () => {
  it('температура 0, фіксована модель, фрагменти в тих самих огорожах, що бачила модель', () => {
    const request = buildJudgeRequest({
      model: 'judge-1',
      question: 'How?',
      turns: [
        { role: 'user', content: 'Before?' },
        { role: 'assistant', content: 'Yes.' },
      ],
      answerable: false,
      excerpts: [{ n: 1, title: 'T', heading: 'H', path: 'p.md', content: 'Body' }],
      answer: 'Not covered.',
    });
    expect(request).toMatchObject({ model: 'judge-1', temperature: 0, maxOutputTokens: 1200 });
    const user = request.messages[1]?.content ?? '';
    expect(user).toContain('Is the documentation expected to answer it: no');
    expect(user).toContain('<excerpt n="1"');
    expect(user).toContain('user: Before?');
    expect(user).toContain('<answer>\nNot covered.\n</answer>');
  });
});
