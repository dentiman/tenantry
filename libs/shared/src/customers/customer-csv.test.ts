import { describe, expect, it } from 'vitest';
import { CSV_BOM, CUSTOMER_CSV_HEADER, csvCell, csvLine, customerCsvLine } from './customer-csv';

describe('csvCell', () => {
  it('keeps plain values as they are', () => {
    expect(csvCell('Acme')).toBe('Acme');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
  });

  it('quotes commas, quotes and line breaks (RFC 4180)', () => {
    expect(csvCell('Acme, Inc')).toBe('"Acme, Inc"');
    expect(csvCell('The "Best"')).toBe('"The ""Best"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('turns anything a spreadsheet would evaluate into text', () => {
    expect(csvCell('=HYPERLINK("http://example.com")')).toBe('"\'=HYPERLINK(""http://example.com"")"');
    expect(csvCell('+380501234567')).toBe("'+380501234567");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    // Число — це число, не рядок: мінус у ньому легальний
    expect(csvCell(-1)).toBe('-1');
  });

  it('keeps non-Latin text intact', () => {
    expect(csvCell('ТОВ «Ромашка»')).toBe('ТОВ «Ромашка»');
  });
});

describe('customer CSV', () => {
  it('writes one CRLF-terminated line per customer in the header order', () => {
    const line = customerCsvLine({
      numberLabel: 'C-000001',
      name: 'Acme',
      kind: 'ORGANIZATION',
      status: 'ACTIVE',
      email: 'a@acme.test',
      phone: null,
      ownerEmail: 'owner@acme.test',
      tags: ['vip', 'b2b'],
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
    });
    expect(line).toBe(
      'C-000001,Acme,ORGANIZATION,ACTIVE,a@acme.test,,owner@acme.test,vip; b2b,2026-01-02T03:04:05.000Z\r\n',
    );
    expect(csvLine(CUSTOMER_CSV_HEADER).split(',')).toHaveLength(9);
    expect(CSV_BOM).toBe('﻿');
  });
});
