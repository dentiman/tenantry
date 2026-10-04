import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmProviderError, type LlmChunk, type LlmRequest } from './llm-provider';
import { decimalString } from '../costs/money';
import { OpenAiCompatProvider, isAnthropicHost, parseRetryAfter } from './openai-compat.provider';

/**
 * `OpenAiCompatProvider` проти ЛОКАЛЬНОГО HTTP-стаба (ai-1a, design.md D9): жодної мережі,
 * жодного ключа. Стаб віддає записані SSE-відповіді у формі, яку шле OpenRouter
 * (`chat.completion.chunk`, окремий usage-кадр із `choices: []`, `data: [DONE]`), і
 * запамʼятовує запити, щоб перевірити їх форму.
 */

const API_KEY = 'sk-or-v1-test-secret-key-never-logged';

type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown) => void;

interface Recorded {
  readonly url: string | undefined;
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let handler: Handler;
let recorded: Recorded[] = [];
let closedConnections = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      recorded.push({ url: req.url, authorization: req.headers.authorization, body });
      res.on('close', () => {
        closedConnections += 1;
      });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  recorded = [];
  closedConnections = 0;
});

// ------------------------------------------------------------------ фікстури SSE

const MODEL = 'openai/gpt-5.6-luna';

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentChunk(content: string, finishReason: string | null = null): unknown {
  return {
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 1_790_000_000,
    model: MODEL,
    choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: finishReason }],
  };
}

function finishChunk(reason: string): unknown {
  return {
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 1_790_000_000,
    model: MODEL,
    choices: [{ index: 0, delta: {}, finish_reason: reason }],
  };
}

const USAGE_CHUNK = {
  id: 'gen-1',
  object: 'chat.completion.chunk',
  created: 1_790_000_000,
  model: `${MODEL}-20260901`,
  choices: [],
  usage: {
    prompt_tokens: 1_234,
    completion_tokens: 56,
    total_tokens: 1_290,
    prompt_tokens_details: { cached_tokens: 1_024 },
  },
};

function sse(res: ServerResponse, frames: readonly string[], end = true): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const f of frames) {
    res.write(f);
  }
  if (end) {
    res.end();
  }
}

function json(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ error: { message: `stub ${String(status)}`, code: status } }));
}

// ------------------------------------------------------------------ хелпери

function makeProvider(overrides: { baseUrl?: string } = {}): {
  provider: OpenAiCompatProvider;
  logger: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
} {
  const logger = { log: vi.fn(), warn: vi.fn() };
  const provider = new OpenAiCompatProvider({
    baseUrl: overrides.baseUrl ?? baseUrl,
    apiKey: API_KEY,
    requestTimeoutMs: 5_000,
    logger,
  });
  return { provider, logger };
}

const REQUEST: LlmRequest = {
  model: MODEL,
  maxOutputTokens: 321,
  messages: [
    { role: 'system', content: 'You are the assistant.' },
    { role: 'user', content: 'How do I rename the workspace?' },
  ],
};

async function collect(
  provider: OpenAiCompatProvider,
  signal: AbortSignal = new AbortController().signal,
): Promise<LlmChunk[]> {
  const chunks: LlmChunk[] = [];
  for await (const chunk of provider.generate(REQUEST, signal)) {
    chunks.push(chunk);
  }
  return chunks;
}

async function failure(provider: OpenAiCompatProvider): Promise<LlmProviderError> {
  try {
    await collect(provider);
  } catch (error) {
    expect(error).toBeInstanceOf(LlmProviderError);
    return error as LlmProviderError;
  }
  throw new Error('expected generate() to throw');
}

// ------------------------------------------------------------------ тести

describe('OpenAiCompatProvider', () => {
  it('успіх: стрімить текст, usage — останнім кадром, форма запиту правильна', async () => {
    handler = (_req, res): void => {
      sse(res, [
        frame(contentChunk('Open ')),
        frame(contentChunk('**Settings**.')),
        frame(finishChunk('stop')),
        frame(USAGE_CHUNK),
        'data: [DONE]\n\n',
      ]);
    };
    const chunks = await collect(makeProvider().provider);

    expect(chunks.map((c) => c.text).join('')).toBe('Open **Settings**.');
    expect(chunks.filter((c) => c.usage)).toHaveLength(1);
    expect(chunks.at(-1)).toEqual({
      text: '',
      usage: {
        promptTokens: 1_234,
        completionTokens: 56,
        model: `${MODEL}-20260901`,
        cachedPromptTokens: 1_024,
      },
    });

    expect(recorded).toHaveLength(1);
    const request = recorded[0];
    expect(request?.url).toBe('/api/v1/chat/completions');
    expect(request?.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request?.body).toMatchObject({
      model: MODEL,
      max_tokens: 321,
      stream: true,
      stream_options: { include_usage: true },
      messages: REQUEST.messages,
    });
  });

  it('AI-5b: id запиту — першим кадром, usage OpenRouter з cost і розбивкою токенів', async () => {
    handler = (_req, res): void => {
      sse(res, [
        frame(contentChunk('Hi')),
        frame(finishChunk('stop')),
        frame({
          ...USAGE_CHUNK,
          usage: {
            prompt_tokens: 2_000,
            completion_tokens: 300,
            total_tokens: 2_300,
            cost: 0.00123456789,
            is_byok: false,
            prompt_tokens_details: { cached_tokens: 1_500, cache_write_tokens: 200 },
            completion_tokens_details: { reasoning_tokens: 120 },
            cost_details: { upstream_inference_cost: null },
          },
        }),
        'data: [DONE]\n\n',
      ]);
    };
    const chunks = await collect(makeProvider().provider);

    expect(chunks[0]).toEqual({ text: '', requestId: 'gen-1' });
    expect(chunks.filter((c) => c.requestId)).toHaveLength(1);
    expect(chunks.at(-1)?.usage).toEqual({
      promptTokens: 2_000,
      completionTokens: 300,
      model: `${MODEL}-20260901`,
      cachedPromptTokens: 1_500,
      cacheWriteTokens: 200,
      reasoningTokens: 120,
      reportedCost: '0.00123456789',
    });
  });

  it('AI-5b: cost неочікуваної форми чи відʼємний — вартості просто немає', async () => {
    handler = (_req, res): void => {
      sse(res, [
        frame(contentChunk('Hi', 'stop')),
        frame({
          ...USAGE_CHUNK,
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 'free' },
        }),
        'data: [DONE]\n\n',
      ]);
    };
    const usage = (await collect(makeProvider().provider)).at(-1)?.usage;
    expect(usage?.reportedCost).toBeUndefined();
    expect(usage?.cacheWriteTokens).toBeUndefined();
    expect(usage?.promptTokens).toBe(10);
  });

  it('без finish_reason, але з usage-кадром — відповідь ЗАВЕРШЕНА', async () => {
    handler = (_req, res): void => {
      sse(res, [frame(contentChunk('Done.')), frame(USAGE_CHUNK), 'data: [DONE]\n\n']);
    };
    const chunks = await collect(makeProvider().provider);
    expect(chunks.map((c) => c.text).join('')).toBe('Done.');
    expect(chunks.at(-1)?.usage?.promptTokens).toBe(1_234);
  });

  it('finish_reason "length" (стеля max_tokens) — звичайна завершена відповідь, не помилка', async () => {
    handler = (_req, res): void => {
      sse(res, [
        frame(contentChunk('Truncated by design')),
        frame(finishChunk('length')),
        'data: [DONE]\n\n',
      ]);
    };
    const chunks = await collect(makeProvider().provider);
    expect(chunks.map((c) => c.text).join('')).toBe('Truncated by design');
    // Бекенд без include_usage: usage немає, і це не помилка — колонки лишаться порожніми
    expect(chunks.some((c) => c.usage)).toBe(false);
  });

  it('429 з Retry-After: ретрай-придатна, retryAfterMs із заголовка', async () => {
    handler = (_req, res): void => {
      json(res, 429, { 'retry-after': '2' });
    };
    const error = await failure(makeProvider().provider);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(2_000);
    // Власних ретраїв SDK немає (maxRetries: 0) — рівно один HTTP-запит
    expect(recorded).toHaveLength(1);
  });

  it('401: НЕ ретрай-придатна, один запит', async () => {
    handler = (_req, res): void => {
      json(res, 401);
    };
    const error = await failure(makeProvider().provider);
    expect(error.retryable).toBe(false);
    expect(error.retryAfterMs).toBeUndefined();
    expect(recorded).toHaveLength(1);
  });

  it.each([
    [400, false],
    [403, false],
    [404, false],
    [422, false],
    [418, false],
    [408, true],
    [409, true],
    [500, true],
    [502, true],
    [503, true],
  ])('HTTP %i → retryable=%s', async (status, retryable) => {
    handler = (_req, res): void => {
      json(res, status);
    };
    const error = await failure(makeProvider().provider);
    expect(error.retryable).toBe(retryable);
  });

  it('обрив сокета посеред стріму — ретрай-придатна', async () => {
    handler = (req, res): void => {
      sse(res, [frame(contentChunk('Hel'))], false);
      setTimeout(() => req.socket.destroy(), 20);
    };
    const provider = makeProvider().provider;
    const received: string[] = [];
    await expect(
      (async (): Promise<void> => {
        for await (const chunk of provider.generate(REQUEST, new AbortController().signal)) {
          received.push(chunk.text);
        }
      })(),
    ).rejects.toMatchObject({ name: 'LlmProviderError', retryable: true });
    expect(received).toEqual(['', 'Hel']);
  });

  it('стрім закінчився без finish_reason і без usage — обрізаний, ретрай-придатна', async () => {
    handler = (_req, res): void => {
      sse(res, [frame(contentChunk('Half an ans'))]);
    };
    const error = await failure(makeProvider().provider);
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(/prematurely/);
  });

  it('кадр помилки всередині 200-стріму — ретрай-придатна', async () => {
    handler = (_req, res): void => {
      sse(res, [
        frame(contentChunk('Start')),
        frame({ error: { message: 'upstream provider error', code: 502 } }),
      ]);
    };
    const error = await failure(makeProvider().provider);
    expect(error.retryable).toBe(true);
  });

  it('abort посеред стріму: тихе повернення, і стаб бачить закрите зʼєднання', async () => {
    handler = (_req, res): void => {
      // Стрім, що мовчить після першого кадру — вихід лише через abort
      sse(res, [frame(contentChunk('thinking…'))], false);
    };
    const controller = new AbortController();
    const provider = makeProvider().provider;
    const chunks: LlmChunk[] = [];
    for await (const chunk of provider.generate(REQUEST, controller.signal)) {
      chunks.push(chunk);
      if (chunk.text) {
        controller.abort('cancelled');
      }
    }
    // Id запиту приходить ПЕРШИМ і переживає Stop — за ним журнал добере вартість (AI-5b)
    expect(chunks).toEqual([{ text: '', requestId: 'gen-1' }, { text: 'thinking…' }]);
    await vi.waitFor(() => {
      expect(closedConnections).toBe(1);
    });
  });

  it('abort ще до відповіді бекенду — тихе повернення без кадрів', async () => {
    handler = (): void => {
      // ніколи не відповідає
    };
    const controller = new AbortController();
    const running = collect(makeProvider().provider, controller.signal);
    await vi.waitFor(() => {
      expect(recorded).toHaveLength(1);
    });
    controller.abort('timeout');
    await expect(running).resolves.toEqual([]);
  });

  it('бекенд недосяжний (connection refused) — ретрай-придатна', async () => {
    const refused = new OpenAiCompatProvider({
      baseUrl: 'http://127.0.0.1:1/api/v1',
      apiKey: API_KEY,
      requestTimeoutMs: 2_000,
      logger: { log: vi.fn(), warn: vi.fn() },
    });
    const error = await failure(refused);
    expect(error.retryable).toBe(true);
  });

  it('ключ не потрапляє ні в лог, ні в повідомлення помилки', async () => {
    handler = (_req, res): void => {
      json(res, 401);
    };
    const { provider, logger } = makeProvider();
    const error = await failure(provider);

    const logged = JSON.stringify([...logger.log.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain(API_KEY);
    expect(error.message).not.toContain(API_KEY);
    // Лог старту — лише хост, без шляху
    expect(logger.log).toHaveBeenCalledWith('AI provider: openai-compat, host 127.0.0.1');
  });

  it('хост Anthropic — попередження на старті (§5.3), інші хости — ні', () => {
    const anthropic = makeProvider({ baseUrl: 'https://api.anthropic.com/v1/' });
    expect(anthropic.logger.warn).toHaveBeenCalledTimes(1);
    expect(String(anthropic.logger.warn.mock.calls[0]?.[0])).toMatch(/prompt caching/);

    const openrouter = makeProvider({ baseUrl: 'https://openrouter.ai/api/v1' });
    expect(openrouter.logger.warn).not.toHaveBeenCalled();
  });
});

describe('isAnthropicHost', () => {
  it.each([
    ['api.anthropic.com', true],
    ['anthropic.com', true],
    ['API.Anthropic.COM', true],
    ['openrouter.ai', false],
    ['notanthropic.com', false],
    ['anthropic.com.evil.example', false],
  ])('%s → %s', (host, expected) => {
    expect(isAnthropicHost(host)).toBe(expected);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');

  it('секунди, retry-after-ms з пріоритетом, HTTP-дата, сміття', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '3' }), now)).toBe(3_000);
    expect(parseRetryAfter(new Headers({ 'retry-after': '0.5' }), now)).toBe(500);
    expect(
      parseRetryAfter(new Headers({ 'retry-after': '3', 'retry-after-ms': '1500' }), now),
    ).toBe(1_500);
    expect(
      parseRetryAfter(new Headers({ 'retry-after': 'Sun, 27 Sep 2026 12:00:07 GMT' }), now),
    ).toBe(7_000);
    expect(parseRetryAfter(new Headers({ 'retry-after': 'soon' }), now)).toBeUndefined();
    expect(parseRetryAfter(new Headers(), now)).toBeUndefined();
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
  });
});

describe('decimalString (AI-5b)', () => {
  it.each([
    [0.00123, '0.00123'],
    [1e-7, '0.0000001'],
    [1.5e-10, '0.00000000015'],
    [0, '0'],
    [12, '12'],
    ['0.00000002', '0.00000002'],
    [' 3.5 ', '3.5'],
  ])('%s → %s', (input, expected) => {
    expect(decimalString(input)).toBe(expected);
  });

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY], ['1e-7'], ['abc'], [null], [{}]])(
    '%s → undefined',
    (input) => {
      expect(decimalString(input)).toBeUndefined();
    },
  );
});
