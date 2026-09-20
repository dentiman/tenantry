import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, FAKE_LLM_DIRECTIVES } from './fake-llm.provider';
import { LlmProviderError, type LlmRequest } from './llm-provider';

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
});
