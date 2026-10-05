import { join } from 'node:path';
import type { Level } from 'pino';

export const isDevelopment = process.env.NODE_ENV !== 'production';
export const logLevel = (process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info')) as Level;

// Log file paths (absolute to ensure they work in all environments)
// cwd = apps/api (nest start / node dist запускаються звідси)
export const logsDir = join(process.cwd(), 'logs');

export const jsonLogPath = join(logsDir, 'api.log'); // JSON format (for parsing, AI, monitoring)
export const prettyLogPath = join(logsDir, 'api-pretty.log'); // Human-readable format (for IDE, developers)

// Sensitive headers that should be redacted from logs
export const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'auth-token',
  'proxy-authorization',
  'x-csrf-token',
  'csrf-token',
  'x-forwarded-authorization',
];

// Paths to redact from logs (belt-and-suspenders approach with serializers)
export const redactPaths = [
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.secret',
  'req.body.token',
  'req.body.refreshToken',
  'req.query.password',
  'req.query.token',
  'req.query.api_key',
  'req.query.apiKey',
];
