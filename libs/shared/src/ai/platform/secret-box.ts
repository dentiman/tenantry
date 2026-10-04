import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Шифрування ключа API провайдера в `platform_ai_settings` (AI-5a, design.md D3).
 *
 * AES-256-GCM: 12-байтовий випадковий IV на кожне шифрування, тег автентичності, AAD
 * прив'язує шифротекст до колонки — його не можна підставити в інше поле. Формат —
 * `v1:<iv>:<tag>:<ciphertext>` у base64, щоб змінити схему без міграції даних.
 *
 * Помилки ніколи не містять ні ключа, ні шифротексту.
 */
const VERSION = 'v1';
const AAD = Buffer.from('platform_ai_settings.api_key');

export type SecretBoxErrorCode = 'master-key-missing' | 'master-key-invalid' | 'secret-invalid';

export class SecretBoxError extends Error {
  constructor(readonly code: SecretBoxErrorCode) {
    super(code);
  }
}

/** `AI_SECRETS_KEY`: 32 байти в base64. Відсутній — `null` (шифрування недоступне) */
export function loadMasterKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.AI_SECRETS_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw.replace(/\s/g, '')) {
    throw new SecretBoxError('master-key-invalid');
  }
  return key;
}

export function encryptSecret(plaintext: string, masterKey: Buffer | null): string {
  if (!masterKey) throw new SecretBoxError('master-key-missing');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
    .join(':');
}

export function decryptSecret(stored: string, masterKey: Buffer | null): string {
  if (!masterKey) throw new SecretBoxError('master-key-missing');
  const [version, iv, tag, ciphertext] = stored.split(':');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new SecretBoxError('secret-invalid');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(iv, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Чужий майстер-ключ або підмінений шифротекст — однаково, без деталей
    throw new SecretBoxError('secret-invalid');
  }
}

/** Останні 4 символи для маски — достатньо, щоб упізнати ключ, і нічого не розкриває */
export function secretHint(plaintext: string): string {
  return plaintext.trim().slice(-4);
}

export function maskSecret(hint: string): string {
  return `••••${hint}`;
}
