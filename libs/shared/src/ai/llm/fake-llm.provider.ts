import { Injectable } from '@nestjs/common';
import {
  LlmProviderError,
  type LlmChunk,
  type LlmProvider,
  type LlmRequest,
} from './llm-provider';

/**
 * Провайдер AI-0. Ключа не потребує, у мережу не ходить, поводиться детерміновано.
 *
 * Той самий прийом, що `PaymentProvider` → fake → Stripe у білінгу і фейковий
 * канальний адаптер у CHAT-2: увесь конвеєр (черга → воркер → сокет → UI → e2e)
 * стає перевіреним до того, як зʼявиться перший рахунок від вендора.
 *
 * Текст свідомо з Markdown-розміткою — він же перевіряє рендер у панелі.
 */
const CANNED_ANSWER = `## Here is what I found

You can manage this from the workspace settings. The short version:

1. Open **Settings → General**.
2. Change the field you need.
3. Save — the change applies to the whole workspace.

If you only want to change it for yourself, use \`User settings\` instead:

\`\`\`text
Avatar menu → User settings → Profile
\`\`\`

Anything else I can help with?`;

/** Директиви у тексті питання — єдиний спосіб дістатись важких гілок із тесту */
const DIRECTIVES = {
  /** Провайдер відмовляє РЕТРАЙ-ПРИДАТНОЮ помилкою на КОЖНІЙ спробі → вичерпання ретраїв,
   *  FAILED / PROVIDER_UNAVAILABLE (design.md D2) */
  fail: '__fail__',
  /** Провайдер мовчить назавжди → спрацьовує таймаут або скасування */
  stall: '__stall__',
  /** Довга відповідь → зручно ловити скасування і перевіряти коалесування */
  long: '__long__',
  /**
   * Провайдер відмовляє РЕТРАЙ-ПРИДАТНОЮ помилкою РІВНО ОДИН РАЗ для цього запиту,
   * потім відповідає нормально (AI-0.1, design.md D2). Стан — процес-локальний Set,
   * ключований останнім user-повідомленням запиту, тому кожен тест з унікальним
   * текстом питання отримує свій незалежний лічильник
   */
  failOnce: '__fail_once__',
  /** Провайдер відмовляє помилкою, яку РЕТРАЇТИ НЕ МАЄ СЕНСУ (design.md D2) —
   *  один виклик, і одразу FAILED */
  reject: '__reject__',
} as const;

interface FakeLlmOptions {
  /** Пауза між кадрами, мс. Дефолт імітує ~50 токенів/с */
  readonly chunkDelayMs?: number;
  /** Скільки символів віддавати за кадр */
  readonly chunkChars?: number;
}

@Injectable()
export class FakeLlmProvider implements LlmProvider {
  private readonly chunkDelayMs: number;
  private readonly chunkChars: number;
  // Ключ — весь запит, що ніс __fail_once__ (лишок питання): перший виклик кожного
  // такого запиту падає, наступні — ні. Процес-локально, тому лише для тестів
  // (design.md, Risks/Trade-offs)
  private readonly failedOnce = new Set<string>();

  constructor(options: FakeLlmOptions = {}) {
    this.chunkDelayMs = options.chunkDelayMs ?? 20;
    this.chunkChars = options.chunkChars ?? 8;
  }

  async *generate(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    const question = lastUserMessage(request);

    if (question.includes(DIRECTIVES.fail)) {
      throw new LlmProviderError('Fake provider was asked to fail', { retryable: true });
    }

    if (question.includes(DIRECTIVES.reject)) {
      throw new LlmProviderError('Fake provider rejected the request (non-retryable)', {
        retryable: false,
      });
    }

    if (question.includes(DIRECTIVES.failOnce)) {
      if (!this.failedOnce.has(question)) {
        this.failedOnce.add(question);
        throw new LlmProviderError('Fake provider failed once for this request', {
          retryable: true,
        });
      }
      // Друга (і кожна наступна) спроба того самого запиту — успіх, наче директиви
      // не було; далі логіка та сама, що для звичайного питання
    }

    if (question.includes(DIRECTIVES.stall)) {
      // Ніколи не віддає кадр: вихід лише через abort (таймаут або кнопка Stop)
      await waitForAbort(signal);
      return;
    }

    const answer = question.includes(DIRECTIVES.long)
      ? Array.from({ length: 12 }, () => CANNED_ANSWER).join('\n\n')
      : CANNED_ANSWER;

    for (let i = 0; i < answer.length; i += this.chunkChars) {
      // Пауза сама завершується на abort, тому ОДНІЄЇ перевірки після неї досить —
      // вона ловить і «перервали посеред стріму», і «abort стався ще до першого кадру».
      // Друга перевірка перед паузою була б не лише зайвою: TS звужує `aborted` до
      // false після першої, і наступна читається як завжди хибна
      await delay(this.chunkDelayMs, signal);
      if (signal.aborted) {
        return;
      }
      yield { text: answer.slice(i, i + this.chunkChars) };
    }

    // Синтетичний usage термінальним кадром (ai-1a, design.md D8) — та сама форма, що
    // в реального бекенду. Детермінований, ненульовий і пропорційний вводу: цього
    // досить, щоб облік і квоти (ai-1d) тестувались без ключа. На abort — не віддається,
    // як і в реального бекенду (вихід вище через `return`)
    yield {
      text: '',
      usage: {
        promptTokens: estimateTokens(request.messages.reduce((n, m) => n + m.content.length, 0)),
        completionTokens: estimateTokens(answer.length),
        model: request.model,
      },
    };
  }
}

/** ~4 символи на токен — груба, але стабільна оцінка для синтетичного usage */
function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

function lastUserMessage(request: LlmRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const message = request.messages[i];
    if (message?.role === 'user') {
      return message.content;
    }
  }
  return '';
}

/** Пауза, яка миттєво завершується на abort — інакше Stop чекав би кадр */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => { resolve(); }, { once: true });
  });
}

export const FAKE_LLM_DIRECTIVES = DIRECTIVES;
