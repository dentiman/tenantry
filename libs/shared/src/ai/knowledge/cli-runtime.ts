import { AsyncLocalStorage } from 'node:async_hooks';
import { ClsService, type ClsStore } from 'nestjs-cls';
import { PrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import { OpenAiEmbeddingProvider } from './openai-embedding-provider';

export function embeddingProviderFromEnv(): OpenAiEmbeddingProvider {
  // A separately configured endpoint must also provide its own credential.
  // An empty value counts as unset, hence `some(Boolean)` rather than `??`.
  const dedicated = [process.env.AI_EMBEDDING_BASE_URL, process.env.AI_EMBEDDING_API_KEY].some(
    Boolean,
  );
  const baseUrl = dedicated ? process.env.AI_EMBEDDING_BASE_URL : process.env.AI_BASE_URL;
  const apiKey = dedicated ? process.env.AI_EMBEDDING_API_KEY : process.env.AI_API_KEY;
  if (!baseUrl || !apiKey)
    throw new Error(
      'Configure AI_EMBEDDING_BASE_URL and AI_EMBEDDING_API_KEY (or AI_BASE_URL and AI_API_KEY)',
    );
  return new OpenAiEmbeddingProvider({
    baseUrl,
    apiKey,
    timeoutMs: Number(process.env.AI_EMBEDDING_TIMEOUT_MS ?? 45000),
    retries: Number(process.env.AI_EMBEDDING_RETRIES ?? 2),
  });
}

/** Trusted operator CLI only. Domain services receive no tenant argument. */
export async function withKnowledgeTenant<T>(
  tenant: string,
  fn: (tx: TenantTransactions) => Promise<T>,
): Promise<T> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const [role] = await prisma.$queryRaw<
      { current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]
    >`
      SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    if (role?.current_user !== 'saas_app' || role.rolsuper || role.rolbypassrls)
      throw new Error('Knowledge CLI requires the restricted saas_app database role');
    // `tenants` is under RLS (own row only), so a lookup outside tenant context sees
    // nothing. Slugs go through resolve_tenant() like login; an id is verified in-context.
    const [resolved] = await prisma.$queryRaw<{ id: string | null }[]>`
      SELECT resolve_tenant(${tenant}) AS id`;
    const tenantId = resolved?.id ?? tenant;
    const context = new TenantContextService(new ClsService(new AsyncLocalStorage<ClsStore>()));
    const transactions = new TenantTransactions(prisma, context);
    return await context.runWith(tenantId, async () => {
      const active = await transactions.withTenantTx((tx) =>
        tx.tenant.count({ where: { id: tenantId, isActive: true } }),
      );
      if (!active) throw new Error('Active tenant not found');
      return fn(transactions);
    });
  } finally {
    await prisma.$disconnect();
  }
}

export function cliCancellation(): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  return {
    signal: controller.signal,
    dispose: (): void => {
      process.off('SIGINT', abort);
      process.off('SIGTERM', abort);
    },
  };
}
