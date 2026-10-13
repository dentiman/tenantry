/**
 * P2002 саме на індексі ідемпотентності. Перевіряємо ім'я індексу, а не факт
 * P2002: інше унікальне порушення (наприклад, гонка за seq) — це помилка, і
 * мовчки повертати на неї «той самий рядок» не можна.
 */
export function isClientMessageIdConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  if (error.code !== 'P2002') {
    return false;
  }
  const meta = 'meta' in error ? (error.meta as PrismaUniqueMeta | undefined) : undefined;
  // Прямий рушій дає `target` (імена колонок), а `adapter-pg` — лише текст помилки драйвера з
  // назвою індексу: без другої гілки гонка двох однакових запитів повертала б 409 замість
  // рядка переможця
  const targets = Array.isArray(meta?.target) ? meta.target : [meta?.target];
  const driverMessage = meta?.driverAdapterError?.cause?.originalMessage ?? '';
  return (
    targets.some((entry) => String(entry).includes('client_message_id')) ||
    driverMessage.includes('client_message_id')
  );
}

interface PrismaUniqueMeta {
  target?: unknown;
  driverAdapterError?: { cause?: { originalMessage?: string } };
}
