import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityDock, ActivityDockView, ActivityHeadlineText, ActivityRow } from './activity-dock';
import type { ActivityHeadline, ActivityItem } from '../lib/activity';

// i18next не ініціалізований: `t` повертає ключ — перевіряємо, ЯКИЙ текст і які дії обрано
const item = (patch: Partial<ActivityItem> = {}): ActivityItem => ({
  id: 'a',
  title: 'report.pdf',
  status: 'running',
  startedAt: 0,
  onDismiss: () => undefined,
  ...patch,
});

const noop = (): void => undefined;

describe('activity dock', () => {
  it('renders nothing when there are no items', () => {
    expect(renderToStaticMarkup(<ActivityDock />)).toBe('');
  });

  it('expanded: headline, controls and one row per item', () => {
    const html = renderToStaticMarkup(
      <ActivityDockView
        items={[item(), item({ id: 'b', title: 'photo.png', status: 'succeeded' })]}
        collapsed={false}
        onCollapsedChange={noop}
        onCloseAll={noop}
      />,
    );
    expect(html).toContain('data-slot="activity-dock"');
    expect(html).toContain('activity.collapse');
    expect(html).toContain('activity.close');
    expect(html.match(/data-slot="activity-row"/g)).toHaveLength(2);
  });

  it('collapsed: only the header stays', () => {
    const html = renderToStaticMarkup(
      <ActivityDockView items={[item()]} collapsed onCollapsedChange={noop} onCloseAll={noop} />,
    );
    expect(html).toContain('activity.expand');
    expect(html).not.toContain('data-slot="activity-row"');
  });
});

describe('dock headline', () => {
  const text = (headline: ActivityHeadline): string =>
    renderToStaticMarkup(<ActivityHeadlineText headline={headline} />);

  it('names uploads and adds the combined percentage', () => {
    const html = text({ tone: 'active', uploadsOnly: true, count: 3, percent: 64 });
    expect(html).toContain('activity.uploading');
    expect(html).toContain('64%');
  });

  it('speaks generally about mixed work and omits an unknown percentage', () => {
    const html = text({ tone: 'active', uploadsOnly: false, count: 2, percent: null });
    expect(html).toContain('activity.active');
    expect(html).not.toContain('%');
  });

  it('covers failures, completions and the neutral state', () => {
    expect(text({ tone: 'failed', count: 1 })).toContain('activity.failed');
    expect(text({ tone: 'done', uploadsOnly: true, count: 2 })).toContain('activity.uploadsComplete');
    expect(text({ tone: 'done', uploadsOnly: false, count: 2 })).toContain('activity.completed');
    expect(text({ tone: 'idle' })).toContain('activity.title');
  });
});

describe('dock row', () => {
  const row = (patch: Partial<ActivityItem>): string =>
    renderToStaticMarkup(<ActivityRow item={item(patch)} />);

  it('an active item offers cancel, not dismiss', () => {
    const html = row({ onCancel: noop, progress: { current: 30, total: 120 } });
    expect(html).toContain('activity.cancel');
    expect(html).toContain('25%');
    expect(html).not.toContain('activity.dismiss');
  });

  it('a failed item shows its error with retry and dismiss', () => {
    const html = row({ status: 'failed', errorMessage: 'Connection lost', onRetry: noop });
    expect(html).toContain('Connection lost');
    expect(html).toContain('activity.retry');
    expect(html).toContain('activity.dismiss');
  });

  it('a failed item without a retry handler offers only dismiss', () => {
    const html = row({ status: 'failed', errorMessage: 'Too large' });
    expect(html).not.toContain('activity.retry');
    expect(html).toContain('activity.dismiss');
  });

  it('a finished item can be dismissed and shows its action', () => {
    const html = row({ status: 'succeeded', action: { label: 'Download', run: noop } });
    expect(html).toContain('Download');
    expect(html).toContain('activity.dismiss');
    expect(row({ status: 'canceled' })).toContain('activity.status.canceled');
  });

  it('only an item made of stages can be expanded into steps', () => {
    expect(row({})).not.toContain('activity.toggleSteps');
    expect(row({ steps: [{ key: 's', label: 'Uploading', status: 'running' }] })).toContain(
      'activity.toggleSteps',
    );
  });
});
