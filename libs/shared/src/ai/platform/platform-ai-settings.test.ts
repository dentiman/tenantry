import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadAiConfig } from '../ai.config';
import { RuntimeEmbeddingProvider } from '../knowledge/runtime-embedding-provider';
import { EmbeddingRequestError } from '../knowledge/openai-embedding-provider';
import {
  platformEnabled,
  resolveGenerationSettings,
  type PlatformAiSettingsRow,
} from './platform-ai-settings';
import {
  SecretBoxError,
  decryptSecret,
  encryptSecret,
  loadMasterKey,
  maskSecret,
  secretHint,
} from './secret-box';

const masterKey = randomBytes(32);
const KEY = 'sk-or-v1-platform-secret-1234';

const row = (overrides: Partial<PlatformAiSettingsRow> = {}): PlatformAiSettingsRow => ({
  enabled: true,
  provider: null,
  baseUrl: null,
  model: null,
  apiKeyEncrypted: null,
  apiKeyHint: null,
  ...overrides,
});

describe('secret box (AES-256-GCM)', () => {
  it('round-trips and never stores the plaintext', () => {
    const stored = encryptSecret(KEY, masterKey);
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain(KEY);
    expect(decryptSecret(stored, masterKey)).toBe(KEY);
  });

  it('uses a fresh IV every time', () => {
    expect(encryptSecret(KEY, masterKey)).not.toBe(encryptSecret(KEY, masterKey));
  });

  it('rejects a wrong master key or tampered ciphertext without leaking details', () => {
    const stored = encryptSecret(KEY, masterKey);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow(
      new SecretBoxError('secret-invalid'),
    );
    const parts = stored.split(':');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('x').toString('base64')].join(':');
    expect(() => decryptSecret(tampered, masterKey)).toThrow(SecretBoxError);
    expect(() => decryptSecret('v0:a:b:c', masterKey)).toThrow(SecretBoxError);
  });

  it('refuses to encrypt or decrypt without a master key', () => {
    expect(() => encryptSecret(KEY, null)).toThrow(new SecretBoxError('master-key-missing'));
    expect(() => decryptSecret('v1:a:b:c', null)).toThrow(new SecretBoxError('master-key-missing'));
  });

  it('loads a 32-byte base64 master key and rejects anything else', () => {
    expect(loadMasterKey({})).toBeNull();
    expect(loadMasterKey({ AI_SECRETS_KEY: masterKey.toString('base64') })?.equals(masterKey)).toBe(
      true,
    );
    expect(() => loadMasterKey({ AI_SECRETS_KEY: randomBytes(16).toString('base64') })).toThrow(
      new SecretBoxError('master-key-invalid'),
    );
    expect(() => loadMasterKey({ AI_SECRETS_KEY: 'not base64!' })).toThrow(SecretBoxError);
  });

  it('masks with the last four characters only', () => {
    expect(maskSecret(secretHint(KEY))).toBe('••••1234');
  });
});

describe('resolveGenerationSettings (platform over env)', () => {
  const env = loadAiConfig({
    AI_PROVIDER: 'openai-compat',
    AI_BASE_URL: 'https://env.example.com/v1',
    AI_API_KEY: 'sk-env',
    AI_MODEL: 'env-model',
  });

  it('no row: exactly the environment', () => {
    expect(resolveGenerationSettings(null, env, masterKey)).toMatchObject({
      provider: 'openai-compat',
      baseUrl: 'https://env.example.com/v1',
      model: 'env-model',
      apiKey: 'sk-env',
      sources: { provider: 'env', baseUrl: 'env', model: 'env', apiKey: 'env' },
    });
  });

  it('values set by the platform win and the key is decrypted', () => {
    const resolved = resolveGenerationSettings(
      row({
        provider: 'openai-compat',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-6-luna',
        apiKeyEncrypted: encryptSecret(KEY, masterKey),
        apiKeyHint: secretHint(KEY),
      }),
      env,
      masterKey,
    );
    expect(resolved).toMatchObject({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-6-luna',
      modelConfigured: true,
      apiKey: KEY,
      sources: { provider: 'platform', baseUrl: 'platform', model: 'platform', apiKey: 'platform' },
    });
  });

  it('a partial row overrides only what it sets', () => {
    const resolved = resolveGenerationSettings(row({ model: 'ui-model' }), env, masterKey);
    expect(resolved).toMatchObject({
      model: 'ui-model',
      apiKey: 'sk-env',
      sources: { model: 'platform', apiKey: 'env' },
    });
  });

  it('an encrypted key without the master key fails loudly', () => {
    const encrypted = row({ apiKeyEncrypted: encryptSecret(KEY, masterKey), apiKeyHint: '1234' });
    expect(() => resolveGenerationSettings(encrypted, env, null)).toThrow(SecretBoxError);
  });

  it('the platform switch cannot enable what the installation disables', () => {
    expect(platformEnabled(row({ enabled: true }), loadAiConfig({ AI_ENABLED: 'false' }))).toBe(
      false,
    );
    expect(platformEnabled(row({ enabled: false }), loadAiConfig({ AI_ENABLED: 'true' }))).toBe(
      false,
    );
    expect(platformEnabled(null, loadAiConfig({ AI_ENABLED: 'true' }))).toBe(true);
  });
});

describe('RuntimeEmbeddingProvider', () => {
  const config = loadAiConfig({});
  const settings = (
    value: PlatformAiSettingsRow | null,
  ): { read: () => Promise<PlatformAiSettingsRow | null> } => ({
    read: (): Promise<PlatformAiSettingsRow | null> => Promise.resolve(value),
  });
  const signal = new AbortController().signal;

  it('without any credentials fails the question, not the construction', async () => {
    const provider = new RuntimeEmbeddingProvider(config, settings(null), {});
    await expect(provider.embed(['q'], signal)).rejects.toEqual(
      new EmbeddingRequestError('embedding-not-configured'),
    );
  });

  it('an unsupported embeddings host is "not configured", not a crash', async () => {
    const provider = new RuntimeEmbeddingProvider(
      config,
      settings(
        row({
          baseUrl: 'https://api.deepseek.com/v1',
          apiKeyEncrypted: encryptSecret(KEY, masterKey),
          apiKeyHint: '1234',
        }),
      ),
      { AI_SECRETS_KEY: masterKey.toString('base64') },
    );
    await expect(provider.embed(['q'], signal)).rejects.toThrow();
  });
});
