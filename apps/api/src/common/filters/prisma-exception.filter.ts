import { type ArgumentsHost, Catch, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

interface PrismaError {
  code: string;
  meta?: { target?: string[] };
}

function isPrismaError(error: unknown): error is PrismaError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as PrismaError).code === 'string' &&
    (error as PrismaError).code.startsWith('P')
  );
}

@Catch()
export class PrismaExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (!isPrismaError(exception)) {
      super.catch(exception, host);
      return;
    }

    this.logger.error(
      `Prisma error occurred - code: ${exception.code}, meta: ${JSON.stringify(exception.meta)}`,
    );

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    switch (exception.code) {
      case 'P2025': {
        this.logger.warn('Prisma: Resource not found (P2025)');
        response.status(HttpStatus.NOT_FOUND).json({
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Resource not found',
        });
        break;
      }
      case 'P2002': {
        const fields = exception.meta?.target?.join(', ') ?? 'unknown';
        this.logger.warn(`Prisma: Unique constraint violation (P2002) on fields: ${fields}`);
        response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          message: `Unique constraint violation on: ${fields}`,
        });
        break;
      }
      default: {
        this.logger.error(`Prisma: Unhandled error code ${exception.code}`);
        super.catch(exception, host);
      }
    }
  }
}
