import { describe, expect, it } from 'vitest';
import { toLogRecord } from './client-log-sink';

describe('client log record', () => {
  it('uses the backend field names so one trace query finds browser and server lines', () => {
    const record = toLogRecord(
      'web',
      {
        source: 'api',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        userId: 'user-1',
        route: '/customers',
        version: '0.1.42',
        error: { type: 'AxiosError', message: 'Network Error', stack: 'AxiosError: Network Error' },
      },
      1_700_000_000_000,
    );
    expect(record).toMatchObject({
      level: 50,
      time: 1_700_000_000_000,
      'service.name': 'web',
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      'user.id': 'user-1',
      'url.path': '/customers',
      'service.version': '0.1.42',
      context: 'api',
      msg: 'Network Error',
    });
  });

  it('drops unknown fields and a malformed trace id, and survives a non-object body', () => {
    const record = toLogRecord('web', { traceId: 'x"\n{"level":60}', password: 'secret' }, 1);
    expect(record).not.toHaveProperty('trace_id');
    expect(JSON.stringify(record)).not.toContain('secret');
    expect(toLogRecord('web', 'garbage', 1).msg).toBe('Client error');
  });
});
