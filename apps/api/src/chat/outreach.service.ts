import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { StartConversation } from '@saas-skeleton/contracts';
import { ChannelContactService, normalizeE164, phoneDigits } from '@saas-skeleton/shared';

/**
 * Агент починає розмову з номера (CHAT-3a, chat/outreach): без вхідного повідомлення розмови не існує, а
 * писати комусь першим треба вміти (шаблон поза вікном). Контакт, адреса, автопривʼязка до клієнта і
 * «одна відкрита розмова на контакт» — спільний код з ingest (`ChannelContactService`). Повідомлення й
 * системні записи не створюються: нічого ще не сталося.
 */
@Injectable()
export class OutreachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TenantTransactions,
    private readonly contacts: ChannelContactService,
  ) {}

  /** Повертає id розмови (відкритої існуючої чи нової порожньої) */
  async start(dto: StartConversation): Promise<{ conversationId: string }> {
    if (normalizeE164(dto.phone) === null) {
      throw new BadRequestException({
        message: 'The phone number is not valid',
        fieldErrors: [
          { field: 'phone', message: 'The phone number is not valid', code: 'invalid_phone' },
        ],
      });
    }
    // Адреса провайдера — цифри з кодом країни, без плюса (так само, як приходить у вхідному)
    const digits = phoneDigits(dto.phone);

    // RLS показує лише канали цього тенанта: чужий id відповідає так само, як неіснуючий
    const channel = await this.prisma.channel.findUnique({
      where: { id: dto.channelId },
      select: { id: true, isEnabled: true, providerMissingAt: true },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    if (!channel.isEnabled || channel.providerMissingAt !== null) {
      throw new ConflictException('The channel is disabled');
    }

    return this.transactions.withTenantTx(async (tx) => {
      const { contactId, created } = await this.contacts.resolveContact(
        tx,
        channel.id,
        { kind: 'phone', value: digits },
        // Згоди ще немає: її дає звернення клієнта, а не агент
        { displayName: dto.name ?? null, at: new Date(), optInSource: 'agent_outreach' },
      );
      if (created) {
        await this.contacts.autoLinkCustomer(tx, contactId, digits);
      } else if (dto.name) {
        // Відоме ім'я не затираємо; порожнє — заповнюємо
        await tx.channelContact.updateMany({
          where: { id: contactId, displayName: null },
          data: { displayName: dto.name },
        });
      }
      const conversation = await this.contacts.openConversation(tx, channel.id, contactId);
      return { conversationId: conversation.id };
    });
  }
}
