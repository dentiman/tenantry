import { describe, expect, it } from 'vitest';
import { normalizeE164, phoneDigits, phoneLookupValues } from './phone';

describe('нормалізація телефону', () => {
  it('з плюсом і без — один E.164', () => {
    expect(normalizeE164('+380 50 123 4567')).toBe('+380501234567');
    expect(normalizeE164('380501234567')).toBe('+380501234567');
  });

  it('значення пошуку покривають обидва формати', () => {
    expect(phoneLookupValues('+380501234567')).toEqual(
      expect.arrayContaining(['380501234567', '+380501234567']),
    );
    expect(phoneLookupValues('380501234567')).toEqual(
      expect.arrayContaining(['380501234567', '+380501234567']),
    );
  });

  it('сміття й занадто короткий номер: без падіння і без збігу', () => {
    expect(normalizeE164('abc')).toBeNull();
    expect(normalizeE164('123')).toBeNull();
    expect(phoneLookupValues('abc')).toEqual([]);
    expect(phoneLookupValues('')).toEqual([]);
  });

  it('невалідний, але цифровий номер шукається як є, E.164 не вигадується', () => {
    expect(normalizeE164('1234567')).toBeNull();
    expect(phoneLookupValues('1234567')).toEqual(['1234567']);
    expect(phoneDigits('+1 (555) 000-0001')).toBe('15550000001');
  });
});
