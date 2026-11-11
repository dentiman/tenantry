import { describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from './query-client';

const boom = new Error('boom');

function fail(): Promise<never> {
  return Promise.reject(boom);
}

describe('createAppQueryClient: глобальна політика помилок', () => {
  it('мутація без meta кличе глобальний обробник', async () => {
    const onGlobalError = vi.fn();
    const client = createAppQueryClient(onGlobalError);

    await expect(
      client.getMutationCache().build(client, { mutationFn: fail }).execute(undefined),
    ).rejects.toBe(boom);

    expect(onGlobalError).toHaveBeenCalledTimes(1);
    expect(onGlobalError).toHaveBeenCalledWith(boom);
  });

  it('мутація з meta.silentError глобальний обробник НЕ кличе', async () => {
    const onGlobalError = vi.fn();
    const client = createAppQueryClient(onGlobalError);

    await expect(
      client
        .getMutationCache()
        .build(client, { mutationFn: fail, meta: { silentError: true } })
        .execute(undefined),
    ).rejects.toBe(boom);

    expect(onGlobalError).not.toHaveBeenCalled();
  });

  it('запит без meta кличе глобальний обробник', async () => {
    const onGlobalError = vi.fn();
    const client = createAppQueryClient(onGlobalError);

    await expect(
      client.fetchQuery({ queryKey: ['loud'], queryFn: fail, retry: false }),
    ).rejects.toBe(boom);

    expect(onGlobalError).toHaveBeenCalledTimes(1);
  });

  it('запит з meta.silentError глобальний обробник НЕ кличе', async () => {
    const onGlobalError = vi.fn();
    const client = createAppQueryClient(onGlobalError);

    await expect(
      client.fetchQuery({
        queryKey: ['silent'],
        queryFn: fail,
        retry: false,
        meta: { silentError: true },
      }),
    ).rejects.toBe(boom);

    expect(onGlobalError).not.toHaveBeenCalled();
  });
});
