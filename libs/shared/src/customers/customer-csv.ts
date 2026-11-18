/**
 * CSV експорту клієнтів (openspec: customers/export). Чисті функції без БД: їх перевіряє юніт-тест,
 * а воркер лише подає рядки.
 */

/** UTF-8 BOM: без нього Excel читає файл у системній кодуванні й ламає кирилицю */
export const CSV_BOM = '﻿';

/**
 * Захист від CSV/formula injection (OWASP): клітинку, що починається з `= + - @`, табуляції чи
 * CR, таблиця сприйняла б як формулу. Апостроф попереду робить її текстом і в Excel, і в
 * LibreOffice, і в Google Sheets.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  // RFC 4180: лапки, коми й переноси — у подвійних лапках, лапки всередині подвоюються
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: readonly (string | number | null | undefined)[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

export interface CustomerCsvRow {
  numberLabel: string;
  name: string;
  kind: string;
  status: string;
  email: string | null;
  phone: string | null;
  ownerEmail: string | null;
  tags: readonly string[];
  createdAt: Date;
}

/** Заголовки англійською — як у специфікації; порядок колонок = порядок у `customerCsvLine` */
export const CUSTOMER_CSV_HEADER = [
  'Number',
  'Name',
  'Kind',
  'Status',
  'Email',
  'Phone',
  'Owner email',
  'Tags',
  'Created at (UTC)',
] as const;

export function customerCsvLine(row: CustomerCsvRow): string {
  return csvLine([
    row.numberLabel,
    row.name,
    row.kind,
    row.status,
    row.email,
    row.phone,
    row.ownerEmail,
    row.tags.join('; '),
    row.createdAt.toISOString(),
  ]);
}
