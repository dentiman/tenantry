import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { REALTIME_EVENTS, type AiConversationResponse } from '@saas-skeleton/contracts';
import { getAiConversationQueryKey } from '../../../api/generated/api';
import { initAiSync } from './ai-sync';
import type { AppSocket } from '../../realtime/socket';

/**
 * Таблиця дельта-vs-кеш із design.md D6 (AI-0.1) — кожен рядок тут окремий тест.
 * `invalidateQueries` підмінюється так, щоб симулювати «сервер віддав ЩОСЬ»:
 * реальної мережі в юніт-тесті немає, тож САМЕ мок вирішує, що прилітає з
 * перечитування, а `.then()` усередині `initAiSync` вже сам дренує буфер.
 */

const CONVERSATION = 'conv-1';
const MESSAGE = 'msg-1';

/** Мінімальний фейковий сокет: зберігає обробники по імені події й дає їх викликати */
function createFakeSocket(): {
  socket: AppSocket;
  fire: (event: string, payload?: unknown) => void;
  setRecovered: (v: boolean) => void;
} {
  const handlers = new Map<string, ((payload: unknown) => void)[]>();
  const socket = {
    on: (event: string, handler: (payload: unknown) => void): AppSocket => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return socket as unknown as AppSocket;
    },
    recovered: false,
  };
  return {
    socket: socket as unknown as AppSocket,
    fire: (event, payload) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(payload);
      }
    },
    setRecovered: (v: boolean) => {
      socket.recovered = v;
    },
  };
}

function makeMessage(overrides: Partial<AiConversationResponse['messages'][number]> = {}) {
  return {
    id: MESSAGE,
    seq: 1,
    role: 'ASSISTANT' as const,
    status: 'STREAMING' as const,
    content: '',
    errorCode: null,
    attempt: 1,
    chunkCount: 0,
    citations: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

function makeConversation(
  messages: AiConversationResponse['messages'] = [],
): AiConversationResponse {
  return {
    id: CONVERSATION,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastMessageAt: null,
    messages,
  };
}

function delta(overrides: { attempt: number; chunkSeq: number; text: string; messageId?: string }) {
  return {
    conversationId: CONVERSATION,
    messageId: overrides.messageId ?? MESSAGE,
    attempt: overrides.attempt,
    chunkSeq: overrides.chunkSeq,
    text: overrides.text,
  };
}

describe('initAiSync', () => {
  let queryClient: QueryClient;
  const queryKey = getAiConversationQueryKey();

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  function getMessage(): AiConversationResponse['messages'][number] | undefined {
    return queryClient
      .getQueryData<AiConversationResponse>(queryKey)
      ?.messages.find((m) => m.id === MESSAGE);
  }

  it('повідомлення відсутнє в кеші: дельта буферизується (не падає), запитується перечитування', () => {
    // Кеш порожній — панель ще ЖОДНОГО разу не читала стрічку
    const { socket, fire } = createFakeSocket();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    fire(
      REALTIME_EVENTS.aiMessageDelta,
      delta({ attempt: 1, chunkSeq: 0, text: 'first ever chunk' }),
    );

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(getMessage()).toBeUndefined(); // патчити нічого — кеш ще порожній
  });

  it('нижчий attempt відкидається мовчки — без перечитування, кеш не змінюється', () => {
    queryClient.setQueryData(
      queryKey,
      makeConversation([makeMessage({ attempt: 2, content: 'kept' })]),
    );
    const { socket, fire } = createFakeSocket();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 1, chunkSeq: 0, text: 'stale' }));

    expect(getMessage()?.content).toBe('kept');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('вищий attempt, chunkSeq === 0: контент заміняється, attempt і chunkCount приймаються', () => {
    queryClient.setQueryData(
      queryKey,
      makeConversation([
        makeMessage({ attempt: 1, content: 'OLD ATTEMPT LEFTOVER', chunkCount: 9 }),
      ]),
    );
    const { socket, fire } = createFakeSocket();
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 2, chunkSeq: 0, text: 'fresh start' }));

    const message = getMessage();
    expect(message?.content).toBe('fresh start');
    expect(message?.attempt).toBe(2);
    expect(message?.chunkCount).toBe(1);
    expect(message?.status).toBe('STREAMING');
  });

  it('вищий attempt, chunkSeq > 0: буферизується, запитується перечитування, кеш поки не зачіпається', () => {
    queryClient.setQueryData(
      queryKey,
      makeConversation([makeMessage({ attempt: 1, content: 'old' })]),
    );
    const { socket, fire } = createFakeSocket();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 2, chunkSeq: 3, text: 'mid-attempt' }));

    expect(getMessage()?.content).toBe('old'); // не застосовано напряму
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('той самий attempt, chunkSeq < chunkCount: дельта вже врахована — відкидається', () => {
    queryClient.setQueryData(
      queryKey,
      makeConversation([makeMessage({ attempt: 1, content: 'ABC', chunkCount: 3 })]),
    );
    const { socket, fire } = createFakeSocket();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 1, chunkSeq: 1, text: 'duplicate' }));

    expect(getMessage()?.content).toBe('ABC');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('той самий attempt, chunkSeq === chunkCount: дописується без перечитування', () => {
    queryClient.setQueryData(
      queryKey,
      makeConversation([makeMessage({ attempt: 1, content: 'AB', chunkCount: 2 })]),
    );
    const { socket, fire } = createFakeSocket();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 1, chunkSeq: 2, text: 'C' }));

    expect(getMessage()?.content).toBe('ABC');
    expect(getMessage()?.chunkCount).toBe(3);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('той самий attempt, chunkSeq > chunkCount (дірка): буферизується, запитується перечитування', () => {
    queryClient.setQueryData(
      queryKey,
      makeConversation([makeMessage({ attempt: 1, content: '', chunkCount: 0 })]),
    );
    const { socket, fire } = createFakeSocket();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 1, chunkSeq: 2, text: 'C' }));

    expect(getMessage()?.content).toBe(''); // дірка — не вгадуємо
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('буферизовані суміжні кадри застосовуються одразу після того, як дірку закрито живою дельтою', () => {
    queryClient.setQueryData(
      queryKey,
      makeConversation([makeMessage({ attempt: 1, content: '', chunkCount: 0 })]),
    );
    const { socket, fire } = createFakeSocket();
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    // Кадр 2 приходить ПЕРШИМ (дірка: бракує кадру 1) — буферизується
    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 1, chunkSeq: 2, text: 'C' }));
    expect(getMessage()?.content).toBe('');

    // Кадр 0 закриває найперший розрив
    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 1, chunkSeq: 0, text: 'A' }));
    expect(getMessage()?.content).toBe('A');
    expect(getMessage()?.chunkCount).toBe(1);

    // Кадр 1 закриває дірку — і одразу підхоплює буферизований кадр 2 БЕЗ перечитування
    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 1, chunkSeq: 1, text: 'B' }));

    expect(getMessage()?.content).toBe('ABC');
    expect(getMessage()?.chunkCount).toBe(3);
  });

  it('перечитування, що відстає від живих кадрів: буферизовані кадри закривають розрив БЕЗ другого перечитування', async () => {
    queryClient.setQueryData(
      queryKey,
      makeConversation([makeMessage({ attempt: 1, content: 'A', chunkCount: 1 })]),
    );
    const { socket, fire } = createFakeSocket();
    // Симулюємо СЕРВЕР, що відстає: снапшот повертає той самий chunkCount=1,
    // хоча клієнт уже отримав живий кадр 2 (design.md D6 — партіал-персист лагає)
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(async () => {
        queryClient.setQueryData(
          queryKey,
          makeConversation([makeMessage({ attempt: 1, content: 'A', chunkCount: 1 })]),
        );
        return Promise.resolve();
      });
    initAiSync(queryClient, socket);

    // Дірка: бракує кадру 1, кадр 2 буферизується й запускає (лагаюче) перечитування
    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 1, chunkSeq: 2, text: 'C' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(getMessage()?.content).toBe('A'); // перечитування ще не заповнило дірку

    // Кадр 1 приходить ЖИВИМ (не через ще одне перечитування) і закриває дірку —
    // буферизований кадр 2 підхоплюється одразу тим самим дренажем
    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 1, chunkSeq: 1, text: 'B' }));

    expect(getMessage()?.content).toBe('ABC');
    expect(getMessage()?.chunkCount).toBe(3);
    // Жодного ДРУГОГО перечитування не знадобилось
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('ai.message-completed.v1: чистить буфер конкретного повідомлення й перечитує', () => {
    queryClient.setQueryData(
      queryKey,
      makeConversation([makeMessage({ attempt: 1, content: '', chunkCount: 0 })]),
    );
    const { socket, fire } = createFakeSocket();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    // Буферизуємо дірку
    fire(REALTIME_EVENTS.aiMessageDelta, delta({ attempt: 1, chunkSeq: 2, text: 'C' }));
    invalidateSpy.mockClear();

    fire(REALTIME_EVENTS.aiMessageCompleted, {
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      status: 'COMPLETE',
      errorCode: null,
      occurredAt: '2026-01-01T00:00:01.000Z',
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('ai.conversation-changed.v1: перечитує стрічку й історію (сигнал без даних, design.md D7)', () => {
    const { socket, fire } = createFakeSocket();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    fire(REALTIME_EVENTS.aiConversationChanged, {
      conversationId: CONVERSATION,
      reason: 'turn-created',
      occurredAt: '2026-01-01T00:00:00.000Z',
    });

    // Поточна розмова + префікс історії (`/api/ai/conversations…`)
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it('reconnect БЕЗ recovered: чистить буфер і перечитує', () => {
    const { socket, fire, setRecovered } = createFakeSocket();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    setRecovered(false);
    fire('connect');

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('reconnect З recovered: нічого не перечитує — сесія відновлена, дельти не загублені', () => {
    const { socket, fire, setRecovered } = createFakeSocket();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    initAiSync(queryClient, socket);

    setRecovered(true);
    fire('connect');

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
