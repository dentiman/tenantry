import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { TenantContextService } from '@saas-skeleton/database';
import { joinDefaultChannel } from '@saas-skeleton/shared';
import { UserLifecycleHooks } from '../users/user-lifecycle.hooks';
import { ChatRealtime } from './chat-realtime';

/**
 * Новий юзер тенанта вступає в дефолтний канал («General») у ТІЙ САМІЙ транзакції, що його
 * створює: членство — частина появи людини, а не окремий крок, який може не статися
 * (docs/chat.md §7.4, design.md D3). Users чат не імпортує — модуль реєструє хук появи юзера
 * сам (docs/modules.md §4).
 *
 * Сама логіка каналу — спільний провізіонер `libs/shared/src/chat/default-channel.ts`: той
 * самий код створює канал разом із тенантом у control plane і в сіді (docs/modules.md §7.3).
 */
@Injectable()
export class DefaultChannelService implements OnModuleInit {
  private readonly logger = new Logger(DefaultChannelService.name);

  constructor(
    private readonly userLifecycle: UserLifecycleHooks,
    private readonly tenantContext: TenantContextService,
    private readonly chatRealtime: ChatRealtime,
  ) {}

  onModuleInit(): void {
    this.userLifecycle.onCreated('chat.default-channel', {
      onUserCreated: async (tx, user) => {
        const joined = await joinDefaultChannel(tx, this.tenantContext.requireTenantId(), user);
        if (joined) {
          // Колеги по каналу бачать «X приєднався» і оновлюють склад учасників — по тій
          // самій транзакції, що створює юзера: відкотиться юзер — не злетить жодна подія
          await this.chatRealtime.messageCreated(tx, joined.message);
          await this.chatRealtime.conversationChanged(tx, joined.conversationId, 'membership');
        }
        this.logger.debug(`User ${user.id} joined the default channel`);
      },
    });
  }
}
