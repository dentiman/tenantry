import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityChipContent, ActivityRow, ActivityTray, ActivityTrayView } from './activity-tray';
import type { ActivityItem } from '../lib/activity';

// i18next не ініціалізований: `t` повертає ключ — перевіряємо, ЯКИЙ текст і які дії обрано
const item = (patch: Partial<ActivityItem> = {}): ActivityItem => ({
  id: 'a',
  title: 'report.pdf',
  status: 'running',
  startedAt: 0,
  onDismiss: () => undefined,
  ...patch,
});

describe('activity chip', () => {
  const chip = (summary: Parameters<typeof ActivityChipContent>[0]['summary']): string =>
    renderToStaticMarkup(<ActivityChipContent summary={summary} />);

  it('shows the number of active items and their combined percentage', () => {
    const html = chip({ active: 3, failed: 1, percent: 64 });
    expect(html).toContain('activity.active');
    expect(html).toContain('64%');
  });

  it('omits the percentage when nothing measurable is running', () => {
    expect(chip({ active: 1, failed: 0, percent: null })).not.toContain('%');
  });

  it('asks for attention when only failures are left', () => {
    const html = chip({ active: 0, failed: 2, percent: null });
    expect(html).toContain('activity.failed');
    expect(html).not.toContain('activity.active');
  });

  it('shows completion while only just-finished items remain', () => {
    expect(chip({ active: 0, failed: 0, percent: null })).toContain('activity.done');
  });
});

describe('activity tray', () => {
  it('renders nothing when there are no items', () => {
    expect(renderToStaticMarkup(<ActivityTray />)).toBe('');
  });

  it('renders the chip when something is tracked', () => {
    // Серверний рендер читає початковий знімок стору, тому вміст дається напряму у вигляд
    const html = renderToStaticMarkup(<ActivityTrayView items={[item()]} />);
    expect(html).toContain('data-slot="activity-chip"');
    expect(html).toContain('activity.active');
  });
});

describe('activity row', () => {
  const row = (patch: Partial<ActivityItem>): string =>
    renderToStaticMarkup(<ActivityRow item={item(patch)} />);

  it('an active item offers cancel and shows a bar', () => {
    const html = row({ onCancel: () => undefined, progress: { current: 30, total: 120 } });
    expect(html).toContain('activity.cancel');
    expect(html).toContain('data-slot="progress"');
    expect(html).toContain('25%');
    expect(html).not.toContain('activity.dismiss');
    expect(html).not.toContain('activity.retry');
  });

  it('a failed item shows its error with retry and dismiss', () => {
    const html = row({
      status: 'failed',
      errorMessage: 'Connection lost',
      onRetry: () => undefined,
    });
    expect(html).toContain('Connection lost');
    expect(html).toContain('activity.retry');
    expect(html).toContain('activity.dismiss');
    expect(html).not.toContain('data-slot="progress"');
  });

  it('a failed item without a retry handler offers only dismiss', () => {
    const html = row({ status: 'failed', errorMessage: 'Too large' });
    expect(html).not.toContain('activity.retry');
    expect(html).toContain('activity.dismiss');
  });

  it('a cancelled item offers dismiss; a succeeded one needs no action', () => {
    expect(row({ status: 'canceled' })).toContain('activity.dismiss');
    const done = row({ status: 'succeeded' });
    expect(done).toContain('activity.status.succeeded');
    expect(done).not.toContain('activity.dismiss');
  });

  it('offers the step view only for an item made of stages', () => {
    expect(row({})).not.toContain('activity.toggleSteps');
    expect(row({ steps: [{ key: 's', label: 'Uploading', status: 'running' }] })).toContain(
      'activity.toggleSteps',
    );
  });
});
