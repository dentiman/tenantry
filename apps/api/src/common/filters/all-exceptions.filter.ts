import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import type { Request, Response } from 'express';
import type { ApiError, ApiErrorCode, FieldError } from '@saas-skeleton/contracts';

interface PrismaError {
  code: string;
  meta?: {
    target?: string[];
    // Prisma 7 + driver adapters (adapter-pg): поля унікального констрейнта лежать тут
    driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } };
  };
}

function uniqueViolationFields(meta: PrismaError['meta']): string[] {
  if (Array.isArray(meta?.target)) {
    return meta.target.filter((t): t is string => typeof t === 'string');
  }
  const fields = meta?.driverAdapterError?.cause?.constraint?.fields;
  return Array.isArray(fields) ? fields.filter((f): f is string => typeof f === 'string') : [];
}

/** Коди Prisma, що означають недоступність БД/пулу — клієнту можна ретраїти */
const PRISMA_UNAVAILABLE_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1010', 'P1017', 'P2024']);

/**
 * Node-рівневі коди обриву з'єднання: Prisma 7 із driver adapters (adapter-pg)
 * при недоступному Postgres кидає PrismaClientKnownRequestError з сирим кодом
 * драйвера (ECONNREFUSED), а не P1001 — перевірено на живому обриві БД.
 */
const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']);

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

interface ZodIssueLike {
  path: (string | number)[];
  message: string;
  code: string;
}

function isZodError(error: unknown): error is { issues: ZodIssueLike[] } {
  return typeof error === 'object' && error !== null && 'issues' in error && Array.isArray(error.issues);
}

const STATUS_TO_CODE: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

function codeFromStatus(status: number): ApiErrorCode {
  return STATUS_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
}

/**
 * Єдина точка нормалізації помилок: будь-який виняток → ApiError envelope
 * (libs/contracts). Внутрішні деталі (stack, сирі повідомлення Prisma) — тільки в лог.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // pino-http кладе id на req; тип express його не знає
    const reqId = (request as { id?: string | number }).id;
    const requestId = reqId === undefined ? undefined : String(reqId);

    const body = this.buildError(exception);
    if (requestId !== undefined) {
      body.requestId = requestId;
    }

    if (body.statusCode >= 500) {
      this.logger.error(
        { err: exception, requestId, path: request.url },
        `${request.method} ${request.url} → ${String(body.statusCode)} ${body.code}`,
      );
    } else {
      this.logger.warn(
        { requestId, path: request.url, code: body.code, fieldErrors: body.fieldErrors },
        `${request.method} ${request.url} → ${String(body.statusCode)} ${body.code}: ${body.message}`,
      );
    }

    response.status(body.statusCode).json(body);
  }

  private buildError(exception: unknown): ApiError {
    if (exception instanceof ZodValidationException) {
      return this.fromZodValidation(exception);
    }
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }
    const code = errorCode(exception);
    if (code?.startsWith('P')) {
      return this.fromPrismaError(exception as PrismaError);
    }
    if (code !== undefined && CONNECTION_ERROR_CODES.has(code)) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable, please retry',
      };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
  }

  private fromZodValidation(exception: ZodValidationException): ApiError {
    const zodError = exception.getZodError();
    const fieldErrors: FieldError[] = isZodError(zodError)
      ? zodError.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        }))
      : [];
    return {
      statusCode: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      fieldErrors,
    };
  }

  private fromHttpException(exception: HttpException): ApiError {
    const status = exception.getStatus();
    const raw = exception.getResponse();
    let message = exception.message;
    let fieldErrors: FieldError[] | undefined;

    if (typeof raw === 'string') {
      message = raw;
    } else if (typeof raw === 'object') {
      const obj = raw as { message?: string | string[]; fieldErrors?: FieldError[] };
      if (Array.isArray(obj.message)) {
        message = obj.message.join('; ');
      } else if (typeof obj.message === 'string') {
        message = obj.message;
      }
      if (Array.isArray(obj.fieldErrors)) {
        fieldErrors = obj.fieldErrors;
      }
    }

    // Внутрішні повідомлення 5xx не віддаємо назовні
    if (status >= 500) {
      message = 'Internal server error';
    }

    const body: ApiError = { statusCode: status, code: codeFromStatus(status), message };
    if (fieldErrors) {
      body.fieldErrors = fieldErrors;
    }
    return body;
  }

  private fromPrismaError(exception: PrismaError): ApiError {
    if (exception.code === 'P2025') {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'Resource not found',
      };
    }
    if (exception.code === 'P2002') {
      const targets = uniqueViolationFields(exception.meta);
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: targets.length > 0 ? `Already exists: ${targets.join(', ')}` : 'Already exists',
        fieldErrors: targets.map((field) => ({ field, message: 'Already exists', code: 'already_exists' })),
      };
    }
    if (exception.code === 'P2003') {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'Related resource constraint failed',
      };
    }
    if (PRISMA_UNAVAILABLE_CODES.has(exception.code)) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable, please retry',
      };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
  }
}
