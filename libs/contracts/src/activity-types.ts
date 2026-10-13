import { z } from 'zod';
import {
  mergeTypeGroups,
  type ActivityTypeDef,
  type TypeTexts,
} from './activity/activity-definition';
import { USER_ACTIVITIES } from './user/user.activities';
import { AUTH_ACTIVITIES } from './auth/auth.activities';
import { CUSTOMER_ACTIVITIES } from './customer/customer.activities';
import { SETTINGS_ACTIVITIES } from './settings/settings.activities';
import { CALENDAR_ACTIVITIES } from './calendar/calendar.activities';
import { CHAT_ACTIVITIES } from './chat/chat.activities';

/**
 * Composition root типів активності (docs/modules.md §7.1): єдине місце, що знає,
 * які модулі пишуть у журнал. Визначення — у контрактах власників; прибираючи фічу з форку,
 * прибери її рядок тут. Порядок груп — порядок значень enum-а в OpenAPI.
 */
export const ACTIVITY_DEFINITIONS = mergeTypeGroups(
  USER_ACTIVITIES,
  AUTH_ACTIVITIES,
  CUSTOMER_ACTIVITIES,
  SETTINGS_ACTIVITIES,
  CALENDAR_ACTIVITIES,
  CHAT_ACTIVITIES,
);

export type ActivityType = Extract<keyof typeof ACTIVITY_DEFINITIONS, string>;

/** Закритий перелік типів — виводиться з визначень, руками не дописується */
export const ACTIVITY_TYPES = Object.keys(ACTIVITY_DEFINITIONS) as readonly ActivityType[];
export const ActivityTypeSchema = z.enum(ACTIVITY_TYPES as [ActivityType, ...ActivityType[]]);

/** Payload-схема по типу: recorder валідує на записі, фронт знає форму для рендеру */
export const ACTIVITY_PAYLOAD_SCHEMAS = Object.fromEntries(
  ACTIVITY_TYPES.map((type) => [type, ACTIVITY_DEFINITIONS[type].payload]),
) as { readonly [K in ActivityType]: (typeof ACTIVITY_DEFINITIONS)[K]['payload'] };

/**
 * Типи, дозволені в загальній стрічці воркспейсу: рішення приймає модуль-власник типу
 * (`workspace: true` у його визначенні), цей список лише збирає їх разом. Закритий і виводиться
 * з визначень — як і весь перелік типів, руками не дописується.
 */
export const WORKSPACE_ACTIVITY_TYPES: readonly ActivityType[] = ACTIVITY_TYPES.filter(
  (type) => (ACTIVITY_DEFINITIONS[type] as ActivityTypeDef).workspace === true,
);

export type ActivityDefinition = ActivityTypeDef & { readonly texts: TypeTexts };

/** Визначення за рядком із відповіді API; `undefined` — фронт старіший за бекенд */
export function activityDefinition(type: string): ActivityDefinition | undefined {
  return (ACTIVITY_DEFINITIONS as Partial<Record<string, ActivityDefinition>>)[type];
}
