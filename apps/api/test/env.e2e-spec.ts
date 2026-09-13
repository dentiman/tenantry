/// <reference types="jest" />

import { validateApiEnv } from '../src/config/env.schema';

// AUTH-0 (FR-010, SC-004): процес із небезпечним секретом не стартує.
// Перевіряється сама валідація, а не bootstrap: ConfigModule кличе її синхронно при
// ініціалізації, і помилка звідси — рівно та, що зупиняє старт.

const STRONG_SECRET = 'a'.repeat(16) + 'B'.repeat(16) + '0123456789';

describe('API env validation (AUTH-0)', () => {
  it('accepts a strong secret', () => {
    expect(() => validateApiEnv({ JWT_SECRET: STRONG_SECRET })).not.toThrow();
  });

  it('rejects a missing JWT_SECRET', () => {
    expect(() => validateApiEnv({})).toThrow(/JWT_SECRET/);
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => validateApiEnv({ JWT_SECRET: 'x'.repeat(31) })).toThrow(/JWT_SECRET/);
  });

  it('rejects the literal value from .env.example', () => {
    expect(() =>
      validateApiEnv({ JWT_SECRET: 'change-me-in-production-min-32-chars-secret-key-here' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('rejects malformed CORS_ALLOWED_ORIGINS', () => {
    expect(() =>
      validateApiEnv({ JWT_SECRET: STRONG_SECRET, CORS_ALLOWED_ORIGINS: 'not a url' }),
    ).toThrow(/CORS_ALLOWED_ORIGINS/);
  });

  it('rejects a non-numeric rate limit', () => {
    expect(() =>
      validateApiEnv({ JWT_SECRET: STRONG_SECRET, AUTH_LOGIN_LIMIT_PER_MINUTE: 'five' }),
    ).toThrow(/AUTH_LOGIN_LIMIT_PER_MINUTE/);
  });
});
