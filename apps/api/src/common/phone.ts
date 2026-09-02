import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * phone і phoneCountry — одна неподільна пара, і тримається вона тут, а не крос-полевим
 * refine у контракті (той зробив би зі схеми ZodEffects і зламав .omit()/.partial(),
 * якими Update-схеми виводяться з Create-схем).
 *
 * Правила: телефон стерли → країну теж; країну не прислали → виводимо з самого номера
 * (для +380 однозначно; для +1 клієнт має прислати явно — інакше буде US);
 * телефон у патчі відсутній → пари не чіпаємо взагалі, навіть якщо прислали саму країну.
 *
 * Живе в common/, а не в users/: телефон із країною є і в кастомерів, і в їхніх
 * контактних осіб — правило узгодженості пари мусить бути одне на застосунок.
 */
export function normalizePhonePair(data: {
  phone?: string | null;
  phoneCountry?: string | null;
}): { phone?: string | null; phoneCountry?: string | null } {
  if (data.phone === undefined) return {};
  if (data.phone === null) return { phone: null, phoneCountry: null };

  return {
    phone: data.phone,
    phoneCountry: data.phoneCountry ?? parsePhoneNumberFromString(data.phone)?.country ?? null,
  };
}
