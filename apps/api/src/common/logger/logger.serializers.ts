import { SENSITIVE_HEADERS } from './logger.constants';

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
        headers: sanitizedHeaders,
      };
    }
    return req;
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
