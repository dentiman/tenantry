/**
 * Фейкові інвойси демо-сторінки `/workspace/invoices`. Бекенду немає: це вітрина того, як
 * виглядав би біллінг у нашому шелі. Структура — інвойс реальної білінгової системи
 * (інвойс + позиції) у конвенціях цього репозиторію: клієнт — вкладений `{ id, name, … }`,
 * дати — ISO-рядки, статуси — UPPER_SNAKE. Ізраїльська специфіка (шекелі, ПДВ 17%,
 * підтвердження податкової, SAP) свідомо лишилась — сторінку показують саме під неї.
 *
 * Генератор детермінований (власний PRNG із фіксованим seed): після F5 ті самі рядки.
 */

export const INVOICE_STATUSES = ['NEW', 'IN_COLLECTION', 'PAID', 'CANCELED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['DIRECT_DEBIT', 'CREDIT_CARD', 'WALLET'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CURRENCY = 'ILS';
export const TAX_PERCENT = 17;

export interface MockInvoiceItem {
  id: string;
  description: string;
  service: string;
  /** Підписка, з якої нараховано рядок; разові послуги (монтаж) — без неї */
  subscription: string | null;
  amount: number;
}

export interface MockInvoice {
  id: string;
  number: string;
  /** Форма `CustomerIdentity` списку клієнтів: тип, людський номер і контакти */
  customer: {
    id: string;
    kind: 'ORGANIZATION' | 'PERSON';
    numberLabel: string;
    name: string;
    email: string;
    phone: string;
    nationalId: string;
  };
  status: InvoiceStatus;
  /** Місяць нарахування, `YYYY-MM` */
  billedMonth: string;
  createdAt: string;
  dueDate: string;
  paidAt: string | null;
  subtotal: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
  /** Метод оплати, налаштований у клієнта; null — не налаштовано */
  paymentMethod: PaymentMethod | null;
  /** Чим інвойс фактично оплачено */
  paidMethod: PaymentMethod | null;
  paymentAttempts: number;
  emailedAt: string | null;
  docNumber: number;
  taxDocNumber: number | null;
  taxDate: string | null;
  taxConfirmationNumber: string | null;
  taxConfirmedAt: string | null;
  sapDocEntry: number | null;
  sapDocNum: number | null;
  sapOrderDocEntry: number | null;
  sapOrderDocNum: number | null;
  sapIncomingPaymentDocEntry: number | null;
  sapIncomingPaymentNumber: number | null;
  items: MockInvoiceItem[];
}

const CUSTOMERS = [
  ['PERSON', 'Noa Levi', 'noa.levi@mail.example'],
  ['PERSON', 'Avi Cohen', 'avi.cohen@mail.example'],
  ['PERSON', 'Yael Mizrahi', 'yael.m@mail.example'],
  ['PERSON', 'Daniel Peretz', 'd.peretz@mail.example'],
  ['PERSON', 'Tamar Friedman', 'tamar.f@mail.example'],
  ['PERSON', 'Omer Katz', 'omer.katz@mail.example'],
  ['PERSON', 'Shira Biton', 'shira.biton@mail.example'],
  ['PERSON', 'Itai Azoulay', 'itai.a@mail.example'],
  ['ORGANIZATION', 'Mizrahi Bakery Ltd', 'office@mizrahi-bakery.example'],
  ['ORGANIZATION', 'Galil Dental Clinic', 'billing@galil-dental.example'],
  ['ORGANIZATION', 'Negev Logistics', 'ap@negev-logistics.example'],
  ['ORGANIZATION', 'Carmel Hostel', 'front@carmel-hostel.example'],
] as const;

/** Абонентські послуги (з підпискою) і разові — як позиції інвойсу провайдера */
const RECURRING = [
  ['Fiber 1 Gbps', 'Internet', 149],
  ['Fiber 500 Mbps', 'Internet', 119],
  ['Fiber 300 Mbps', 'Internet', 99],
  ['Router rental', 'Equipment', 19],
  ['Mesh extender rental', 'Equipment', 15],
  ['Static IP', 'Add-on', 25],
  ['TV basic package', 'TV', 59],
  ['Cloud backup 1 TB', 'Add-on', 29],
] as const;

const ONE_TIME = [
  ['Installation fee', 'Installation', 250],
  ['Technician visit', 'Service', 180],
  ['Late payment fee', 'Fee', 35],
] as const;

/** mulberry32 — маленький детермінований PRNG, достатній для фейкових даних */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** «Сьогодні» демо зафіксоване — інакше статуси й прострочення пливли б із календарем */
export const DEMO_TODAY = '2026-10-19';
const DAY = 24 * 60 * 60 * 1000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

export function generateMockInvoices(count = 50): MockInvoice[] {
  const random = createRandom(20261019);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const int = (from: number, to: number): number => from + Math.floor(random() * (to - from + 1));
  const today = Date.parse(`${DEMO_TODAY}T00:00:00Z`);

  const customers = CUSTOMERS.map(([kind, name, email], index) => ({
    id: `cus-${String(index + 1).padStart(3, '0')}`,
    kind,
    numberLabel: `C-${String(index + 101).padStart(6, '0')}`,
    name,
    email,
    // E.164, як віддає API: `CustomerIdentity` сам доводить до людського вигляду
    phone: `+9725${String(int(10_000_000, 89_999_999))}`,
    nationalId: String(int(100_000_000, 399_999_999)),
    paymentMethod: index % 6 === 5 ? null : pick(PAYMENT_METHODS),
  }));

  const invoices = Array.from({ length: count }, (_, index): MockInvoice => {
    const customer = pick(customers);
    // Шість місяців нарахувань: травень…жовтень 2026, свіжіші частіше
    const monthOffset = Math.min(5, Math.floor(random() * random() * 7));
    const month = 9 - monthOffset; // 0-based: 9 = жовтень
    const billedMonth = `2026-${String(month + 1).padStart(2, '0')}`;
    const createdMs = Date.UTC(2026, month, int(1, 3), int(6, 9), int(0, 59));
    const dueMs = createdMs + 21 * DAY;

    const items: MockInvoiceItem[] = [];
    const lines = int(1, 4);
    for (let line = 0; line < lines; line++) {
      const [service, kind, price] = pick(RECURRING);
      if (items.some((item) => item.description === service)) continue;
      items.push({
        id: `${String(index + 1)}-${String(line + 1)}`,
        description: service,
        service: kind,
        subscription: `SUB-${customer.id.slice(4)}-${String(line + 1)}`,
        amount: price,
      });
    }
    if (random() < 0.15) {
      const [service, kind, price] = pick(ONE_TIME);
      items.push({
        id: `${String(index + 1)}-x`,
        description: service,
        service: kind,
        subscription: null,
        amount: price,
      });
    }

    const subtotal = round2(items.reduce((sum, item) => sum + item.amount, 0));
    const taxAmount = round2((subtotal * TAX_PERCENT) / 100);

    // Чим старший місяць, тим імовірніше оплачено; поточний — здебільшого ще в роботі
    const roll = random();
    let status: InvoiceStatus;
    if (roll < 0.06) status = 'CANCELED';
    else if (monthOffset === 0)
      status = roll < 0.35 ? 'PAID' : roll < 0.7 ? 'IN_COLLECTION' : 'NEW';
    else status = roll < 0.82 ? 'PAID' : roll < 0.9 ? 'IN_COLLECTION' : 'NEW';
    // Без методу оплати в прямий дебет не відправиш
    if (status === 'IN_COLLECTION' && customer.paymentMethod !== 'DIRECT_DEBIT') status = 'NEW';

    const paidMs =
      status === 'PAID'
        ? Math.min(today - DAY, createdMs + int(0, 20) * DAY + int(1, 8) * 3600_000)
        : null;
    const paidMethod = status === 'PAID' ? (customer.paymentMethod ?? 'CREDIT_CARD') : null;
    const emailedAt = random() < 0.8 ? isoAt(createdMs + int(1, 30) * 60_000) : null;
    const isPaid = paidMs !== null;
    // Підтвердження податкової — лише для оплачених і не для всіх (у FMS — від порогу суми)
    const confirmedMs = paidMs !== null && random() < 0.6 ? paidMs + int(1, 3) * DAY : null;
    const inSap = status !== 'NEW' && status !== 'CANCELED' ? random() < 0.85 : random() < 0.2;
    const docNumber = 40_000 + index * 7 + int(0, 6);

    return {
      id: `inv-${String(index + 1).padStart(3, '0')}`,
      number: `INV-2026-${String(1000 + index * 3 + int(0, 2)).padStart(5, '0')}`,
      customer: {
        id: customer.id,
        kind: customer.kind,
        numberLabel: customer.numberLabel,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        nationalId: customer.nationalId,
      },
      status,
      billedMonth,
      createdAt: isoAt(createdMs),
      dueDate: isoAt(dueMs).slice(0, 10),
      paidAt: paidMs === null ? null : isoAt(paidMs),
      subtotal,
      taxPercent: TAX_PERCENT,
      taxAmount,
      total: round2(subtotal + taxAmount),
      paymentMethod: customer.paymentMethod,
      paidMethod,
      paymentAttempts: isPaid ? int(1, 2) : status === 'CANCELED' ? 0 : int(0, 3),
      emailedAt,
      docNumber,
      taxDocNumber: isPaid ? 70_000 + index * 5 + int(0, 4) : null,
      taxDate: paidMs !== null ? isoAt(paidMs).slice(0, 10) : null,
      taxConfirmationNumber: confirmedMs !== null ? String(int(100_000_000, 999_999_999)) : null,
      taxConfirmedAt: confirmedMs === null ? null : isoAt(confirmedMs),
      sapDocEntry: inSap ? 180_000 + index * 11 : null,
      sapDocNum: inSap ? 26_000_000 + docNumber : null,
      sapOrderDocEntry: inSap ? 90_000 + index * 13 : null,
      sapOrderDocNum: inSap ? 16_000_000 + docNumber : null,
      sapIncomingPaymentDocEntry: inSap && isPaid ? 300_000 + index * 17 : null,
      sapIncomingPaymentNumber: inSap && isPaid ? 36_000_000 + docNumber : null,
      items,
    };
  });

  // Як у справжньому списку: найсвіжіші зверху
  return invoices.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Місяці, що реально трапляються в даних — для фільтра, від нового до старого */
export function billedMonthsOf(invoices: readonly MockInvoice[]): string[] {
  return [...new Set(invoices.map((invoice) => invoice.billedMonth))].sort().reverse();
}

/** Не оплачено й термін минув — у FMS окремого статусу немає, це похідна ознака */
export function isOverdue(invoice: MockInvoice): boolean {
  return (
    (invoice.status === 'NEW' || invoice.status === 'IN_COLLECTION') && invoice.dueDate < DEMO_TODAY
  );
}
