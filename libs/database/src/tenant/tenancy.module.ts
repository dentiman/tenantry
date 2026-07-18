import { DynamicModule, MiddlewareConsumer, Module, NestModule, Type } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { TenantContextService } from './tenant-context.service';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware';
import { TenantResolver } from './tenant-resolver';
import { TenantTransactions } from './tenant-transactions.service';

export interface TenancyModuleOptions {
  /**
   * Стратегія резолюції tenant-а ДО автентифікації (HTTP). Не передавати у worker —
   * там tenantId приходить у payload джоби (JobWorkerRegistrar піднімає контекст сам).
   */
  resolver?: Type<TenantResolver>;
}

/**
 * Модуль тенантності (§6 multi-tenancy-plan.md) — ЄДИНЕ місце, де застосунок
 * згадує мультитенантність. Режим = вибір резолвера в корені:
 * StaticTenantResolver (N=1) / SlugTenantResolver (MT-3) / без резолвера (worker).
 * platform-api цей модуль НЕ імпортує взагалі (ходить через SystemPrismaService).
 * Модуль ОБОВ'ЯЗКОВИЙ для tenant-застосунків: без set_config DB-default колонки
 * tenant_id падає на INSERT, а RLS (MT-2) дає нуль рядків — fail-closed.
 */
@Module({})
export class TenancyModule implements NestModule {
  static forRoot(options: TenancyModuleOptions = {}): DynamicModule {
    const resolverProviders = options.resolver
      ? [{ provide: TenantResolver, useClass: options.resolver }]
      : [];

    return {
      module: TenancyModule,
      global: true,
      imports: [ClsModule.forRoot({ global: true })],
      providers: [TenantContextService, TenantTransactions, ...resolverProviders],
      exports: [
        TenantContextService,
        TenantTransactions,
        ...(options.resolver ? [TenantResolver] : []),
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // На ВСІ роути, включно з @Public() (login/refresh теж потребують tenant-контексту).
    // У worker (createApplicationContext, без HTTP) middleware не монтується — і не треба.
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
