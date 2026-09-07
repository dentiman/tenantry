import { z } from 'zod';
import { defineCommand } from '../message-definition';

/**
 * Сканер відкладених сповіщень (docs/calendar.md §8.3, roadmap §2.1).
 *
 * Cron раз на хвилину — тобто точність нагадування ±60 с, і це свідомо: секундна
 * точність вимагала б або постійного polling-у, або довгоживучих таймерів у
 * процесі, які не переживають rolling deploy. «За 30 хвилин» із хвилинною
 * точністю — рівно те, що дає Google.
 *
 * scope: 'system' — сканер шукає дозріле ПО ВСІХ тенантах під
 * `SystemPrismaService` (BYPASSRLS), а потім піднімає tenant-контекст на кожен
 * знайдений тенант окремо: доставка вже йде під RLS, як звичайний доменний код.
 *
 * Черга тут робить те, що вміє (надійний періодичний запуск), а СТАН нагадувань
 * лишається в доменній таблиці під RLS — на відміну від `startAfter`, який
 * поклав би його в `pgboss.*` поза RLS (§8.2 доку).
 */
export const dispatchScheduledNotificationsCommand = defineCommand(
  'notifications.dispatch-scheduled',
  z.object({}),
  { scope: 'system' },
);
