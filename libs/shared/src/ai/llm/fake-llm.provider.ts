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
  /** Провайдер відмовляє → FAILED / PROVIDER_UNAVAILABLE */
  fail: '__fail__',
  /** Провайдер мовчить назавжди → спрацьовує таймаут або скасування */
  stall: '__stall__',
  /** Довга відповідь → зручно ловити скасування і перевіряти коалесування */
  long: '__long__',
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

  constructor(options: FakeLlmOptions = {}) {
    this.chunkDelayMs = options.chunkDelayMs ?? 20;
    this.chunkChars = options.chunkChars ?? 8;
  }

  async *generate(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    const question = lastUserMessage(request);

    if (question.includes(DIRECTIVES.fail)) {
      throw new LlmProviderError('Fake provider was asked to fail');
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
  }
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
