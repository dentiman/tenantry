import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { TenantContextService } from '@saas-skeleton/database';
import { joinDefaultChannel } from '@saas-skeleton/shared';
import { UserLifecycleHooks } from '../users/user-lifecycle.hooks';

/**
 * Новий юзер тенанта вступає в дефолтний канал («General») у ТІЙ САМІЙ транзакції, що його
 * створює: членство — частина появи людини, а не окремий крок, який може не статися
 * (docs/chat.md §7.4, design.md D3). Users чат не імпортує — модуль реєструє хук появи юзера
 * сам (docs/modules.md §4).
 *
 * Сама логіка каналу — спільний провізіонер `libs/shared/src/chat/default-channel.ts`: той
 * самий код створює канал разом із тенантом у control plane і в сіді (docs/module-registries.md
 * R6).
 */
@Injectable()
export class DefaultChannelService implements OnModuleInit {
  private readonly logger = new Logger(DefaultChannelService.name);

  constructor(
    private readonly userLifecycle: UserLifecycleHooks,
    private readonly tenantContext: TenantContextService,
  ) {}

  onModuleInit(): void {
    this.userLifecycle.onCreated('chat.default-channel', {
      onUserCreated: async (tx, user) => {
        await joinDefaultChannel(tx, this.tenantContext.requireTenantId(), user);
        this.logger.debug(`User ${user.id} joined the default channel`);
      },
    });
  }
}
