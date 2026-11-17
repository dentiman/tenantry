import { afterEach, describe, expect, it } from 'vitest';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { axiosInstance } from './http-client';

/**
 * Проводка `Idempotency-Key` у СПРАВЖНЬОМУ клієнті (правила ключа — в
 * `libs/ui/src/api/idempotency.test.ts`): запит проходить обидва інтерсептори, мережу
 * замінює adapter. Перевіряється те, що видно серверу, — заголовок кожної спроби.
 */
const KEY = 'Idempotency-Key';
const originalAdapter = axiosInstance.defaults.adapter;

function respondWith(
  outcomes: (number | 'network')[],
): { keys: (string | undefined)[]; adapter: AxiosAdapter } {
  const keys: (string | undefined)[] = [];
  const queue = [...outcomes];
  const adapter: AxiosAdapter = (config: InternalAxiosRequestConfig) => {
    const header: unknown = config.headers.get(KEY);
    keys.push(typeof header === 'string' ? header : undefined);
    const outcome = queue.shift() ?? 201;
    if (outcome === 'network') {
      return Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config));
    }
    const response = { data: {}, status: outcome, statusText: '', headers: {}, config };
    return outcome < 400
      ? Promise.resolve(response)
      : Promise.reject(
          new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, null, response),
        );
  };
  return { keys, adapter };
}

const createCustomer = (name = 'Acme') =>
  axiosInstance.post('/api/customers', { name }).catch((error: unknown) => error);

describe('http client: Idempotency-Key', () => {
  afterEach(() => {
    axiosInstance.defaults.adapter = originalAdapter;
  });

  it('a double submit sends the same key; the next submit after success sends a new one', async () => {
    const { keys, adapter } = respondWith([201, 201, 201]);
    axiosInstance.defaults.adapter = adapter;

    await Promise.all([createCustomer(), createCustomer()]);
    await createCustomer();

    expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('a submit after a lost response or a server error reuses the key', async () => {
    const { keys, adapter } = respondWith(['network', 503, 201, 201]);
    axiosInstance.defaults.adapter = adapter;

    await createCustomer('Lost');
    await createCustomer('Lost');
    await createCustomer('Lost');
    await createCustomer('Lost');

    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
    // Третя спроба отримала 201 — четверта вже новий намір
    expect(keys[3]).not.toBe(keys[0]);
  });

  it('a corrected form after a rejection sends a new key', async () => {
    const { keys, adapter } = respondWith([400, 201]);
    axiosInstance.defaults.adapter = adapter;

    await createCustomer('');
    await createCustomer('Fixed');

    expect(keys[1]).not.toBe(keys[0]);
  });

  it('requests that are not JSON POSTs carry no key', async () => {
    const { keys, adapter } = respondWith([200, 200, 200]);
    axiosInstance.defaults.adapter = adapter;

    await axiosInstance.get('/api/customers');
    await axiosInstance.patch('/api/customers/1', { name: 'Renamed' });
    await axiosInstance.post('/api/files/1/complete');

    expect(keys).toEqual([undefined, undefined, undefined]);
  });
});
