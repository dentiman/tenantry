import { describe, expect, it } from 'vitest';
import { EmbeddingRequestError, OpenAiEmbeddingProvider } from './openai-embedding-provider';

const KEY = 'sk-test-secret';
const vector = (x = 1): number[] => [x, ...Array<number>(1535).fill(0)];

interface Call {
  url: string;
  body: unknown;
  init: RequestInit;
}

type Scripted = Response | Error | (() => Promise<Response>);

/** Scripted fetch: each entry answers one request, in order. */
function scripted(responses: Scripted[]): { calls: Call[]; request: typeof fetch } {
  const calls: Call[] = [];
  const request = (async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, body, init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  }) as typeof fetch;
  return { calls, request };
}

const ok = (embeddings: number[][], model = 'text-embedding-3-small', tokens = 7): Response =>
  Response.json({
    model,
    // Reversed on purpose: the adapter must reorder by `index`.
    data: embeddings.map((embedding, index) => ({ index, embedding })).reverse(),
    usage: { prompt_tokens: tokens },
  });

const provider = (
  request: typeof fetch,
  baseUrl = 'https://api.openai.com/v1',
  retries = 1,
): OpenAiEmbeddingProvider =>
  new OpenAiEmbeddingProvider({ baseUrl, apiKey: KEY, retries, timeoutMs: 1000 }, request);

const signal = (): AbortSignal => new AbortController().signal;

describe('OpenAiEmbeddingProvider', () => {
  it('sends the fixed profile and returns vectors in request order with usage', async () => {
    const { calls, request } = scripted([ok([vector(1), vector(2)])]);
    const result = await provider(request).embed(['a', 'b'], signal());
    expect(result.model).toBe('text-embedding-3-small');
    expect(result.vectors.map((v) => v[0])).toEqual([1, 2]);
    expect(result.inputTokens).toBe(7);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/embeddings');
    expect(calls[0]?.init.redirect).toBe('error');
    expect(calls[0]?.body).toEqual({
      model: 'text-embedding-3-small',
      dimensions: 1536,
      encoding_format: 'float',
      input: ['a', 'b'],
    });
  });

  it('uses the OpenRouter model id and accepts its prefixed model in the response', async () => {
    const { calls, request } = scripted([ok([vector()], 'openai/text-embedding-3-small')]);
    const result = await provider(request, 'https://openrouter.ai/api/v1/').embed(['a'], signal());
    expect(result.model).toBe('text-embedding-3-small');
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/embeddings');
    expect(calls[0]?.body).toMatchObject({
      model: 'openai/text-embedding-3-small',
    });
  });

  it.each([
    'http://api.openai.com/v1',
    'https://evil.example.com/v1',
    'https://user:pass@api.openai.com/v1',
    'https://api.openai.com/v1?x=1',
  ])('rejects unsafe base URL %s', (baseUrl) => {
    expect(() => provider(scripted([]).request, baseUrl)).toThrow();
  });

  it('rejects empty, blank and oversized batches before any request', async () => {
    const { calls, request } = scripted([]);
    for (const texts of [[], [' '], Array<string>(129).fill('x')]) {
      await expect(provider(request).embed(texts, signal())).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });

  it('retries 429 and 5xx, then succeeds', async () => {
    const { calls, request } = scripted([
      new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }),
      ok([vector()]),
    ]);
    await expect(provider(request).embed(['a'], signal())).resolves.toBeDefined();
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 4xx and exposes only a status code, never the body or key', async () => {
    const { calls, request } = scripted([new Response(`invalid key ${KEY}`, { status: 401 })]);
    const error = await provider(request)
      .embed(['a'], signal())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingRequestError);
    expect((error as EmbeddingRequestError).code).toBe('embedding-http-401');
    expect((error as Error).message).not.toContain(KEY);
    expect(calls).toHaveLength(1);
  });

  it('gives up after the configured retries on network errors', async () => {
    const { calls, request } = scripted([new Error('ECONNRESET'), new Error('ECONNRESET')]);
    await expect(provider(request).embed(['a'], signal())).rejects.toMatchObject({
      code: 'embedding-network-or-timeout',
    });
    expect(calls).toHaveLength(2);
  });

  it('refuses a Retry-After longer than the bound instead of sleeping', async () => {
    const { calls, request } = scripted([
      new Response('', { status: 503, headers: { 'retry-after': '120' } }),
    ]);
    await expect(provider(request).embed(['a'], signal())).rejects.toMatchObject({
      code: 'embedding-http-503',
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['wrong count', (): Response => ok([vector(), vector()])],
    ['wrong model', (): Response => ok([vector()], 'text-embedding-3-large')],
    ['malformed body', (): Response => Response.json({ data: 'nope' })],
  ])('rejects an invalid response: %s', async (_, response) => {
    const { request } = scripted([response()]);
    await expect(provider(request).embed(['a'], signal())).rejects.toMatchObject({
      code: 'embedding-invalid-response',
    });
  });

  it.each([
    ['wrong dimensions', [1, 0, 0]],
    ['zero vector', vector(0)],
  ])('rejects an unusable vector: %s', async (_, embedding) => {
    const { request } = scripted([ok([embedding])]);
    await expect(provider(request).embed(['a'], signal())).rejects.toMatchObject({
      code: 'embedding-invalid-vector',
    });
  });

  it('stops on cancellation without retrying', async () => {
    const controller = new AbortController();
    const { calls, request } = scripted([
      (): Promise<Response> => {
        controller.abort();
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      },
    ]);
    await expect(provider(request).embed(['a'], controller.signal)).rejects.toThrow(/abort/i);
    expect(calls).toHaveLength(1);
  });
});
