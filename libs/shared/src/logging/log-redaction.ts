/** Заголовки, значення яких у лог не потрапляють ніколи (порівняння в нижньому регістрі) */
export const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'auth-token',
  'proxy-authorization',
  'x-csrf-token',
  'csrf-token',
  'x-forwarded-authorization',
  // Підпис вебхука Meta — не секрет сам по собі, але дозволяє відтворити запит разом із тілом
  'x-hub-signature-256',
]);

/** Другий рубіж поверх серіалізаторів: поля тіла й query, якщо їх колись почнуть логувати */
export const REDACT_PATHS: readonly string[] = [
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.secret',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.accessToken',
  'req.query.password',
  'req.query.token',
  'req.query.api_key',
  'req.query.apiKey',
];

const REDACTED = '[REDACTED]';

function redactHeaders(headers: unknown): unknown {
  if (typeof headers !== 'object' || headers === null) {
    return headers;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return result;
}

/**
 * Адреса клієнта — `req.ip` Express-а (після `trust proxy` — з X-Forwarded-For). Стандартний
 * `remoteAddress` pino — це сокет, тобто за nginx/swarm адреса балансувальника. Сирий запит
 * pino-http кладе в неперелічуване `raw`.
 */
function clientIp(req: Record<string, unknown>): unknown {
  const raw = (req as { raw?: { ip?: unknown } }).raw;
  return raw?.ip ?? req.remoteAddress;
}

export const logSerializers = {
  req(req: Record<string, unknown>): Record<string, unknown> {
    return { ...req, ip: clientIp(req), headers: redactHeaders(req.headers) };
  },
  res(res: Record<string, unknown>): Record<string, unknown> {
    return { ...res, headers: redactHeaders(res.headers) };
  },
};
