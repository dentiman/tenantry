import { z } from 'zod';
import { listQuerySchema, paginatedResponseSchema } from '../pagination/pagination.schema';
import { CurrencyCodeSchema } from '../money/money.schema';
import { CountryCodeSchema, PhoneNumberSchema } from '../phone/phone.schema';
import { UserLocaleSchema } from '../user/user.schema';

/**
 * Кастомер (контрагент) — базова доменна сутність скелетона (docs/customers.md).
 *
 * Одна сутність із дискримінатором `kind` замість пари Account+Contact (Salesforce)
 * і замість party-моделі (SAP BP / Odoo res.partner): party правильна для ERP із
 * кількома типами контрагентів, але без другого типу вона — рівень непрямості,
 * яким ніхто не користується. `kind` при цьому вводиться з першого дня: це єдине
 * поле, яке справді дорого додати потім (від нього залежать GDPR, форма UI і
 * обов'язковість реквізитів).
 */

/** ORGANIZATION — юрособа; PERSON — фізособа (B2C). Аналог is_company / isPerson / BP category */
export const CustomerKindSchema = z.enum(['ORGANIZATION', 'PERSON']);

/**
 * Операційний стан контрагента. Стадій продажу (LEAD/PROSPECT) тут НЕМАЄ свідомо:
 * воронка — це стан угоди, а не контрагента; змішавши їх, отримаємо запис, який
 * одночасно «лід» і має три оплачені рахунки.
 *
 * ARCHIVED замінює soft delete: у гріді за замовчуванням не видно, за прямим
 * посиланням доступний, у звітах присутній.
 */
export const CustomerStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);

/**
 * Порожній рядок із форми = «значення немає», а не «невалідне значення». Без цього
 * кожне необов'язкове поле картки вимагало б від фронта ручного '' → null.
 */
const emptyToNull = (value: string): string | null => (value === '' ? null : value);

function optionalText(max: number): z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodString, z.ZodTransform<string | null, string>>>> {
  return z.string().trim().max(max).transform(emptyToNull).nullable().optional();
}

const OptionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform(emptyToNull)
  .pipe(z.email().nullable())
  .nullable()
  .optional();

const OptionalUrlSchema = z
  .string()
  .trim()
  .transform(emptyToNull)
  .pipe(z.url().nullable())
  .nullable()
  .optional();

/**
 * Теги — навмисно вільний список рядків, а не довідник: галузі/сегменти/джерела в
 * кожного форка свої, і нав'язана класифікація гірша за її відсутність.
 */
const TagsSchema = z.array(z.string().trim().min(1).max(40)).max(20);

/**
 * Адреса V1 — колонки на самій сутності, не окрема таблиця (docs/customers.md §4.3):
 * 80% форків мають рівно одну адресу, а міграція «колонки → таблиця» одноразова
 * і тривіальна. Валідація м'яка: універсального формату індексу не існує, «region» —
 * це і штат, і область, і префектура.
 */
const AddressShape = {
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(120),
  region: optionalText(120),
  postalCode: optionalText(32),
  country: CountryCodeSchema.nullable().optional(),
};

export const CreateCustomerSchema = z.object({
  kind: CustomerKindSchema.default('ORGANIZATION').optional(),
  /** Єдине обов'язкове поле: форма на 15 полів = клієнт у блокноті, а не в системі */
  name: z.string().trim().min(1).max(200),
  /** Юридична назва / ПІБ для документів, коли відрізняється від робочої */
  legalName: optionalText(200),
  email: OptionalEmailSchema,
  // Телефон приходить в E.164; phoneCountry виводиться з номера, якщо не переданий
  // (та сама пара і та сама нормалізація, що в users)
  phone: PhoneNumberSchema.nullable().optional(),
  phoneCountry: CountryCodeSchema.nullable().optional(),
  website: OptionalUrlSchema,
  /** VAT / ЄДРПОУ / EIN — рядок як є. Валідувати per-country = відхиляти валідні номери */
  taxId: optionalText(64),
  // Дефолт бере воркспейс (GET /workspace/general), а не константа контракту:
  // не передали — сервіс підставить валюту компанії
  currency: CurrencyCodeSchema.optional(),
  /** Мова листів ДО КАСТОМЕРА (аналог SPRAS у KNA1), окрема від локалі співробітника */
  locale: UserLocaleSchema.default('en').optional(),
  /** Відповідальний менеджер; не передали — стане автор дії. null — свідомо «нічий» */
  ownerId: z.uuid().nullable().optional(),
  /** Id у системі-джерелі: ключ ідемпотентності імпорту і зчеплення з інтеграцією */
  externalId: optionalText(128),
  tags: TagsSchema.optional(),
  notes: optionalText(5000),
  ...AddressShape,
});

/**
 * `number` тут немає і не буде: номер видає сервер і не змінює (на нього
 * посилаються в листуванні й у документах). `status` — теж: це подія, у неї
 * окремий ендпоінт.
 */
export const UpdateCustomerSchema = CreateCustomerSchema.partial();

/** Зміна статусу — подія, яку читають у журналі, а не редагування атрибута */
export const SetCustomerStatusSchema = z.object({
  status: CustomerStatusSchema,
});

export const CustomerQuerySchema = listQuerySchema([
  'number',
  'name',
  'status',
  'createdAt',
  'updatedAt',
]).extend({
  status: CustomerStatusSchema.optional(),
  kind: CustomerKindSchema.optional(),
  ownerId: z.uuid().optional(),
  /** Один тег; множинний фільтр — коли з'явиться сценарій, а не наперед */
  tag: z.string().optional(),
  /** Пошук по name / legalName / number / email / taxId */
  search: z.string().optional(),
  /**
   * Архівні за замовчуванням приховані (у цьому й сенс архіву). Явний `status`
   * має пріоритет: `?status=ARCHIVED` показує саме їх без додаткових прапорців.
   * Wire-формат — рядок, як усі boolean-фільтри гріда.
   */
  includeArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// ---------------------------------------------------------------- контакти

/**
 * Контактна особа — ВКЛАДЕНИЙ ресурс: не існує без кастомера (на відміну від
 * самостійного Contact у Salesforce). Заодно знімає питання авторизації: доступ
 * до контакту = доступ до його кастомера.
 */
export const CreateCustomerContactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Посада: «CFO», «комірник» */
  position: optionalText(120),
  email: OptionalEmailSchema,
  phone: PhoneNumberSchema.nullable().optional(),
  phoneCountry: CountryCodeSchema.nullable().optional(),
  /** Основний — рівно один на кастомера; гарантує частковий унікальний індекс */
  isPrimary: z.boolean().optional(),
  notes: optionalText(2000),
});

export const UpdateCustomerContactSchema = CreateCustomerContactSchema.partial();

export const CustomerContactResponseSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  name: z.string(),
  position: z.string().nullable(),
  email: z.string().nullable(),
  // М'яко (просто рядок), як у UserResponse: суворий PhoneNumberSchema у відповіді
  // означав би, що оновлення метаданих libphonenumber валить ВІДДАЧУ даних
  phone: z.string().nullable(),
  phoneCountry: z.string().nullable(),
  isPrimary: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// ---------------------------------------------------------------- відповіді

/** Відповідальний у відповіді — снапшот для показу в гріді без другого запиту */
export const CustomerOwnerSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
});

export const CustomerResponseSchema = z.object({
  id: z.uuid(),
  /**
   * Людський ідентифікатор — ЦІЛЕ число, своє в кожного тенанта (docs/customers.md §5).
   * По ньому йдуть сортування, фільтри й точний пошук.
   */
  number: z.number().int(),
  /**
   * Те, що людина називає в розмові й пише в листі: `prefix + нулі + number` за
   * конфігом тенанта. Рахується НА ЛЬОТУ, а не зберігається: для майстер-даних
   * зміна формату мусить перемалювати всі записи. Для ДОКУМЕНТІВ (рахунок) буде
   * навпаки — заморожена колонка, бо виданий папір не має мінятися заднім числом.
   */
  numberLabel: z.string(),
  kind: CustomerKindSchema,
  status: CustomerStatusSchema,
  name: z.string(),
  legalName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  phoneCountry: z.string().nullable(),
  website: z.string().nullable(),
  taxId: z.string().nullable(),
  currency: z.string(),
  locale: z.string(),
  ownerId: z.uuid().nullable(),
  owner: CustomerOwnerSchema.nullable(),
  externalId: z.string().nullable(),
  tags: z.array(z.string()),
  notes: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
  contactsCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/**
 * Картка віддає контакти разом із кастомером: окремого GET на контакти немає —
 * інакше та сама інформація мала б два шляхи отримання і два стани кешу.
 * Ендпоінти контактів лишаються тільки на зміну.
 */
export const CustomerDetailResponseSchema = CustomerResponseSchema.extend({
  contacts: z.array(CustomerContactResponseSchema),
});

export const CustomerListResponseSchema = paginatedResponseSchema(CustomerResponseSchema);
