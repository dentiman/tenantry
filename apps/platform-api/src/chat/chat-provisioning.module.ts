import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { ensureDefaultChannel, joinDefaultChannel } from '@saas-skeleton/shared/chat';
import { TenantLifecycleHooks } from '../tenants/tenant-lifecycle.hooks';
import { TenantsModule } from '../tenants/tenants.module';

/**
 * Чат у control plane: дефолтний канал народжується РАЗОМ із тенантом (design.md D3) —
 * інакше тенант, створений оператором, лишився б єдиним без нього, а tenant-api його не
 * полагодить: там канал уже вважається інваріантом. Логіка — спільний провізіонер
 * `libs/shared/src/chat/default-channel.ts`; тут лише реєстрація в хуку появи тенанта,
 * тож `tenants` чату не знає (docs/modules.md §7.3).
 */
@Injectable()
class DefaultChannelProvisioner implements OnModuleInit {
  constructor(private readonly tenantLifecycle: TenantLifecycleHooks) {}

  onModuleInit(): void {
    this.tenantLifecycle.onCreated('chat.default-channel', {
      onTenantCreated: async (tx, tenant) => {
        await ensureDefaultChannel(tx, tenant.id);
        await joinDefaultChannel(tx, tenant.id, tenant.admin);
      },
    });
  }
}

@Module({
  imports: [TenantsModule],
  providers: [DefaultChannelProvisioner],
})
export class ChatProvisioningModule {}
