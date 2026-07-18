import { z } from 'zod';

export interface JobRetryOptions {
  retryLimit?: number;
  retryDelaySeconds?: number;
  retryBackoff?: boolean;
}

/**
 * MT-1: scope джоби.
 * - 'tenant': payload ОБОВ'ЯЗКОВО несе tenantId (гарантує defineTenantJob);
 *   dispatcher домішує його з контексту, worker піднімає CLS із payload.
 * - 'system': крос-tenant (cron/maintenance); контекст не піднімається,
 *   хендлер ходить у БД через SystemPrismaService (BYPASSRLS).
 */
export type JobScope = 'tenant' | 'system';

export interface JobDefinitionOptions extends JobRetryOptions {
  /** Cron-розклад: worker реєструє його в pg-boss schedule при старті */
  cron?: string;
  scope?: JobScope;
}

/**
 * Опис job-а — єдине джерело правди для назви черги, схеми payload-а
 * та політики retry. Використовується і диспатчером (API), і воркером.
 */
export interface JobDefinition<TSchema extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly schema: TSchema;
  readonly options: JobDefinitionOptions;
}

export type JobPayload<TDef> =
  TDef extends JobDefinition<infer TSchema> ? z.output<TSchema> : never;

/** Схема, яку defineTenantJob домішує до кожної tenant-джоби */
export const tenantJobBaseSchema = z.object({ tenantId: z.uuid() });

export type TenantJobSchema<TShape extends z.ZodRawShape> = z.ZodObject<
  TShape & { tenantId: z.ZodUUID }
>;

/**
 * defineJob — системні/інфраструктурні джоби (scope: 'system' за замовчуванням):
 * оголосити tenant-джобу «забувши» tenantId цим шляхом неможливо.
 */
export function defineJob<TSchema extends z.ZodType>(
  name: string,
  schema: TSchema,
  options: JobDefinitionOptions = {},
): JobDefinition<TSchema> {
  return { name, schema, options: { scope: 'system', ...options } };
}

/**
 * defineTenantJob — доменні джоби: схема примусово розширюється tenantId
 * (єдиний спосіб оголосити tenant-джобу). Доменний код tenantId НЕ передає —
 * його домішує JobDispatcher із tenant-контексту.
 */
export function defineTenantJob<TShape extends z.ZodRawShape>(
  name: string,
  schema: z.ZodObject<TShape>,
  options: Omit<JobDefinitionOptions, 'scope'> = {},
): JobDefinition<TenantJobSchema<TShape>> {
  return {
    name,
    schema: schema.extend(tenantJobBaseSchema.shape) as TenantJobSchema<TShape>,
    options: { ...options, scope: 'tenant' },
  };
}
