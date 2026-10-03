import { describe, expect, it } from 'vitest';
import type { AiConfig } from '@saas-skeleton/shared';
import { AiLeaseGuard } from './ai-lease.guard';

const BASE_CONFIG: AiConfig = {
  enabled: true,
  provider: 'fake',
  maxOutputTokens: 256,
  historyTurns: 10,
  requestTimeoutMs: 60_000,
  streamFlushMs: 120,
  partialPersistMs: 2_000,
  model: 'fake-1',
  modelConfigured: false,
  baseUrl: null,
  apiKey: null,
  providerRetries: 1,
  retryDelayMs: 2_000,
  pendingTimeoutMs: 300_000,
  cancelCheckMs: 2_000,
  leaseMs: 90_000, // 60_000 + AI_LEASE_GRACE_MS
  retentionDays: 90,
  quotaUserDailyTokens: 1_000_000,
  quotaTenantDailyTokens: 10_000_000,
  knowledge: {
    backend: 'static',
    product: null,
    vectorCandidates: 12,
    finalChunks: 5,
    maxContextTokens: 2_500,
    mode: 'vector',
    textCandidates: 12,
    maxDistance: null,
  },
};

describe('AiLeaseGuard', () => {
  it('дефолтний конфіг проходить: expireInSeconds (120s) перевищує lease + ретраї (92s)', () => {
    const guard = new AiLeaseGuard(BASE_CONFIG);
    expect(() => {
      guard.onApplicationBootstrap();
    }).not.toThrow();
  });

  it('валить старт, коли expireInSeconds не перевищує lease + ретраї', () => {
    // leaseMs 90s + 1 ретрай × 30s = 120s ЦІЛОЮ секунда-в-секунду з дефолтним
    // expireInSeconds 120s у топології — межова умова мусить впасти (СУВОРА нерівність)
    const guard = new AiLeaseGuard({ ...BASE_CONFIG, retryDelayMs: 30_000 });
    expect(() => {
      guard.onApplicationBootstrap();
    }).toThrow(/expireInSeconds/);
  });

  it('повідомлення про помилку називає обидва значення в мілісекундах', () => {
    const guard = new AiLeaseGuard({ ...BASE_CONFIG, leaseMs: 200_000 });
    expect(() => {
      guard.onApplicationBootstrap();
    }).toThrow(/120000ms.*202000ms/);
  });
});
