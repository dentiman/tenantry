import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { Job } from 'pg-boss';
import { JobHandler, JobHandlerContract } from './job-handler.decorator';
import { PgBossService } from './pg-boss.service';

/**
 * При старті воркера знаходить усі класи з @JobHandler(),
 * створює черги, реєструє обробники та cron-розклади в pg-boss.
 */
@Injectable()
export class JobWorkerRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobWorkerRegistrar.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly pgBoss: PgBossService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const wrappers = this.discovery.getProviders({ metadataKey: JobHandler.KEY });

    for (const wrapper of wrappers) {
      const definition = this.discovery.getMetadataByDecorator(JobHandler, wrapper);
      if (!definition) {
        continue;
      }
      const handler = wrapper.instance as JobHandlerContract;

      await this.pgBoss.ensureQueue(definition);
      await this.pgBoss.boss.work(definition.name, async (jobs: Job[]) => {
        for (const job of jobs) {
          const payload = definition.schema.parse(job.data);
          await handler.handle(payload, { id: job.id, name: job.name });
        }
      });

      if (definition.options.cron) {
        await this.pgBoss.boss.schedule(definition.name, definition.options.cron, {});
      }

      this.logger.log(
        `Registered job handler: ${definition.name}` +
          (definition.options.cron ? ` (cron: ${definition.options.cron})` : ''),
      );
    }
  }
}
