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
