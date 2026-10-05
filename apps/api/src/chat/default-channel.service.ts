import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';
import { UserLifecycleHooks } from '../users/user-lifecycle.hooks';

/**
 * Дефолтний канал тенанта («General»): розмова, у якій перебувають усі його юзери.
 *
 * Чому `private` з повним списком учасників, а не `access = 'tenant'`
 * (design.md D3): «видно всім» вмикало б другу гілку резолвера доступу заради
 * одного рядка і лишало канал БЕЗ рядків учасників — тобто без непрочитаних і
 * без курсора прочитаного рівно там, де їх побачать найпершими.
 *
 * Канал народжується разом із тенантом (platform-api / сід), а не тут: цей
 * сервіс лише вводить у нього нового юзера — через хук появи юзера, який реєструє
 * сам (users чат не імпортує, docs/modules.md §4).
 */
@Injectable()
export class DefaultChannelService implements OnModuleInit {
  private readonly logger = new Logger(DefaultChannelService.name);

  constructor(private readonly userLifecycle: UserLifecycleHooks) {}

  onModuleInit(): void {
    this.userLifecycle.onCreated('chat.default-channel', {
      onUserCreated: (tx, user) => this.ensureMembership(tx, user),
    });
  }

  /**
   * Ввести юзера в дефолтний канал. Викликається З ТІЄЇ САМОЇ транзакції, що
   * створює юзера: членство — частина його появи, а не окремий крок, який
   * може не статися.
   *
   * Каналу немає — кидаємо. Це зламаний інваріант тенанта (його створюють
   * platform-api і сід, а наявним роздала міграція), і тихо пропустити його
   * означало б назавжди лишити людину поза каналом, не сказавши нікому.
   */
  async ensureMembership(
    tx: Prisma.TransactionClient,
    user: { id: string; name: string | null; email: string },
  ): Promise<void> {
    const channel = await tx.conversation.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (!channel) {
      throw new Error('Tenant has no default channel — cannot add the user to it');
    }

    const existing = await tx.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: channel.id, userId: user.id } },
      select: { leftAt: true },
    });
    if (existing?.leftAt === null) {
      return;
    }

    // Інкремент-і-повернення, як у звичайному надсиланні: двох юзерів можуть
    // заводити паралельно, і номер у стрічці має лишитись унікальним
    const { lastSeq } = await tx.conversation.update({
      where: { id: channel.id },
      // Прев'ю не чіпаємо: у системного запису тексту немає (design.md D5)
      data: { lastSeq: { increment: 1 }, lastMessageAt: new Date() },
      select: { lastSeq: true },
    });

    await tx.chatMessage.create({
      data: {
        conversationId: channel.id,
        seq: lastSeq,
        kind: 'SYSTEM',
        // Відправник — система: людину в дефолтний канал не додають, вона
        // потрапляє в нього за фактом існування
        senderType: 'system',
        payload: {
          type: 'member.added',
          member: { id: user.id, label: user.name ?? user.email },
        },
      },
    });

    await tx.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: channel.id, userId: user.id } },
      create: {
        conversationId: channel.id,
        userId: user.id,
        role: 'member',
        // Приєднання не створює непрочитаних, інакше людина отримала б бейдж
        // «847» з першої секунди і він одразу перестав би щось означати
        joinSeq: lastSeq,
        lastReadSeq: lastSeq,
      },
      update: { leftAt: null, joinSeq: lastSeq, lastReadSeq: lastSeq, unreadCount: 0 },
    });

    this.logger.debug(`User ${user.id} joined the default channel ${channel.id}`);
  }
}
