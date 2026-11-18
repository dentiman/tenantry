import { z } from 'zod';
import { defineCommand } from '../message-definition';

/**
 * Експорт клієнтів у CSV — операція користувача (docs/user-operations.md, openspec:
 * customers/export). Payload — лише id операції: параметри (фільтри) лежать у самій операції,
 * і воркер читає їх звідти, а не з job-а (pgboss.* поза RLS, фільтри можуть містити пошуковий
 * рядок).
 */
export const exportCustomersCommand = defineCommand(
  'customers.export',
  z.object({ userOperationId: z.uuid() }),
);
