import type { CountryCode } from 'libphonenumber-js';
// Один файл з УСІМА 245 прапорами як inline data-URI: 47 kB gzip, один запит, кеш,
// працює офлайн. Альтернативи гірші: React-SVG-компоненти пакета тягнуть ~1 MB у JS
// (динамічний вибір за кодом убиває tree-shaking), а <img> на кожен прапор дає
// сотні запитів при відкритті списку. CDN відпадає — прод без гарантованого інтернету
import 'country-flag-icons/3x2/flags.css';

interface CountryFlagProps {
  country: CountryCode;
  className?: string;
}

/**
 * Emoji-прапори (🇺🇦) свідомо НЕ використовуються: Windows не має regional indicators
 * у шрифті і показує замість прапора літери «UA».
 *
 * Клас будується рядковою інтерполяцією — крім іншого, це ховає `flag:XX` від
 * сканера Tailwind, який інакше побачив би в двокрапці свій синтаксис варіантів.
 */
export function CountryFlag({ country, className }: CountryFlagProps) {
  return (
    <span
      aria-hidden="true"
      className={`flag:${country} shrink-0 rounded-xs${className ? ` ${className}` : ''}`}
    />
  );
}
