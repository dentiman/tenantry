import type { QueryClient } from '@tanstack/react-query';
import {
  REALTIME_EVENTS,
  type AiConversationResponse,
  type AiMessageCompleted,
  type AiMessageDelta,
} from '@saas-skeleton/contracts';
import { getAiConversationQueryKey } from '../../../api/generated/api';
import { getSocket, type AppSocket } from '../../realtime/socket';
import { invalidateAiHistory } from '../ai-queries';

/**
 * Міст socket → TanStack Query для асистента (AI-0.1, design.md D6/D7, фікс §6.3).
 *
 * Тут єдиний у застосунку випадок, коли дельта несе САМ ВМІСТ, а не сигнал
 * «перечитай» (docs/realtime.md, правило 2). Виняток тримається на парі
 * `(attempt, chunkSeq)` — позиція читається з КЕШОВАНОГО повідомлення
 * (`message.attempt`, `message.chunkCount`), а не з окремого модульного стану:
 *
 * - `attempt` нижчий за кешований — дельта застарілої спроби, відкидається;
 * - `attempt` вищий, `chunkSeq === 0` — ПЕРЕЗАПУСК: контент заміняється, буфер
 *   старої спроби відкидається;
 * - `attempt` вищий, `chunkSeq > 0`, або `chunkSeq` не збігається з
 *   `chunkCount` у межах ТІЄЇ Ж спроби — дельта прийшла ПОПЕРЕД тим, на чому
 *   зупинився кеш: буферизується і йде перечитування; коли воно приземляється,
 *   суміжні буферизовані кадри застосовуються БЕЗ другого перечитування.
 *
 * Втрата дельти сповільнює рендер, але нічого не втрачає — джерелом правди
 * лишається БД. `ai.conversation-changed.v1` (без даних) — сигнал для ІНШИХ
 * вкладок того самого юзера: перше питання ходу й `reset()` дельти взагалі не
 * мають, і без цієї події сусідня вкладка дізналась би про них лише на
 * наступному власному запиті.
 */

type CachedMessage = AiConversationResponse['messages'][number];

export function initAiSync(queryClient: QueryClient, socket: AppSocket = getSocket()): void {
  const queryKey = getAiConversationQueryKey();
  // Кадри, що прийшли ПОПЕРЕД тим, на чому зупинився кеш — за messageId.
  // Живуть до наступного успішного перечитування (тоді дренуються) або до
  // completed/reconnect/вищого attempt (тоді відкидаються як застарілі)
  const buffers = new Map<string, AiMessageDelta[]>();

  const getCachedMessage = (messageId: string): CachedMessage | undefined =>
    queryClient.getQueryData<AiConversationResponse>(queryKey)?.messages.find(
      (message) => message.id === messageId,
    );

  const applyFrame = (
    messageId: string,
    frame: { attempt: number; chunkSeq: number; text: string },
    replace: boolean,
  ): void => {
    queryClient.setQueryData<AiConversationResponse>(queryKey, (current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        messages: current.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                status: 'STREAMING',
                attempt: frame.attempt,
                chunkCount: frame.chunkSeq + 1,
                content: replace ? frame.text : message.content + frame.text,
              }
            : message,
        ),
      };
    });
  };

  const bufferFrame = (payload: AiMessageDelta): void => {
    const list = buffers.get(payload.messageId);
    if (list) {
      list.push(payload);
    } else {
      buffers.set(payload.messageId, [payload]);
    }
  };

  /**
   * Застосовує суміжні буферизовані кадри ЧИННОЇ спроби, починаючи з поточного
   * `chunkCount` кешованого повідомлення. Викликається після кожного успішного
   * перечитування — саме це дає «одне перечитування, а не друге» (design.md D6).
   */
  const drain = (messageId: string): void => {
    const buffered = buffers.get(messageId);
    if (!buffered || buffered.length === 0) {
      return;
    }
    const message = getCachedMessage(messageId);
    if (!message) {
      return;
    }

    // Кадри чужої (старішої за щойно прочитану) спроби більше нікому не знадобляться
    let pool = buffered.filter((frame) => frame.attempt === message.attempt);
    let chunkCount = message.chunkCount;
    for (;;) {
      const index = pool.findIndex((frame) => frame.chunkSeq === chunkCount);
      if (index === -1) {
        break;
      }
      const frame = pool[index];
      pool = pool.filter((_, i) => i !== index);
      if (frame) {
        applyFrame(messageId, frame, false);
        chunkCount += 1;
      }
    }

    if (pool.length > 0) {
      buffers.set(messageId, pool);
    } else {
      buffers.delete(messageId);
    }
  };

  const invalidate = (): void => {
    void queryClient
      .invalidateQueries({ queryKey, refetchType: 'active' })
      .then(() => {
        // Дренаж УСІХ повідомлень з буфером — саме тут (а не одразу при
        // буферизації) стає відомо, наскільки посунувся кеш
        for (const messageId of [...buffers.keys()]) {
          drain(messageId);
        }
      })
      .catch(() => undefined);
  };

  socket.on(REALTIME_EVENTS.aiMessageDelta, (payload: AiMessageDelta) => {
    const message = getCachedMessage(payload.messageId);
    if (!message) {
      // Панель ще не читала стрічку — патчити нічого; буферизуємо на випадок,
      // якщо перечитування застане саме цей кадр актуальним
      bufferFrame(payload);
      invalidate();
      return;
    }

    if (payload.attempt < message.attempt) {
      return; // застаріла спроба — клієнт її вже пережив
    }

    if (payload.attempt > message.attempt) {
      if (payload.chunkSeq === 0) {
        // ПЕРЕЗАПУСК: попередня спроба й усе, що від неї буферизовано, більше не рахуються
        buffers.delete(payload.messageId);
        applyFrame(payload.messageId, payload, true);
      } else {
        bufferFrame(payload);
        invalidate();
      }
      return;
    }

    // payload.attempt === message.attempt
    if (payload.chunkSeq < message.chunkCount) {
      return; // вже входить у content
    }
    if (payload.chunkSeq === message.chunkCount) {
      applyFrame(payload.messageId, payload, false);
      drain(payload.messageId); // одразу підхопити те, що вже чекало своєї черги
      return;
    }
    // chunkSeq > chunkCount: дірка — не вгадуємо, буферизуємо й перечитуємо
    bufferFrame(payload);
    invalidate();
  });

  socket.on(REALTIME_EVENTS.aiMessageCompleted, (payload: AiMessageCompleted) => {
    buffers.delete(payload.messageId);
    // Подія прийшла ПІСЛЯ комміту, тому перечитування гарантовано дає фінальний
    // текст. Патчити статус локально не варто: у відповіді ще й usage та
    // completedAt, і другий доступ до правди — це другий шанс розійтися з нею
    invalidate();
  });

  // Сигнал без даних (design.md D7): перше питання ходу і reset() дельти не
  // мають узагалі — без цієї події сусідня вкладка того самого юзера дізналась
  // би про них лише на власному наступному запиті
  //
  // Історія (сторінка асистента) — теж тут: нове питання змінює порядок і заголовок
  // списку, reset/активація — статус, видалення — сам список. Дельти й завершення
  // історії не змінюють, тому на них вона не перечитується
  socket.on(REALTIME_EVENTS.aiConversationChanged, () => {
    invalidate();
    void invalidateAiHistory(queryClient);
  });

  socket.on('connect', () => {
    // `recovered` = Socket.IO дочитав пропущені пакети сесії. Якщо ні — невідомо,
    // що сталось за час розриву, і накопиченому тексту (та буферу) довіряти не можна
    if (!socket.recovered) {
      buffers.clear();
      invalidate();
    }
  });
}
