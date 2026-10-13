import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Нормалізація телефону для адрес контакта (docs/whatsapp-channel.md §4.6). Адреса
 * зберігається ЯК ПРИЙШЛА, а поруч — E.164; пошук іде за обома, тому «+380…» і «380…» —
 * один контакт.
 *
 * Свідомо НЕ тут: правила країн, де ту саму людину пишуть по-різному (BR 9-та цифра, MX `521`,
 * AR `549`) — це CHAT-3c, коли з'являться реальні вхідні з таких номерів.
 */

/** Лише цифри: так Meta віддає `wa_id` (без плюса) */
export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** E.164 з плюсом або `null`, якщо рядок не є валідним номером */
export function normalizeE164(raw: string): string | null {
  const digits = phoneDigits(raw);
  if (digits.length === 0) return null;
  const parsed = parsePhoneNumberFromString(`+${digits}`);
  return parsed?.isValid() ? parsed.number : null;
}

/**
 * Значення, за якими шукаємо наявну адресу контакта: як прийшло, цифри, E.164. Порожній
 * список для сміття — тоді збігу нема і створюється новий контакт.
 */
export function phoneLookupValues(raw: string): string[] {
  const digits = phoneDigits(raw);
  if (digits.length === 0) return [];
  const values = new Set<string>([raw.trim(), digits]);
  const e164 = normalizeE164(raw);
  if (e164) values.add(e164);
  return [...values];
}
