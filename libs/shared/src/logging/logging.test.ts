import { Writable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { ClsService } from 'nestjs-cls';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { LOG_CONTEXT, LOG_FIELDS } from './log-fields';
import { REDACT_PATHS, logSerializers } from './log-redaction';
import { baseFields, contextMixin, genReqId } from './logger.factory';
import { newTraceId, traceIdFromTraceparent, traceIdFromUuid } from './trace-context';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

function requestWith(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function fakeCls(store: Record<string, string> | null): ClsService {
  return {
    isActive: () => store !== null,
    get: (key: string) => store?.[key],
  } as unknown as ClsService;
}

describe('trace context', () => {
  it('takes the trace id from a valid traceparent', () => {
    expect(traceIdFromTraceparent(`00-${TRACE_ID}-00f067aa0ba902b7-01`)).toBe(TRACE_ID);
  });

  it.each([
    ['missing', undefined],
    ['free text', 'my-request-1'],
    ['uppercase hex', `00-${TRACE_ID.toUpperCase()}-00f067aa0ba902b7-01`],
    ['all-zero trace id', `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`],
    ['trailing payload', `00-${TRACE_ID}-00f067aa0ba902b7-01\n{"level":60}`],
  ])('rejects a %s header', (_name, header) => {
    expect(traceIdFromTraceparent(header)).toBeUndefined();
  });

  it('generates a 32-hex id when the client sent none or a malformed one', () => {
    expect(genReqId(requestWith({}))).toMatch(/^[0-9a-f]{32}$/);
    expect(genReqId(requestWith({ traceparent: 'x'.repeat(5000) }))).toMatch(/^[0-9a-f]{32}$/);
    expect(genReqId(requestWith({ traceparent: `00-${TRACE_ID}-00f067aa0ba902b7-01` }))).toBe(
      TRACE_ID,
    );
    expect(newTraceId()).not.toBe(newTraceId());
  });

  it('derives a deterministic trace id from a job uuid', () => {
    expect(traceIdFromUuid('4bf92f35-77b3-4da6-a3ce-929d0e0e4736')).toBe(TRACE_ID);
    expect(traceIdFromUuid('not-a-uuid')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('log record', () => {
  function capture(cls: ClsService): { logger: pino.Logger; lines: () => Record<string, unknown>[] } {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done): void {
        chunks.push(chunk.toString());
        done();
      },
    });
    const logger = pino(
      {
        base: baseFields('api', true),
        mixin: contextMixin(cls),
        serializers: logSerializers,
        redact: [...REDACT_PATHS],
      },
      stream,
    );
    return {
      logger,
      lines: () =>
        chunks
          .join('')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  }

  it('carries service, trace, tenant and user fields under their OpenTelemetry names', () => {
    const { logger, lines } = capture(
      fakeCls({ [LOG_CONTEXT.traceId]: TRACE_ID, tenantId: 'tenant-1', [LOG_CONTEXT.userId]: 'user-1' }),
    );
    logger.info('hello');
    expect(lines()[0]).toMatchObject({
      [LOG_FIELDS.serviceName]: 'api',
      [LOG_FIELDS.environment]: 'development',
      [LOG_FIELDS.traceId]: TRACE_ID,
      [LOG_FIELDS.tenantId]: 'tenant-1',
      [LOG_FIELDS.userId]: 'user-1',
    });
  });

  it('adds no context fields outside a request or a job', () => {
    const { logger, lines } = capture(fakeCls(null));
    logger.info('boot');
    const [line] = lines();
    expect(line).not.toHaveProperty([LOG_FIELDS.traceId]);
    expect(line).not.toHaveProperty([LOG_FIELDS.userId]);
  });

  it('never writes credentials from request or response headers', () => {
    const { logger, lines } = capture(fakeCls(null));
    logger.info({
      req: {
        id: TRACE_ID,
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-access-token',
          cookie: 'refresh=secret-refresh-token',
          'user-agent': 'vitest',
        },
        body: { email: 'a@b.c', password: 'secret-password' },
      },
      res: { headers: { 'set-cookie': ['refresh=secret-refresh-token; HttpOnly'] } },
    });
    const raw = JSON.stringify(lines()[0]);
    expect(raw).not.toContain('secret-');
    expect(raw).toContain('vitest');
    expect(raw).toContain('a@b.c');
  });
});
