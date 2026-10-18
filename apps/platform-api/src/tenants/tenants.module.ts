import { Module } from '@nestjs/common';
import { ActivitiesModule } from '@saas-skeleton/shared/activities';
import { TenantsController } from './tenants.controller';
import { TenantActivitiesController } from './tenant-activities.controller';
import { TenantActivitiesService } from './tenant-activities.service';
import { TenantUsersController } from './tenant-users.controller';
import { TenantUsersService } from './tenant-users.service';
import { TenantsService } from './tenants.service';
import { TenantLifecycleHooks } from './tenant-lifecycle.hooks';

@Module({
  imports: [ActivitiesModule],
  controllers: [TenantsController, TenantUsersController, TenantActivitiesController],
  providers: [TenantsService, TenantUsersService, TenantActivitiesService, TenantLifecycleHooks],
  // Фічі (chat) реєструють свої дії в транзакції появи тенанта, а tenants їх не
  // імпортує (docs/modules.md §7.3)
  exports: [TenantLifecycleHooks],
})
export class TenantsModule {}
