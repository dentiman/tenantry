import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { TenantContextService } from '@saas-skeleton/database';
import type { Job } from 'pg-boss';
import type { JobDefinition } from './job-definition';
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
    private readonly tenantContext: TenantContextService,
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
          await this.runJob(definition, handler, job);
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

  /**
   * Лог-конверт довкола хендлера: pg-boss падіння хендлера НЕ логує (пише лише
   * в pgboss.job.output), тому без цього try/catch впала job невидима в логах.
   * Помилка re-throw-иться, щоб pg-boss позначив job failed і застосував retry-політику.
   *
   * MT-1: CLS не перетинає межу процесу — для tenant-джоб контекст ВІДНОВЛЮЄТЬСЯ
   * з payload.tenantId (дзеркало HTTP: там tenantId із JWT). Хендлери про це не знають —
   * їхні Prisma-виклики проходять через tenant-extension як у API. System-джоби
   * контексту не мають і ходять у БД через SystemPrismaService (BYPASSRLS).
   */
  private async runJob(
    definition: JobDefinition,
    handler: JobHandlerContract,
    job: Job,
  ): Promise<void> {
    const payload = definition.schema.parse(job.data);
    const tenantId =
      definition.options.scope === 'tenant'
        ? (payload as { tenantId: string }).tenantId
        : undefined;

    const meta = { jobId: job.id, jobName: job.name, ...(tenantId && { tenantId }) };
    const startedAt = Date.now();
    this.logger.debug(meta, `Job started: ${job.name} (${job.id})`);
    try {
      const context = { id: job.id, name: job.name };
      if (tenantId) {
        await this.tenantContext.runWith(tenantId, () => handler.handle(payload, context));
      } else {
        await this.tenantContext.runWithout(() => handler.handle(payload, context));
      }
      this.logger.log(
        { ...meta, durationMs: Date.now() - startedAt },
        `Job completed: ${job.name} (${job.id})`,
      );
    } catch (error) {
      this.logger.error(
        { ...meta, err: error, durationMs: Date.now() - startedAt },
        `Job failed: ${job.name} (${job.id})`,
      );
      throw error;
    }
  }
}
