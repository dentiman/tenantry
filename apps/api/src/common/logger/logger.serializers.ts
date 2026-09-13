import { SENSITIVE_HEADERS } from './logger.constants';

/**
 * AUTH-0: адреса клієнта — `req.ip` Express-а, який після `trust proxy` бере її з
 * X-Forwarded-For. Стандартний `remoteAddress` pino — це сокет, тобто за nginx/swarm
 * адреса балансувальника. Сирий запит pino-http кладе в неперелічуване `raw`.
 */
function clientIp(req: Record<string, unknown>): unknown {
  const raw = (req as { raw?: { ip?: unknown } }).raw;
  return raw?.ip ?? req.remoteAddress;
}

// Custom serializers for redacting sensitive data
export const customSerializers = {
  req(req: Record<string, unknown>): Record<string, unknown> {
    const headers = req.headers as Record<string, unknown> | undefined;
    if (headers && typeof headers === 'object') {
      const sanitizedHeaders: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_HEADERS.includes(lowerKey)) {
          sanitizedHeaders[key] = '[REDACTED]';
        } else {
          sanitizedHeaders[key] = value;
        }
      }
      return {
        ...req,
        ip: clientIp(req),
        headers: sanitizedHeaders,
      };
    }
    return { ...req, ip: clientIp(req) };
  },
  res(res: Record<string, unknown>): Record<string, unknown> {
    const headers = res.headers as Record<string, unknown> | undefined;
    if (headers && typeof headers === 'object') {
      const sanitizedHeaders: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        // Redact Set-Cookie headers
        if (lowerKey === 'set-cookie') {
          sanitizedHeaders[key] = '[REDACTED]';
        } else {
          sanitizedHeaders[key] = value;
        }
      }
      return {
        ...res,
        headers: sanitizedHeaders,
      };
    }
    return res;
  },
};
