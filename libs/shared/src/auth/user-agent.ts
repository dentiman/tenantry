/**
 * Людська назва пристрою з User-Agent — «Chrome on macOS».
 *
 * Свідомо ~шість регексів, а не бібліотека (ua-parser-js і родичі): у списку
 * пристроїв підпис виконує рівно одну роботу — допомогти людині впізнати СВІЙ
 * ноутбук серед своїх же сесій. Точність розбору рідкісних агентів на це не
 * впливає, а зовнішня залежність тягне за собою базу даних, яка застаріває, і
 * оновлення заради рядка в UI.
 *
 * Той самий рядок — ключ «нового пристрою» (AUTH-1): вхід із міткою, якої ще
 * немає серед живих сесій, надсилає сповіщення безпеки. Тому груба класифікація
 * тут — не тільки прийнятна, а й бажана: мінорна версія браузера не мусить
 * виглядати як новий пристрій.
 */

interface Pattern {
  readonly re: RegExp;
  readonly name: string;
}

/** Порядок важливий: Edge і Chrome представляються як Safari, Chrome — як Safari теж */
const BROWSERS: readonly Pattern[] = [
  { re: /\bEdg(?:e|A|iOS)?\//, name: 'Edge' },
  { re: /\b(?:OPR|Opera)\//, name: 'Opera' },
  { re: /\bFirefox\/|\bFxiOS\//, name: 'Firefox' },
  { re: /\bChrome\/|\bCriOS\//, name: 'Chrome' },
  { re: /\bSafari\//, name: 'Safari' },
];

/** iPhone/iPad перевіряємо ДО macOS: iPadOS представляється як Macintosh */
const PLATFORMS: readonly Pattern[] = [
  { re: /\biPhone\b/, name: 'iPhone' },
  { re: /\biPad\b/, name: 'iPad' },
  { re: /\bAndroid\b/, name: 'Android' },
  { re: /\bWindows\b/, name: 'Windows' },
  { re: /\bMac OS X\b|\bMacintosh\b/, name: 'macOS' },
  { re: /\bCrOS\b/, name: 'ChromeOS' },
  { re: /\bLinux\b|\bX11\b/, name: 'Linux' },
];

export const UNKNOWN_DEVICE_LABEL = 'Unknown device';

export function parseUserAgent(userAgent: string | undefined | null): string | null {
  if (!userAgent || userAgent.trim() === '') {
    return null;
  }

  const browser = BROWSERS.find((p) => p.re.test(userAgent))?.name;
  const platform = PLATFORMS.find((p) => p.re.test(userAgent))?.name;

  if (browser && platform) {
    return `${browser} on ${platform}`;
  }
  // Половина розпізнаного краща за «Unknown»: «Chrome» і «Windows» усе ще
  // відрізняють один рядок списку від іншого
  return browser ?? platform ?? UNKNOWN_DEVICE_LABEL;
}
