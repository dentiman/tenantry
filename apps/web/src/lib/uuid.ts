/**
 * `crypto.randomUUID()` вимагає secure context (https або localhost) — тестовий прод
 * цього скелетона свідомо живе на голому http IP:port (COOKIE_SECURE=false, див.
 * docker/deploy.env), тож браузер там `randomUUID` не віддає (`TypeError: crypto.randomUUID
 * is not a function`). `crypto.getRandomValues` секретного контексту не потребує — фолбек
 * будує v4 UUID вручну (RFC 4122 §4.4).
 */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte, index) => {
    if (index === 6) byte = (byte & 0x0f) | 0x40;
    if (index === 8) byte = (byte & 0x3f) | 0x80;
    return byte.toString(16).padStart(2, '0');
  });
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
