/**
 * Форма демо-датасету тенанта (`datasets/*.ts`). Дані — чисті об'єкти без Prisma: їх пише
 * `seed-tenant.ts`, який і знає, як це лягає в таблиці та інваріанти модулів.
 * Посилання між сутностями — за індексом у масиві (`owner: 0` = перший юзер ростеру),
 * щоб датасет читався як сценарій, а не як набір uuid.
 */

export interface DemoUserSpec {
  name: string;
  email: string;
  role: 'ADMIN' | 'USER';
  title: string;
  /** E.164 */
  phone: string;
  phoneCountry: string;
  /** Неактивний — «колишній співробітник»: показує фільтр і стан у гріді юзерів */
  inactive?: boolean;
  /** Хвилин тому, коли юзера востаннє бачили онлайн; не задано — ніколи не заходив */
  lastSeenMinutesAgo?: number;
  /** Скільки днів тому юзера створено (історія команди) */
  createdDaysAgo: number;
}

export interface DemoOrgSpec {
  name: string;
  legalSuffix: string;
  city: string;
  country: string;
  /** Для адреси; не обовʼязково */
  region?: string;
  tags?: string[];
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  notes?: string;
  /** Валюта розрахунків, якщо відрізняється від валюти тенанта */
  currency?: string;
}

export interface DemoPersonSpec {
  name: string;
  city: string;
  country: string;
  tags?: string[];
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  notes?: string;
  currency?: string;
}

export interface DemoEventSpec {
  key: string;
  title: string;
  kind: 'MEETING' | 'CALL' | 'DEADLINE' | 'OUT_OF_OFFICE' | 'OTHER';
  /** Робочий день відносно сьогодні (−5 = той самий день тижня минулого тижня) */
  day: number;
  /** HH:mm за часом зони тенанта; для `allDay` ігнорується */
  start: string;
  minutes: number;
  /** Індекс у ростері юзерів — організатор */
  owner: number;
  /** Решта учасників: індекс юзера і його відповідь */
  attendees: { user: number; response: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'NEEDS_ACTION'; optional?: boolean }[];
  /** Індекс у ПОВНОМУ списку кастомерів (спершу організації, потім особи) */
  customer?: number;
  location?: string;
  description?: string;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  visibility?: 'DEFAULT' | 'PRIVATE';
  allDay?: boolean;
  /** Подія була перенесена: на скільки робочих днів раніше вона стояла (для запису в журналі) */
  rescheduledFromDays?: number;
}

export interface DemoChatMessageSpec {
  /** Індекс юзера ростеру */
  by: number;
  text: string;
  /** Скільки хвилин тому написано; повідомлення йдуть у хронологічному порядку (спадаюче значення) */
  minutesAgo: number;
}

export interface DemoChannelSpec {
  key: string;
  /** Для дефолтного каналу не задається: він уже існує (провізіонер) */
  title?: string;
  default?: boolean;
  /** Індекси юзерів ростеру; для дефолтного каналу ігнорується — туди входять усі активні */
  members?: number[];
  messages: DemoChatMessageSpec[];
  /** Скільки непрочитаних лишити юзеру (за індексом) після всіх повідомлень */
  unread?: Record<number, number>;
}

export interface DemoTenantDataset {
  slug: string;
  name: string;
  currency: string;
  timeZone: string;
  /** Робочий день воркспейсу — іде в `settings.calendar` тенанта */
  workDay: { start: string; end: string };
  users: DemoUserSpec[];
  orgs: DemoOrgSpec[];
  persons: DemoPersonSpec[];
  /** Пул посад контактних осіб — для організацій цієї галузі */
  contactTitles: string[];
  /** Пул нотаток, які розкладаються по частині кастомерів */
  notes: string[];
  events: DemoEventSpec[];
  channels: DemoChannelSpec[];
}
