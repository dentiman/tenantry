import { z } from 'zod';

export interface JobRetryOptions {
  retryLimit?: number;
  retryDelaySeconds?: number;
  retryBackoff?: boolean;
}

export interface JobDefinitionOptions extends JobRetryOptions {
  /** Cron-розклад: worker реєструє його в pg-boss schedule при старті */
  cron?: string;
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

export type JobPayload<TDef> = TDef extends JobDefinition<infer TSchema> ? z.output<TSchema> : never;

export function defineJob<TSchema extends z.ZodType>(
  name: string,
  schema: TSchema,
  options: JobDefinitionOptions = {},
): JobDefinition<TSchema> {
  return { name, schema, options };
}
