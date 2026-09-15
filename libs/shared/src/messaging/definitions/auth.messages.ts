import { z } from 'zod';
import { defineEvent } from '../message-definition';

/**
 * AUTH-3: листи відновлення доступу. `tokenEncrypted`, а НЕ сирий токен (план D-11,
 * analyze E1): `pgboss.*` сидить поза RLS, job живе в черзі ~7 днів (і довше в DLQ),
 * а екран Jobs у platform-web показує повний `data` — сирий токен дав би оператору
 * платформи (і будь-кому з читанням pgboss) захоплення акаунта на 60 хв наперед.
 * API шифрує (`CryptoService.encrypt`) ПЕРЕД `publish`, воркер розшифровує лише в
 * пам'яті безпосередньо перед рендером листа.
 */
export const passwordResetRequestedEvent = defineEvent(
  'auth.password-reset-requested.v1',
  z.object({
    userId: z.uuid(),
    tokenEncrypted: z.string().startsWith('v1:'),
  }),
);

export const emailChangeRequestedEvent = defineEvent(
  'auth.email-change-requested.v1',
  z.object({
    userId: z.uuid(),
    tokenEncrypted: z.string().startsWith('v1:'),
    newEmail: z.email(),
  }),
);

/** Повідомлення НА СТАРУ адресу — власник міг не ініціювати зміну сам */
export const emailChangedEvent = defineEvent(
  'auth.email-changed.v1',
  z.object({
    userId: z.uuid(),
    previousEmail: z.email(),
  }),
);
