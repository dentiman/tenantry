import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StepProgress, type StepProgressItem } from './step-progress';

// i18next тут не ініціалізований: `t` повертає сам ключ — цього досить, щоб перевірити,
// що стан кроку названо словами, а не лише значком і кольором
const render = (steps: StepProgressItem[]): string =>
  renderToStaticMarkup(<StepProgress steps={steps} />);

describe('StepProgress', () => {
  it('names the state of every step in text and keeps the order', () => {
    const html = render([
      { key: 'a', label: 'Prepare', status: 'done' },
      { key: 'b', label: 'Transfer', status: 'running' },
      { key: 'c', label: 'Verify', status: 'pending' },
      { key: 'd', label: 'Report', status: 'skipped' },
      { key: 'e', label: 'Notify', status: 'failed' },
    ]);

    for (const status of ['done', 'running', 'pending', 'skipped', 'failed']) {
      expect(html).toContain(`data-status="${status}"`);
      expect(html).toContain(`steps.status.${status}`);
    }
    expect(html.indexOf('Prepare')).toBeLessThan(html.indexOf('Transfer'));
    expect(html.indexOf('Transfer')).toBeLessThan(html.indexOf('Verify'));
  });

  it('marks only the running step as current', () => {
    const html = render([
      { key: 'a', label: 'Prepare', status: 'done' },
      { key: 'b', label: 'Transfer', status: 'running' },
    ]);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/data-status="running"[^>]*aria-current="step"/);
  });

  it('shows a bar only for a running step that reports measurable progress', () => {
    const bar = 'data-slot="progress"';
    expect(render([{ key: 'a', label: 'T', status: 'running', current: 3, total: 10 }])).toContain(bar);
    expect(render([{ key: 'a', label: 'T', status: 'running' }])).not.toContain(bar);
    expect(render([{ key: 'a', label: 'T', status: 'running', current: 0, total: 0 }])).not.toContain(bar);
    expect(render([{ key: 'a', label: 'T', status: 'done', current: 10, total: 10 }])).not.toContain(bar);
  });

  it('shows the description of a failed step', () => {
    const html = render([
      { key: 'a', label: 'Verify', status: 'failed', description: 'File type is not allowed' },
    ]);
    expect(html).toContain('File type is not allowed');
  });
});
