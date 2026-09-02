import type {
  CustomerContactResponse,
  CustomerDetailResponse,
  CustomerResponse,
} from '@saas-skeleton/contracts';
import type { CustomerContact } from '@saas-skeleton/database';
import type { NumberingService, ResolvedNumberSeries } from '@saas-skeleton/shared';
import type { CustomerWithContacts, CustomerWithRelations } from './customers.service';

/**
 * Явний мапінг Prisma → response. tenantId і createdById назовні НЕ віддаються:
 * перший — інфраструктура (MT невидима і в контракті теж), другий у V1 ніде не
 * показується, а зайве поле у відповіді потім не прибрати без ламання клієнтів.
 */
export function toCustomerResponse(
  customer: CustomerWithRelations,
  numbering: NumberingService,
  series: ResolvedNumberSeries,
): CustomerResponse {
  return {
    id: customer.id,
    number: customer.number,
    // Лейбл рахується НА ЛЬОТУ з конфігу тенанта, а не зберігається: для
    // майстер-даних зміна формату мусить перемалювати всі записи. Для документів
    // буде навпаки — заморожена колонка (виданий рахунок не міняється заднім числом)
    numberLabel: numbering.format(series, customer.number),
    kind: customer.kind,
    status: customer.status,
    name: customer.name,
    legalName: customer.legalName,
    email: customer.email,
    phone: customer.phone,
    phoneCountry: customer.phoneCountry,
    website: customer.website,
    taxId: customer.taxId,
    currency: customer.currency,
    locale: customer.locale,
    ownerId: customer.ownerId,
    // Снапшот відповідального в самій відповіді: грід малює ім'я без другого запиту
    owner: customer.owner
      ? { id: customer.owner.id, email: customer.owner.email, name: customer.owner.name }
      : null,
    externalId: customer.externalId,
    tags: customer.tags,
    notes: customer.notes,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    city: customer.city,
    region: customer.region,
    postalCode: customer.postalCode,
    country: customer.country,
    contactsCount: customer._count.contacts,
    // Wire-формат API: дати передаються як ISO-рядки
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

export function toCustomerContactResponse(contact: CustomerContact): CustomerContactResponse {
  return {
    id: contact.id,
    customerId: contact.customerId,
    name: contact.name,
    position: contact.position,
    email: contact.email,
    phone: contact.phone,
    phoneCountry: contact.phoneCountry,
    isPrimary: contact.isPrimary,
    notes: contact.notes,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

export function toCustomerDetailResponse(
  customer: CustomerWithContacts,
  numbering: NumberingService,
  series: ResolvedNumberSeries,
): CustomerDetailResponse {
  return {
    ...toCustomerResponse(customer, numbering, series),
    contacts: customer.contacts.map(toCustomerContactResponse),
  };
}
