import type { LoggerModuleAsyncParams } from 'nestjs-pino';
import { multistream } from 'pino';
import { createStream } from 'rotating-file-stream';
import {
  isDevelopment,
  logLevel,
  jsonLogPath,
  prettyLogPath,
  redactPaths,
} from './logger.constants';
import { customSerializers } from './logger.serializers';

// Create rotating file stream for production (only if not in development)
const createRotatingStream = (): ReturnType<typeof createStream> | null => {
  if (isDevelopment) {
    return null;
  }
  return createStream(jsonLogPath, {
    size: '10M', // Rotate when file reaches 10MB
    interval: '1d', // Rotate daily
    maxFiles: 30, // Keep 30 files (30 days of logs)
    compress: 'gzip', // Compress rotated files to .gz
  });
};

const rotatingStream = createRotatingStream();

export const loggerConfig: LoggerModuleAsyncParams = {
  useFactory: () => ({
    pinoHttp: isDevelopment
      ? // Development: use transport targets (pretty console + files)
        {
          level: logLevel,
          serializers: customSerializers,
          redact: redactPaths,
          transport: {
            targets: [
              // Console: pretty format with colors
              {
                target: 'pino-pretty',
                level: logLevel,
                options: {
                  colorize: true,
                  translateTime: 'yyyy-mm-dd HH:MM:ss',
                  ignore: 'pid,hostname',
                },
              },
              // File 1: JSON format (for parsing, AI, monitoring)
              {
                target: 'pino/file',
                level: logLevel,
                options: {
                  destination: jsonLogPath,
                  mkdir: true,
                },
              },
              // File 2: Pretty format (for humans, IDE)
              {
                target: 'pino-pretty',
                level: logLevel,
                options: {
                  destination: prettyLogPath,
                  colorize: false,
                  translateTime: 'yyyy-mm-dd HH:MM:ss',
                  ignore: 'pid,hostname',
                  mkdir: true,
                },
              },
            ],
          },
          autoLogging: {
            ignore: (req): boolean => req.url === '/health' || req.url === '/api/health',
          },
          customSuccessMessage: (req, res): string => {
            return `${String(req.method)} ${String(req.url)} - ${String(res.statusCode)}`;
          },
          customErrorMessage: (req, res, err): string => {
            return `${String(req.method)} ${String(req.url)} - ${String(res.statusCode)} - ${err.message}`;
          },
        }
      : // Production: use multistream with rotating file
        {
          level: logLevel,
          serializers: customSerializers,
          redact: redactPaths,
          stream: multistream([
            { stream: process.stdout }, // stdout
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            { stream: rotatingStream! }, // rotating file with compression (safe: only used in production)
          ]),
          autoLogging: {
            ignore: (req): boolean => req.url === '/health' || req.url === '/api/health',
          },
          customSuccessMessage: (req, res): string => {
            return `${String(req.method)} ${String(req.url)} - ${String(res.statusCode)}`;
          },
          customErrorMessage: (req, res, err): string => {
            return `${String(req.method)} ${String(req.url)} - ${String(res.statusCode)} - ${err.message}`;
          },
        },
  }),
};
