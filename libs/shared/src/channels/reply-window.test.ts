import { describe, expect, it } from 'vitest';
import type { ChannelAdapter } from './channel-adapter';
import { replyWindow } from './reply-window';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 3_600_000);

function adapter(
  overrides: Partial<ChannelAdapter['capabilities']> = {},
): Pick<ChannelAdapter, 'capabilities'> {
  return {
    capabilities: {
      freeformWindowHours: 24,
      maxTextLength: 4096,
      templates: true,
      windowEnforcement: 'local',
      ...overrides,
    },
  };
}

describe('replyWindow', () => {
  it('локальне правило: відкрите до 24 год від останнього вхідного, далі закрите', () => {
    expect(replyWindow(adapter(), hoursAgo(23), NOW)).toMatchObject({ canReply: true });
    expect(replyWindow(adapter(), hoursAgo(25), NOW)).toMatchObject({ canReply: false });
    expect(replyWindow(adapter(), hoursAgo(23), NOW).endsAt?.getTime()).toBe(
      hoursAgo(23).getTime() + 24 * 3_600_000,
    );
  });

  it('local без жодного вхідного — закрите (клієнт ще не писав)', () => {
    expect(replyWindow(adapter(), null, NOW)).toEqual({ canReply: false, endsAt: null });
  });

  it('provider без жодного відомого вхідного — НЕ блокуємо: вирішує провайдер', () => {
    expect(replyWindow(adapter({ windowEnforcement: 'provider' }), null, NOW)).toEqual({
      canReply: true,
      endsAt: null,
    });
  });

  it('provider, коли вхідне відоме: діє локальне правило, як для будь-якого', () => {
    const meta = adapter({ windowEnforcement: 'provider' });
    expect(replyWindow(meta, hoursAgo(2), NOW).canReply).toBe(true);
    expect(replyWindow(meta, hoursAgo(30), NOW).canReply).toBe(false);
  });

  it('провайдер без вікна — завжди можна; невідомий адаптер — ні', () => {
    expect(replyWindow(adapter({ freeformWindowHours: undefined }), null, NOW)).toEqual({
      canReply: true,
      endsAt: null,
    });
    expect(replyWindow(undefined, hoursAgo(1), NOW).canReply).toBe(false);
  });
});
