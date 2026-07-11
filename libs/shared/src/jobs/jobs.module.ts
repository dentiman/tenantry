import { DynamicModule, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { JobDispatcher } from './job-dispatcher';
import { JobInboxService } from './job-inbox.service';
import { JobWorkerRegistrar } from './job-worker.registrar';
import { PgBossJobDispatcher } from './pg-boss.dispatcher';
import { PgBossService } from './pg-boss.service';

const dispatcherProviders = [
  PgBossService,
  { provide: JobDispatcher, useClass: PgBossJobDispatcher },
];

@Module({})
export class JobsModule {
  /** API та інші продюсери: тільки відправлення job-ів */
  static forApi(): DynamicModule {
    return {
      module: JobsModule,
      global: true,
      providers: dispatcherProviders,
      exports: [JobDispatcher],
    };
  }

  /** Worker: відправлення + обробка (@JobHandler-класи знаходяться автоматично) */
  static forWorker(): DynamicModule {
    return {
      module: JobsModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [...dispatcherProviders, JobInboxService, JobWorkerRegistrar],
      exports: [JobDispatcher, JobInboxService],
    };
  }
}
