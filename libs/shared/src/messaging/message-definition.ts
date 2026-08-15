import { z } from 'zod';

/**
 * Подія — факт, що стався (0..N підписників, контракт публічний і версіонований).
 * Команда — наказ виконати роботу (рівно 1 споживач, контракт приватний).
 *
 * Різниця ТІЛЬКИ семантична і в кількості споживачів у маніфесті: рантайм-конвеєр
 * (конверт, runner, inbox, DLQ) для обох один — docs/event-driven-architecture.md §3.1.1.
 */
export type MessageKind = 'event' | 'command';

/**
 * - 'tenant': конверт несе tenantId із контексту; воркер піднімає CLS, Prisma працює
 *   під RLS як у HTTP-запиті.
 * - 'system': крос-tenant (cron/maintenance); tenantId у конверті null, БД — через
 *   SystemPrismaService (BYPASSRLS).
 */
export type MessageScope = 'tenant' | 'system';

export interface MessageDefinition<TSchema extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly kind: MessageKind;
  readonly scope: MessageScope;
  /** Схема ТІЛЬКИ корисних даних — усе інфраструктурне живе в конверті */
  readonly schema: TSchema;
}

export type MessageData<TDef> =
  TDef extends MessageDefinition<infer TSchema> ? z.output<TSchema> : never;

export type MessageInput<TDef> =
  TDef extends MessageDefinition<infer TSchema> ? z.input<TSchema> : never;

/**
 * Подія. Версія в імені обов'язкова на рівні типу: несумісна зміна схеми = нове ім'я
 * `.v2`, під час переїзду продюсер публікує обидві версії.
 *
 * tenantId у схемі НЕ оголошується (на відміну від старого defineTenantJob) — він
 * переїхав у конверт, тому доменні дані лишаються суто доменними.
 */
export function defineEvent<TShape extends z.ZodRawShape>(
  name: `${string}.v${number}`,
  schema: z.ZodObject<TShape>,
  options: { scope?: MessageScope } = {},
): MessageDefinition<z.ZodObject<TShape>> {
  return { name, kind: 'event', scope: options.scope ?? 'tenant', schema };
}

/**
 * Команда: версії немає (контракт приватний — продюсер і споживач їдуть одним комітом).
 * Cron-команда оголошується так само, а розклад живе в маніфесті поруч зі споживачем.
 */
export function defineCommand<TShape extends z.ZodRawShape>(
  name: string,
  schema: z.ZodObject<TShape>,
  options: { scope?: MessageScope } = {},
): MessageDefinition<z.ZodObject<TShape>> {
  return { name, kind: 'command', scope: options.scope ?? 'tenant', schema };
}
