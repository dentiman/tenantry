import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, FAKE_LLM_DIRECTIVES } from './fake-llm.provider';
import { LlmProviderError, type LlmRequest, type LlmUsage } from './llm-provider';

const provider = new FakeLlmProvider({ chunkDelayMs: 0, chunkChars: 16 });

function requestFor(question: string): LlmRequest {
  return { messages: [{ role: 'user', content: question }], model: 'fake-1', maxOutputTokens: 256 };
}

async function collect(question: string, signal: AbortSignal): Promise<string> {
  let text = '';
  for await (const chunk of provider.generate(requestFor(question), signal)) {
    text += chunk.text;
  }
  return text;
}

describe('FakeLlmProvider', () => {
  it('стрімить канований Markdown кількома кадрами', async () => {
    const chunks: string[] = [];
    for await (const chunk of provider.generate(requestFor('how do I rename the workspace?'), new AbortController().signal)) {
      chunks.push(chunk.text);
    }

    expect(chunks.length).toBeGreaterThan(1);
    const answer = chunks.join('');
    // Розмітка тут не косметика — саме вона перевіряє рендер у панелі
    expect(answer).toContain('## ');
    expect(answer).toContain('```');
    expect(answer).toContain('**Settings → General**');
  });

  it(`${FAKE_LLM_DIRECTIVES.fail} кидає LlmProviderError, а не звичайний Error`, async () => {
    await expect(collect(`please ${FAKE_LLM_DIRECTIVES.fail}`, new AbortController().signal))
      .rejects.toBeInstanceOf(LlmProviderError);
  });

  it(`${FAKE_LLM_DIRECTIVES.fail} — помилка РЕТРАЙ-ПРИДАТНА (design.md D2)`, async () => {
    try {
      await collect(`please retry me ${FAKE_LLM_DIRECTIVES.fail}`, new AbortController().signal);
      expect.unreachable('має кинути');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmProviderError);
      expect((error as LlmProviderError).retryable).toBe(true);
    }
  });

  it(`${FAKE_LLM_DIRECTIVES.reject} кидає НЕ-ретрай-придатну помилку одразу, без стріму`, async () => {
    try {
      await collect(`please ${FAKE_LLM_DIRECTIVES.reject}`, new AbortController().signal);
      expect.unreachable('має кинути');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmProviderError);
      expect((error as LlmProviderError).retryable).toBe(false);
    }
  });

  it(`${FAKE_LLM_DIRECTIVES.failOnce} падає ПЕРШИЙ раз для запиту й успішно генерує ДРУГИЙ`, async () => {
    const question = `unique question one ${FAKE_LLM_DIRECTIVES.failOnce}`;

    await expect(collect(question, new AbortController().signal)).rejects.toBeInstanceOf(
      LlmProviderError,
    );
    const answer = await collect(question, new AbortController().signal);
    expect(answer).toContain('## ');
  });

  it(`${FAKE_LLM_DIRECTIVES.failOnce} лічильник незалежний для КОЖНОГО тексту питання`, async () => {
    const questionA = `unique question two ${FAKE_LLM_DIRECTIVES.failOnce}`;
    const questionB = `unique question three ${FAKE_LLM_DIRECTIVES.failOnce}`;

    await expect(collect(questionA, new AbortController().signal)).rejects.toBeInstanceOf(
      LlmProviderError,
    );
    // Інший текст питання — свій незалежний лічильник, теж падає перший раз
    await expect(collect(questionB, new AbortController().signal)).rejects.toBeInstanceOf(
      LlmProviderError,
    );
  });

  it(`${FAKE_LLM_DIRECTIVES.stall} не віддає жодного кадру, поки не abort`, async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = collect(`please ${FAKE_LLM_DIRECTIVES.stall}`, controller.signal);

    // Нічого не прилетіло; вихід лише через abort (таймаут або кнопка Stop)
    setTimeout(() => { controller.abort(); }, 20);

    await expect(pending).resolves.toBe('');
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it(`${FAKE_LLM_DIRECTIVES.long} дає помітно довшу відповідь`, async () => {
    const short = await collect('short one', new AbortController().signal);
    const long = await collect(`${FAKE_LLM_DIRECTIVES.long} please`, new AbortController().signal);
    expect(long.length).toBeGreaterThan(short.length * 5);
  });

  it('abort посеред стріму зупиняє ітерацію і не віддає зайвого кадру', async () => {
    const controller = new AbortController();
    const slow = new FakeLlmProvider({ chunkDelayMs: 5, chunkChars: 4 });

    const received: string[] = [];
    for await (const chunk of slow.generate(requestFor(`${FAKE_LLM_DIRECTIVES.long} go`), controller.signal)) {
      received.push(chunk.text);
      if (received.length === 3) {
        controller.abort();
      }
    }

    expect(received).toHaveLength(3);
  });

  it('abort ДО першого кадру не віддає нічого', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collect('anything', controller.signal)).resolves.toBe('');
  });

  it('віддає синтетичний usage РІВНО ОДНИМ термінальним кадром (ai-1a, design.md D8)', async () => {
    const chunks = [];
    for await (const chunk of provider.generate(requestFor('usage please'), new AbortController().signal)) {
      chunks.push(chunk);
    }
    const withUsage = chunks.filter((chunk) => chunk.usage !== undefined);
    expect(withUsage).toHaveLength(1);
    const last = chunks.at(-1);
    expect(last?.text).toBe('');
    expect(last?.usage?.model).toBe('fake-1');
    expect(last?.usage?.promptTokens).toBeGreaterThan(0);
    expect(last?.usage?.completionTokens).toBeGreaterThan(0);
  });

  it('usage детермінований і росте з довжиною вводу та відповіді', async () => {
    async function usageFor(question: string): Promise<LlmUsage | undefined> {
      let usage: LlmUsage | undefined;
      for await (const chunk of provider.generate(requestFor(question), new AbortController().signal)) {
        usage = chunk.usage ?? usage;
      }
      return usage;
    }
    const short = await usageFor('short');
    expect(await usageFor('short')).toEqual(short);
    const longer = await usageFor(`${'much longer question '.repeat(20)} ${FAKE_LLM_DIRECTIVES.long}`);
    expect(longer?.promptTokens).toBeGreaterThan(short?.promptTokens ?? 0);
    expect(longer?.completionTokens).toBeGreaterThan(short?.completionTokens ?? 0);
  });

  it('на abort usage не віддається, як і в реального бекенду', async () => {
    const controller = new AbortController();
    const slow = new FakeLlmProvider({ chunkDelayMs: 5, chunkChars: 4 });
    const chunks = [];
    for await (const chunk of slow.generate(requestFor('stop me midway'), controller.signal)) {
      chunks.push(chunk);
      if (chunks.length === 2) {
        controller.abort();
      }
    }
    expect(chunks.some((chunk) => chunk.usage !== undefined)).toBe(false);
  });
});
