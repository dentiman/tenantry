import { describe, expect, it, vi } from 'vitest';
import { CHANNEL_LOG_RETENTION_DAYS } from '@saas-skeleton/shared';
import type { SystemPrismaService } from '@saas-skeleton/database';
import { ChannelsPurgeLogsSubscriber } from './channels-purge-logs.subscriber';

describe('ChannelsPurgeLogsSubscriber', () => {
  it('видаляє записи старші за термін зберігання і лише їх', async () => {
    const deleteMany = vi.fn(() => Promise.resolve({ count: 3 }));
    const subscriber = new ChannelsPurgeLogsSubscriber({ channelLog: { deleteMany } } as unknown as SystemPrismaService);

    const before = Date.now();
    await subscriber.handle();
    const after = Date.now();

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const cutoff = (deleteMany.mock.calls[0] as unknown as [{ where: { createdAt: { lt: Date } } }])[0].where.createdAt.lt.getTime();
    const retentionMs = CHANNEL_LOG_RETENTION_DAYS * 24 * 3_600_000;
    expect(cutoff).toBeGreaterThanOrEqual(before - retentionMs);
    expect(cutoff).toBeLessThanOrEqual(after - retentionMs);
  });

  it('термін зберігання — 30 днів (design.md D8)', () => {
    expect(CHANNEL_LOG_RETENTION_DAYS).toBe(30);
  });
});
