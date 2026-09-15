import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM для секретів, що мусять пройти крізь недовірене сховище (AUTH-3, план
 * D-11): токени скидання пароля/зміни email у `pgboss.job` (поза RLS, ретеншн ~7
 * днів, екран Jobs у platform-web показує повний `data`), пізніше — секрет TOTP
 * у `users.totp_secret_encrypted` (AUTH-4).
 *
 * Формат — `v1:<iv b64>:<tag b64>:<ct b64>`: версія ПЕРШИМ сегментом лишає місце
 * для ротації ключа (`v2:` зі старим ключем ще розшифровує `v1:`, ще не переписаний).
 */
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.getOrThrow<string>('ENCRYPTION_KEY');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_LENGTH) {
      // Провал ТУТ, а не мовчазна деградація до слабшого шифру: без валідного
      // ключа шифрувати нема чим, і застосунок не має права стартувати
      throw new Error(
        `ENCRYPTION_KEY must decode to exactly ${String(KEY_LENGTH)} bytes (base64) — got ${String(key.length)}`,
      );
    }
    this.key = key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
      ':',
    );
  }

  decrypt(encoded: string): string {
    const parts = encoded.split(':');
    const [version, ivB64, tagB64, ctB64] = parts;
    if (parts.length !== 4 || version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
      throw new Error('Malformed encrypted payload — expected "v1:<iv>:<tag>:<ciphertext>"');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  }
}
