import { Injectable, Logger } from '@nestjs/common';
import { TenantContextService } from '@saas-skeleton/database';
import { fromPrisma } from 'pg-boss';
import type { SendOptions } from 'pg-boss';
import { z } from 'zod';
import type { JobDefinition } from './job-definition';
import { JobDispatcher, JobSendOptions, JobSendPayload } from './job-dispatcher';
import { PgBossService } from './pg-boss.service';

@Injectable()
export class PgBossJobDispatcher extends JobDispatcher {
  private readonly logger = new Logger(PgBossJobDispatcher.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly tenantContext: TenantContextService,
  ) {
    super();
  }

  async send<TSchema extends z.ZodType>(
    definition: JobDefinition<TSchema>,
    payload: JobSendPayload<TSchema>,
    options: JobSendOptions = {},
  ): Promise<string | null> {
    // MT-1: tenant-джоба отримує tenantId з контексту ДО parse (схема його вимагає).
    // Відсутній контекст = помилка постановки — fail-closed, а не джоба «в нікуди».
    const withTenant =
      definition.options.scope === 'tenant'
        ? { ...payload, tenantId: payload.tenantId ?? this.tenantContext.requireTenantId() }
        : payload;
    const data = definition.schema.parse(withTenant) as object;
    await this.pgBoss.ensureQueue(definition);

    // pg-boss валідує кожен переданий ключ — undefined-значення передавати не можна
    const sendOptions: SendOptions = {};
    if (options.singletonKey !== undefined) {
      sendOptions.singletonKey = options.singletonKey;
    }
    if (options.startAfterSeconds !== undefined) {
      sendOptions.startAfter = options.startAfterSeconds;
    }
    if (options.priority !== undefined) {
      sendOptions.priority = options.priority;
    }
    if (options.tx !== undefined) {
      sendOptions.db = fromPrisma(options.tx);
    }

    const jobId = await this.pgBoss.boss.send(definition.name, data, sendOptions);

    this.logger.debug(`Dispatched job ${definition.name} (id: ${jobId ?? 'deduplicated'})`);
    return jobId;
  }
}
