import { describe, expect, it } from 'vitest';
import { selectHistoryPairs, type AiHistoryRow } from './history';

function row(
  seq: number,
  role: 'USER' | 'ASSISTANT',
  status: AiHistoryRow['status'],
  content: string,
): AiHistoryRow {
  return { seq, role, status, content };
}

describe('selectHistoryPairs', () => {
  it('порожній вхід дає порожню історію', () => {
    expect(selectHistoryPairs([], 10)).toEqual([]);
  });

  it('одне завершене питання/відповідь дає рівно одну пару, у правильному порядку', () => {
    const rows = [row(0, 'USER', 'COMPLETE', 'q1'), row(1, 'ASSISTANT', 'COMPLETE', 'a1')];

    expect(selectHistoryPairs(rows, 10)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]);
  });

  it('провалена відповідь викидає своє питання цілком — без непарного залишку', () => {
    const rows = [
      row(0, 'USER', 'COMPLETE', 'q1'),
      row(1, 'ASSISTANT', 'FAILED', 'a1-partial'),
      row(2, 'USER', 'COMPLETE', 'q2'),
      row(3, 'ASSISTANT', 'COMPLETE', 'a2'),
    ];

    expect(selectHistoryPairs(rows, 10)).toEqual([
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ]);
  });

  it('зупинена (CANCELLED) відповідь так само не входить у контекст', () => {
    const rows = [row(0, 'USER', 'COMPLETE', 'q1'), row(1, 'ASSISTANT', 'CANCELLED', 'a1-partial')];

    expect(selectHistoryPairs(rows, 10)).toEqual([]);
  });

  it('незавершене останнє питання (PENDING/STREAMING) відкидається, а не лишається самотнім', () => {
    const rows = [
      row(0, 'USER', 'COMPLETE', 'q1'),
      row(1, 'ASSISTANT', 'COMPLETE', 'a1'),
      row(2, 'USER', 'COMPLETE', 'q2'),
      row(3, 'ASSISTANT', 'STREAMING', 'partial'),
    ];

    expect(selectHistoryPairs(rows, 10)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]);
  });

  it('ліміт залишає лише НАЙНОВІШІ пари, найстаріша перша', () => {
    const rows = [
      row(0, 'USER', 'COMPLETE', 'q1'),
      row(1, 'ASSISTANT', 'COMPLETE', 'a1'),
      row(2, 'USER', 'COMPLETE', 'q2'),
      row(3, 'ASSISTANT', 'COMPLETE', 'a2'),
      row(4, 'USER', 'COMPLETE', 'q3'),
      row(5, 'ASSISTANT', 'COMPLETE', 'a3'),
    ];

    expect(selectHistoryPairs(rows, 2)).toEqual([
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'q3' },
      { role: 'assistant', content: 'a3' },
    ]);
  });

  it('turns: 0 дає порожню історію (а не .slice(-0) == все)', () => {
    const rows = [row(0, 'USER', 'COMPLETE', 'q1'), row(1, 'ASSISTANT', 'COMPLETE', 'a1')];

    expect(selectHistoryPairs(rows, 0)).toEqual([]);
  });
});
