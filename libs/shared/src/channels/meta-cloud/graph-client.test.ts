import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MetaApiError, MetaGraphClient, redactSecrets, type GraphCall } from './graph-client';
import { GraphStub, graphError } from './testing/graph-stub';

const TOKEN = 'EAAG1234567890abcdefghijklmnopqrstuvwxyzTOKEN';
const stub = new GraphStub();
let baseUrl = '';

beforeAll(async () => {
  baseUrl = await stub.start();
});
afterAll(async () => {
  await stub.stop();
});
afterEach(() => {
  stub.reset();
});

function client(calls: GraphCall[] = [], timeoutMs = 2000): MetaGraphClient {
  return new MetaGraphClient({
    baseUrl,
    version: 'v23.0',
    timeoutMs,
    onCall: (c) => calls.push(c),
  });
}

describe('MetaGraphClient', () => {
  it('токен іде лише в заголовку Authorization, не в URL чи тілі', async () => {
    stub.route('GET', '123', { body: { id: '123' } });
    await client().request({
      method: 'GET',
      path: '123',
      query: { fields: 'id' },
      token: TOKEN,
      operation: 'verify',
    });

    const [request] = stub.requests;
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.url).not.toContain(TOKEN);
    expect(JSON.stringify(request?.body ?? '')).not.toContain(TOKEN);
    expect(request?.query).toEqual({ fields: 'id' });
  });

  it('помилка Graph стає MetaApiError з кодом, підкодом, заголовком і trace', async () => {
    stub.route('GET', '123', graphError(190, 'Invalid OAuth access token', 401, 463));
    const error = await client()
      .request({ method: 'GET', path: '123', token: TOKEN, operation: 'verify' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MetaApiError);
    expect(error).toMatchObject({
      kind: 'api',
      httpStatus: 401,
      code: 190,
      subcode: 463,
      title: 'Invalid OAuth access token',
      fbtraceId: 'TRACE',
    });
  });

  it('текст помилки, що ехо-повертає частину токена, редагується', async () => {
    stub.route(
      'GET',
      '123',
      graphError(
        190,
        `Cannot parse access token ${TOKEN.slice(0, 24)} and also ${TOKEN.slice(-14)}`,
      ),
    );
    const error = (await client()
      .request({ method: 'GET', path: '123', token: TOKEN, operation: 'verify' })
      .catch((e: unknown) => e)) as MetaApiError;

    expect(error.title).not.toContain(TOKEN.slice(0, 24));
    expect(error.title).not.toContain(TOKEN.slice(-14));
    expect(error.title).toContain('***');
    expect(error.message).not.toContain(TOKEN.slice(0, 24));
  });

  it('таймаут і недоступність — окремі види помилки без HTTP-статусу', async () => {
    stub.route('GET', 'slow', { delayMs: 500, body: {} });
    const timeout = (await client([], 100)
      .request({ method: 'GET', path: 'slow', token: TOKEN, operation: 'verify' })
      .catch((e: unknown) => e)) as MetaApiError;
    expect(timeout).toMatchObject({ kind: 'timeout', httpStatus: null });

    const unreachable = (await new MetaGraphClient({
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 500,
    })
      .request({ method: 'GET', path: 'x', token: TOKEN, operation: 'verify' })
      .catch((e: unknown) => e)) as MetaApiError;
    expect(unreachable).toMatchObject({ kind: 'network', httpStatus: null });
  });

  it('звіт про виклик: шлях без query, статус, тривалість; без токена й тіла', async () => {
    stub.route('GET', '123', { body: { id: '123' } });
    const calls: GraphCall[] = [];
    await client(calls).request({
      method: 'GET',
      path: '123',
      query: { access_hint: 'secret' },
      token: TOKEN,
      operation: 'sync',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      operation: 'sync',
      method: 'GET',
      path: '123',
      status: 200,
      errorCode: null,
    });
    expect(JSON.stringify(calls[0])).not.toContain(TOKEN);
    expect(JSON.stringify(calls[0])).not.toContain('secret');
  });

  it('Retry-After з відповіді переноситься в помилку', async () => {
    stub.route('POST', '1/messages', {
      ...graphError(130429, 'rate', 429),
      headers: { 'Retry-After': '7' },
    });
    const error = (await client()
      .request({ method: 'POST', path: '1/messages', body: {}, token: TOKEN, operation: 'send' })
      .catch((e: unknown) => e)) as MetaApiError;
    expect(error.retryAfterSeconds).toBe(7);
  });
});

describe('redactSecrets', () => {
  it('прибирає секрет повністю, його префікс і суфікс, лишаючи решту тексту', () => {
    const secret = 'abcdefghijklmnopqrstuvwxyz0123456789';
    expect(redactSecrets(`bad ${secret} here`, [secret])).toBe('bad *** here');
    expect(redactSecrets(`prefix ${secret.slice(0, 15)} end`, [secret])).toBe('prefix *** end');
    expect(redactSecrets(`tail ${secret.slice(-12)}!`, [secret])).toBe('tail ***!');
    expect(redactSecrets('nothing secret here', [secret])).toBe('nothing secret here');
  });

  it('короткі «секрети» не чіпає: випадкові збіги нашкодили б тексту', () => {
    expect(redactSecrets('abc abc abc', ['abc'])).toBe('abc abc abc');
  });
});
