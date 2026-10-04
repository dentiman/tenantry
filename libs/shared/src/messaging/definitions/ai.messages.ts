import { z } from 'zod';
import { defineCommand } from '../message-definition';

/**
 * Генерація відповіді асистента (docs/ai-assistant-plan.md, фаза AI-0).
 *
 * Команда, а не подія: споживач рівно один, і контракт приватний — продюсер
 * (`apps/api`) і споживач (`apps/worker`) їдуть одним комітом.
 *
 * У payload-і лише ДВА id, без тексту питання і без історії. Причини дві:
 * pgboss.* лежить ПОЗА RLS, тому вміст розмови там був би доступний крос-tenant
 * на рівні схеми; і рядок `ai_messages` однаково лишається джерелом правди —
 * воркер читає його під tenant-контекстом із конверта.
 *
 * `tenantId` тут не оголошується — він їде в конверті.
 */
export const generateAiReplyCommand = defineCommand(
  'ai.generate-reply',
  z.object({
    conversationId: z.uuid(),
    /** Рядок ВІДПОВІДІ (роль ASSISTANT), створений у статусі PENDING */
    messageId: z.uuid(),
  }),
);

/**
 * Нічна чистка розмов старших за `AI_RETENTION_DAYS` (ai-1e, docs/ai-assistant.md §9.2).
 * System-scope — крос-tenant, БД через SystemPrismaService (BYPASSRLS), той самий патерн,
 * що `files.cleanup-orphans`. Жорстке видалення: `AiMessage` каскадиться з `AiConversation`.
 */
export const purgeAiConversationsCommand = defineCommand('ai.purge-conversations', z.object({}), {
  scope: 'system',
});

/**
 * Добір фактичної вартості спроб без usage-кадру (AI-5b, docs/ai-platform-controls.md §3.1,
 * design.md R5): рядки журналу `pending` → `GET /api/v1/generation?id=`. System-scope:
 * крос-tenant, UPDATE журналу дозволено лише `saas_platform`.
 */
export const reconcileAiUsageCostsCommand = defineCommand(
  'ai.reconcile-usage-costs',
  z.object({}),
  { scope: 'system' },
);

/**
 * Щоденна синхронізація тарифів з публічних списків OpenRouter (AI-5b, design.md R7). Та
 * сама функція, що кнопка «Sync» у platform-web.
 */
export const syncAiModelPricesCommand = defineCommand('ai.sync-model-prices', z.object({}), {
  scope: 'system',
});
