import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';
import { CustomerStatus } from '@saas-skeleton/database';
import type { CustomerContact } from '@saas-skeleton/database';
import type {
  CreateCustomer,
  CreateCustomerContact,
  CustomerQuery,
  UpdateCustomer,
  UpdateCustomerContact,
} from '@saas-skeleton/contracts';
import { ActivityRecorder, NotificationRecorder, NumberingService } from '@saas-skeleton/shared';
import type { ActivityActor } from '@saas-skeleton/shared';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { normalizePhonePair } from '../common/phone';
import { SettingsService } from '../settings/settings.service';

/** Простір нумерації в спільному двигуні (libs/shared NumberingService) */
const CUSTOMER_SERIES = 'customer';

/** owner потрібен маперу для снапшота в гріді, _count — для contactsCount без join-у на список */
const CUSTOMER_INCLUDE = {
  owner: { select: { id: true, email: true, name: true } },
  _count: { select: { contacts: true } },
} as const;

const CUSTOMER_DETAIL_INCLUDE = {
  ...CUSTOMER_INCLUDE,
  // Основний контакт першим, далі за іменем: порядок у картці не має «стрибати»
  contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
} as const satisfies Prisma.CustomerInclude;

export type CustomerWithRelations = Prisma.CustomerGetPayload<{ include: typeof CUSTOMER_INCLUDE }>;
export type CustomerWithContacts = Prisma.CustomerGetPayload<{
  include: typeof CUSTOMER_DETAIL_INCLUDE;
}>;

/**
 * «C-000123», «000123» і «123» — той самий номер: із запиту лишаються самі цифри.
 * null — у пошуку цифр немає взагалі, отже номер шукати нічого.
 */
function parseNumberSearch(search: string): number | null {
  const digits = search.replace(/\D/g, '');
  if (digits === '') return null;
  const value = Number.parseInt(digits, 10);
  return Number.isSafeInteger(value) ? value : null;
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantTx: TenantTransactions,
    private readonly activities: ActivityRecorder,
    private readonly notifications: NotificationRecorder,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
  ) {}

  async findAll(query: CustomerQuery): Promise<{
    items: CustomerWithRelations[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, status, kind, ownerId, tag, search, includeArchived, sortBy, sortOrder } =
      query;
    const searchedNumber = search ? parseNumberSearch(search) : null;

    const where: Prisma.CustomerWhereInput = {
      ...(kind && { kind }),
      ...(ownerId && { ownerId }),
      ...(tag && { tags: { has: tag } }),
      // Явний статус має пріоритет: ?status=ARCHIVED показує саме архівних без
      // додаткових прапорців. Без нього архівні приховані — у цьому й сенс архіву
      ...(status
        ? { status }
        : includeArchived
          ? {}
          : { status: { not: CustomerStatus.ARCHIVED } }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { legalName: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
          { taxId: { contains: search, mode: 'insensitive' as const } },
          // Номер тепер число, тому не `contains`, а ТОЧНИЙ збіг по цифрах із
          // запиту: людина, яка вводить «C-000123» або «123», хоче саме цей
          // запис, а не всі, де така послідовність десь трапилась
          ...(searchedNumber !== null ? [{ number: searchedNumber }] : []),
        ],
      }),
    };

    // tie-breaker по id обов'язковий — інакше пагінація "пливе" при рівних значеннях sortBy
    const orderBy = sortBy
      ? [{ [sortBy]: sortOrder ?? 'asc' }, { id: 'desc' as const }]
      : [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: CUSTOMER_INCLUDE,
      }),
      this.prisma.customer.count({ where }),
    ]);

    this.logger.log(`Fetched ${String(items.length)} customers (total: ${String(total)})`);
    return { items, total, page, limit };
  }

  /** Картка віддає контакти разом із кастомером — окремого GET на контакти немає */
  async findOne(id: string): Promise<CustomerWithContacts> {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: CUSTOMER_DETAIL_INCLUDE,
    });
    if (!customer) {
      throw new NotFoundException(`Customer with id "${id}" not found`);
    }
    return customer;
  }

  async create(data: CreateCustomer, actor: JwtPayload): Promise<CustomerWithContacts> {
    // Відповідальний за замовчуванням — автор дії: найчастіший випадок «завів і веду».
    // Явний null у запиті лишає кастомера «нічиїм», і це легальний стан
    const ownerId = data.ownerId === undefined ? actor.sub : data.ownerId;
    if (ownerId) {
      await this.assertOwnerExists(ownerId);
    }
    await this.assertExternalIdFree(data.externalId ?? null, null);

    const { ownerId: _ignored, ...rest } = data;
    const phonePatch = normalizePhonePair(rest);
    // Валюту не передали → беремо дефолт КОМПАНІЇ, а не константу контракту:
    // саме для цього вона живе в налаштуваннях організації
    const currency = rest.currency ?? (await this.settings.current()).currency;

    // Атомарно: номер + рядок + активність + сповіщення. Номер видається
    // безпосередньо перед INSERT-ом, якому він потрібен: блокування рядка
    // лічильника тримається до КОМІТУ, тож усе, що можна зробити раніше
    // (перевірки власника й externalId вище), зроблено поза ним. Зовнішнього
    // I/O у цій транзакції бути не може — воно тримало б чергу на створення
    const customer = await this.tenantTx.withTenantTx(async (tx) => {
      const number = await this.numbering.allocate(tx, CUSTOMER_SERIES);

      const created = await tx.customer.create({
        data: {
          ...rest,
          ...phonePatch,
          currency,
          number,
          ownerId,
          createdById: actor.sub,
        },
        include: CUSTOMER_DETAIL_INCLUDE,
      });

      await this.activities.record(tx, {
        type: 'customer.created',
        actor: this.actorOf(actor),
        payload: { customer: this.refOf(created) },
        links: [{ entityType: 'customer', entityId: created.id, role: 'subject' }],
      });

      // Кого це стосується, вирішує домен: поява кастомера цікава рівно одній людині —
      // відповідальному. Розсилка всім адмінам (як на user.created) тут була б шумом:
      // юзерів заводять десятками на рік, кастомерів — десятками на день.
      // «Не собі» відсіє сам recorder
      await this.notifyOwner(tx, created, actor);

      return created;
    });

    this.logger.log(`Customer created: #${String(customer.number)} (${customer.name})`);
    return customer;
  }

  async update(id: string, data: UpdateCustomer, actor: JwtPayload): Promise<CustomerWithContacts> {
    const current = await this.findOne(id);
    if (data.ownerId) {
      await this.assertOwnerExists(data.ownerId);
    }
    if (data.externalId !== undefined) {
      await this.assertExternalIdFree(data.externalId, id);
    }

    const isOwnerChanged = data.ownerId !== undefined && data.ownerId !== current.ownerId;

    return this.tenantTx.withTenantTx(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: { ...data, ...normalizePhonePair(data) },
        include: CUSTOMER_DETAIL_INCLUDE,
      });

      // Редагування атрибутів у журнал НЕ пишеться: журнал читають люди, і фід із
      // «змінив поле notes» перестає бути читабельним. Зміна відповідального —
      // виняток: це рішення, а не правка тексту
      if (isOwnerChanged) {
        await this.activities.record(tx, {
          type: 'customer.owner_changed',
          actor: this.actorOf(actor),
          payload: {
            customer: this.refOf(updated),
            previousOwner: current.owner
              ? {
                  kind: 'user',
                  id: current.owner.id,
                  label: current.owner.name ?? current.owner.email,
                }
              : null,
            owner: updated.owner
              ? {
                  kind: 'user',
                  id: updated.owner.id,
                  label: updated.owner.name ?? updated.owner.email,
                }
              : null,
          },
          links: [{ entityType: 'customer', entityId: updated.id, role: 'subject' }],
        });

        await this.notifyOwner(tx, updated, actor);
      }

      this.logger.log(`Customer updated: #${String(updated.number)}`);
      return updated;
    });
  }

  /**
   * Зміна статусу — окремий флоу, а не поле в PATCH: це подія, яку читають у журналі.
   * Повторний виклик із тим самим значенням — no-op БЕЗ запису (активність — факт
   * зміни, а не факт натискання кнопки).
   */
  async setStatus(
    id: string,
    status: CustomerStatus,
    actor: JwtPayload,
  ): Promise<CustomerWithContacts> {
    const current = await this.findOne(id);
    if (current.status === status) {
      return current;
    }

    const wasArchived = current.status === CustomerStatus.ARCHIVED;

    return this.tenantTx.withTenantTx(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: { status },
        include: CUSTOMER_DETAIL_INCLUDE,
      });

      // У журнал іде тільки перетин межі архіву: ACTIVE ↔ INACTIVE — робочий
      // перемикач, а архівація — рішення, за яким приходять питати «хто і коли»
      if (status === CustomerStatus.ARCHIVED) {
        await this.activities.record(tx, {
          type: 'customer.archived',
          actor: this.actorOf(actor),
          payload: { customer: this.refOf(updated) },
          links: [{ entityType: 'customer', entityId: updated.id, role: 'subject' }],
        });
      } else if (wasArchived) {
        await this.activities.record(tx, {
          type: 'customer.restored',
          actor: this.actorOf(actor),
          payload: { customer: this.refOf(updated), status },
          links: [{ entityType: 'customer', entityId: updated.id, role: 'subject' }],
        });
      }

      this.logger.log(`Customer #${String(updated.number)} status → ${status}`);
      return updated;
    });
  }

  /**
   * Справжнє видалення, а не soft delete: «прибрати з очей» уже покриває ARCHIVED,
   * а від помилкового видалення захистить цілісність — FK доменних документів на
   * кастомера ставиться Restrict, і БД сама не дасть стерти того, на кого посилаються.
   */
  async remove(id: string, actor: JwtPayload): Promise<void> {
    const customer = await this.findOne(id);

    await this.tenantTx.withTenantTx(async (tx) => {
      await tx.customer.delete({ where: { id } });
      // Журнал переживає сутність: лінк лишається на неіснуючий id, а назву
      // читач бачить зі снапшота в payload
      await this.activities.record(tx, {
        type: 'customer.deleted',
        actor: this.actorOf(actor),
        payload: { customer: this.refOf(customer) },
        links: [{ entityType: 'customer', entityId: customer.id, role: 'subject' }],
      });
    });

    this.logger.log(`Customer deleted: #${String(customer.number)} (${customer.name})`);
  }

  // ------------------------------------------------------------- контакти

  async addContact(customerId: string, data: CreateCustomerContact): Promise<CustomerContact> {
    await this.findOne(customerId);

    return this.tenantTx.withTenantTx(async (tx) => {
      // Новий основний знімає прапорець зі старого: інакше частковий унікальний
      // індекс відхилив би вставку, і користувач отримав би 409 замість очікуваної дії
      if (data.isPrimary) {
        await this.clearPrimary(tx, customerId, null);
      }
      return tx.customerContact.create({
        data: { ...data, ...normalizePhonePair(data), customerId },
      });
    });
  }

  async updateContact(
    customerId: string,
    contactId: string,
    data: UpdateCustomerContact,
  ): Promise<CustomerContact> {
    await this.findContact(customerId, contactId);

    return this.tenantTx.withTenantTx(async (tx) => {
      if (data.isPrimary) {
        await this.clearPrimary(tx, customerId, contactId);
      }
      return tx.customerContact.update({
        where: { id: contactId },
        data: { ...data, ...normalizePhonePair(data) },
      });
    });
  }

  async removeContact(customerId: string, contactId: string): Promise<void> {
    await this.findContact(customerId, contactId);
    await this.prisma.customerContact.delete({ where: { id: contactId } });
  }

  // ------------------------------------------------------------- внутрішнє

  /** Актор у журналі й сповіщеннях — завжди реальна людина з токена */
  private actorOf(actor: JwtPayload): ActivityActor {
    return { type: 'user', id: actor.sub, label: actor.email };
  }

  /** Снапшот назви на момент події: фід рендериться без join-ів на живі таблиці */
  private refOf(customer: { id: string; name: string }): {
    kind: string;
    id: string;
    label: string;
  } {
    return { kind: 'customer', id: customer.id, label: customer.name };
  }

  private async notifyOwner(
    tx: Prisma.TransactionClient,
    customer: CustomerWithContacts,
    actor: JwtPayload,
  ): Promise<void> {
    if (!customer.ownerId) {
      return;
    }
    await this.notifications.notify(tx, {
      type: 'customer.assigned',
      recipientIds: [customer.ownerId],
      actor: this.actorOf(actor),
      payload: { customer: this.refOf(customer) },
      target: { kind: 'customer', id: customer.id },
    });
  }

  /**
   * Відповідальним може бути тільки живий юзер цього тенанта. Чужий id відсіє RLS
   * (findUnique нічого не знайде), тому окремої перевірки на tenant тут не треба —
   * і саме тому вона тут виглядає як звичайна перевірка існування.
   */
  private async assertOwnerExists(ownerId: string): Promise<void> {
    const owner = await this.prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner?.isActive) {
      throw new BadRequestException({
        message: 'ownerId must reference an active user of this workspace',
        fieldErrors: [{ field: 'ownerId', message: 'Unknown user', code: 'invalid_owner' }],
      });
    }
  }

  /**
   * Явна перевірка → 409 з полем; гонку добиває unique-констрейнт
   * (P2002 → той самий CONFLICT в AllExceptionsFilter). Це ЄДИНА жорстка
   * унікальність домену крім номера: name/email/taxId свідомо не унікальні
   * (жорсткий констрейнт дає «ТОВ Ромашка 2» замість правильного запису).
   */
  private async assertExternalIdFree(
    externalId: string | null,
    selfId: string | null,
  ): Promise<void> {
    if (!externalId) {
      return;
    }
    const existing = await this.prisma.customer.findFirst({ where: { externalId } });
    if (existing && existing.id !== selfId) {
      throw new BadRequestException({
        message: 'externalId already used by another customer',
        fieldErrors: [{ field: 'externalId', message: 'Already used', code: 'already_exists' }],
      });
    }
  }

  /** Контакт адресується тільки в межах свого кастомера — чужа пара дає 404 */
  private async findContact(customerId: string, contactId: string): Promise<CustomerContact> {
    const contact = await this.prisma.customerContact.findFirst({
      where: { id: contactId, customerId },
    });
    if (!contact) {
      throw new NotFoundException(`Contact with id "${contactId}" not found`);
    }
    return contact;
  }

  private async clearPrimary(
    tx: Prisma.TransactionClient,
    customerId: string,
    exceptId: string | null,
  ): Promise<void> {
    await tx.customerContact.updateMany({
      where: {
        customerId,
        isPrimary: true,
        ...(exceptId && { id: { not: exceptId } }),
      },
      data: { isPrimary: false },
    });
  }
}
