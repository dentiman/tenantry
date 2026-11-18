import { CustomerStatus, type Prisma } from '@saas-skeleton/database';
import type { ExportCustomers } from '@saas-skeleton/contracts';

/** Межа колонки `customers.number` (INT4): більше значення Postgres відкидає помилкою діапазону */
const MAX_CUSTOMER_NUMBER = 2_147_483_647;

/** Фільтри списку без пагінації — спільні для `GET /customers` і експорту */
export type CustomerListFilters = ExportCustomers;

/**
 * Цифри з пошукового рядка як номер: «C-000123» і «123» шукають саме запис №123. Число поза
 * INT4 — не номер (інакше Postgres упав би на діапазоні).
 */
export function parseNumberSearch(search: string): number | null {
  const digits = search.replace(/\D/g, '');
  if (digits === '') return null;
  const value = Number.parseInt(digits, 10);
  return Number.isSafeInteger(value) && value <= MAX_CUSTOMER_NUMBER ? value : null;
}

/**
 * Умова списку клієнтів. Одна на список і експорт (openspec: customers/export — «ті самі збіги,
 * що показує список»), тому живе тут, а не в сервісі api: воркер експорту будує той самий запит.
 */
export function customerListWhere(filters: CustomerListFilters): Prisma.CustomerWhereInput {
  const { status, kind, ownerId, tag, search, includeArchived } = filters;
  const searchedNumber = search ? parseNumberSearch(search) : null;
  return {
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
}

/** Порядок списку; tie-breaker по id обовʼязковий — інакше сторінки «пливуть» на рівних значеннях */
export function customerListOrderBy(
  filters: Pick<CustomerListFilters, 'sortBy' | 'sortOrder'>,
): Prisma.CustomerOrderByWithRelationInput[] {
  return filters.sortBy
    ? [{ [filters.sortBy]: filters.sortOrder ?? 'asc' }, { id: 'desc' }]
    : [{ createdAt: 'desc' }, { id: 'desc' }];
}
