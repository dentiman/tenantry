import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantLifecycleHooks } from './tenant-lifecycle.hooks';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, TenantLifecycleHooks],
  // Фічі (chat) реєструють свої дії в транзакції появи тенанта, а tenants їх не
  // імпортує (docs/modules.md §7.3)
  exports: [TenantLifecycleHooks],
})
export class TenantsModule {}
