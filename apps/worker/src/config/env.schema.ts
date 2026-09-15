import { z } from 'zod';

/**
 * Env воркера, перевірений на СТАРТІ (AUTH-3, план D-11): без валідного
 * `ENCRYPTION_KEY` процес не має права піднятись — інакше перший же лист із
 * реального payload-у впав би в рантаймі на `CryptoService.decrypt`.
 *
 * `looseObject`: решта env (SMTP_*, DATABASE_URL …) має робочі дефолти і схемою
 * не перевіряється — вона не має ламати `pnpm docker:up` + `pnpm worker:dev`.
 */
const KEY_LENGTH = 32;

const encryptionKeySchema = z.string().refine(
  (value) => {
    try {
      return Buffer.from(value, 'base64').length === KEY_LENGTH;
    } catch {
      return false;
    }
  },
  { message: `must be base64 and decode to exactly ${String(KEY_LENGTH)} bytes` },
);

export const WorkerEnvSchema = z.looseObject({
  ENCRYPTION_KEY: encryptionKeySchema,
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

/** `ConfigModule.forRoot({ validate })` — кидає зі списком усіх порушень одразу */
export function validateWorkerEnv(config: Record<string, unknown>): WorkerEnv {
  const parsed = WorkerEnvSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  return parsed.data;
}
