/**
 * Фейкові інвойси для стенду DataGrid (`/playground/components/data-grid`). Бекенду в
 * них немає: це дані, на яких видно, як грід поводиться з ~30 полями — панель
 * полів, набори, порядок, перетягування заголовків у широкій таблиці.
 *
 * Генератор детермінований (власний PRNG із фіксованим seed): після F5 ті самі
 * рядки на тих самих місцях — інакше перевірка «куди стала колонка» плуталась би
 * з тим, що змінились самі дані.
 */

export const INVOICE_STATUSES = ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface MockInvoice {
  id: string;
  number: string;
  customer: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  paidDate: string | null;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentTerms: string;
  paymentMethod: string | null;
  owner: string;
  billingEmail: string;
  billingCountry: string;
  billingCity: string;
  poNumber: string | null;
  project: string;
  department: string;
  lineItems: number;
  remindersSent: number;
  lastReminder: string | null;
  daysOverdue: number;
  notes: string;
  tags: string[];
  source: string;
  exported: boolean;
  createdAt: string;
  updatedAt: string;
}

const CUSTOMERS = [
  ['Northwind Traders', 'billing@northwind.example', 'United States', 'Seattle'],
  ['Globex Corporation', 'ap@globex.example', 'United States', 'Springfield'],
  ['Initech', 'finance@initech.example', 'United States', 'Austin'],
  ['Umbrella GmbH', 'rechnung@umbrella.example', 'Germany', 'Berlin'],
  ['Stark Industries', 'payables@stark.example', 'United States', 'New York'],
  ['Wayne Enterprises', 'ap@wayne.example', 'United States', 'Gotham'],
  ['Soylent Foods', 'invoices@soylent.example', 'Canada', 'Toronto'],
  ['Tyrell Systems', 'ap@tyrell.example', 'Japan', 'Tokyo'],
  ['Cyberdyne Labs', 'billing@cyberdyne.example', 'United Kingdom', 'London'],
  ['Hooli', 'accounts@hooli.example', 'United States', 'Palo Alto'],
  ['Pied Piper', 'money@piedpiper.example', 'United States', 'Palo Alto'],
  ['Vandelay Industries', 'ap@vandelay.example', 'United States', 'New York'],
  ['Kyiv Coffee Roasters', 'rahunky@kcr.example', 'Ukraine', 'Kyiv'],
  ['Lviv Print House', 'buh@lph.example', 'Ukraine', 'Lviv'],
] as const;

const OWNERS = ['Admin', 'Olena Kovalenko', 'Mark Reyes', 'Ines Duarte', 'Tomasz Nowak'];
const TERMS = ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Due on receipt'];
const TERM_DAYS: Record<string, number> = {
  'Net 15': 15,
  'Net 30': 30,
  'Net 45': 45,
  'Net 60': 60,
  'Due on receipt': 0,
};
const METHODS = ['Bank transfer', 'Card', 'SEPA', 'ACH', 'PayPal'];
const PROJECTS = ['Website redesign', 'Mobile app', 'Data migration', 'Support retainer', 'Audit'];
const DEPARTMENTS = ['Sales', 'Engineering', 'Marketing', 'Operations', 'Finance'];
const SOURCES = ['Manual', 'Subscription', 'API', 'Import'];
const TAGS = ['priority', 'retainer', 'q3', 'q4', 'partner', 'disputed', 'recurring'];
const NOTES = [
  'Thanks for your business!',
  'Please include the PO number with your payment.',
  'Partial payment agreed on the call.',
  'Late fee waived once.',
  '',
];
const CURRENCIES = ['USD', 'USD', 'USD', 'EUR', 'GBP', 'UAH'];

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

/** «Сьогодні» стенду зафіксоване — інакше `daysOverdue` і статуси пливли б із календарем */
const TODAY = Date.UTC(2026, 8, 26);
const DAY = 24 * 60 * 60 * 1000;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function generateMockInvoices(count = 50): MockInvoice[] {
  const random = createRandom(20260926);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

  return Array.from({ length: count }, (_, index) => {
    const [customer, billingEmail, billingCountry, billingCity] = pick(CUSTOMERS);
    const issueMs = TODAY - Math.floor(random() * 120) * DAY;
    const paymentTerms = pick(TERMS);
    const dueMs = issueMs + (TERM_DAYS[paymentTerms] ?? 30) * DAY;
    const subtotal = round2(200 + random() * 14800);
    const discount = random() < 0.3 ? round2(subtotal * pick([0.05, 0.1, 0.15])) : 0;
    const tax = round2((subtotal - discount) * pick([0, 0.07, 0.2]));
    const total = round2(subtotal - discount + tax);

    const roll = random();
    let status: InvoiceStatus;
    if (roll < 0.1) {
      status = 'DRAFT';
    } else if (roll < 0.15) {
      status = 'VOID';
    } else if (roll < 0.55) {
      status = 'PAID';
    } else {
      status = dueMs < TODAY ? 'OVERDUE' : 'SENT';
    }
    const isPaid = status === 'PAID';
    const partial = status === 'OVERDUE' && random() < 0.3 ? round2(total * 0.4) : 0;
    const amountPaid = isPaid ? total : partial;
    const paidMs = isPaid ? Math.min(TODAY, dueMs - Math.floor(random() * 10) * DAY) : null;
    const remindersSent = status === 'OVERDUE' ? 1 + Math.floor(random() * 4) : 0;
    const createdMs = issueMs - Math.floor(random() * 3) * DAY + Math.floor(random() * DAY);
    const tagCount = Math.floor(random() * 3);

    return {
      id: `inv-${String(index + 1)}`,
      number: `INV-2026-${String(1000 + count - index).padStart(4, '0')}`,
      customer,
      status,
      issueDate: isoDate(issueMs),
      dueDate: isoDate(dueMs),
      paidDate: paidMs === null ? null : isoDate(paidMs),
      currency: pick(CURRENCIES),
      subtotal,
      discount,
      tax,
      total,
      amountPaid,
      balanceDue: status === 'VOID' ? 0 : round2(total - amountPaid),
      paymentTerms,
      paymentMethod: isPaid || partial > 0 ? pick(METHODS) : null,
      owner: pick(OWNERS),
      billingEmail,
      billingCountry,
      billingCity,
      poNumber: random() < 0.6 ? `PO-${String(40000 + Math.floor(random() * 9999))}` : null,
      project: pick(PROJECTS),
      department: pick(DEPARTMENTS),
      lineItems: 1 + Math.floor(random() * 12),
      remindersSent,
      lastReminder: remindersSent > 0 ? isoDate(TODAY - Math.floor(random() * 14) * DAY) : null,
      daysOverdue: status === 'OVERDUE' ? Math.round((TODAY - dueMs) / DAY) : 0,
      notes: pick(NOTES),
      tags: Array.from(new Set(Array.from({ length: tagCount }, () => pick(TAGS)))),
      source: pick(SOURCES),
      exported: isPaid && random() < 0.7,
      createdAt: new Date(createdMs).toISOString(),
      updatedAt: new Date(createdMs + Math.floor(random() * 20) * DAY).toISOString(),
    };
  });
}
