import type { QueryClient } from '@tanstack/react-query';
import {
  REALTIME_EVENTS,
  type AiConversationResponse,
  type AiMessageCompleted,
  type AiMessageDelta,
} from '@saas-skeleton/contracts';
import { getAiConversationQueryKey } from '../api/generated/api';
import { getSocket } from './socket';

/**
 * Міст socket → TanStack Query для асистента.
 *
 * Тут єдиний у застосунку випадок, коли дельта несе САМ ВМІСТ, а не сигнал
 * «перечитай» (docs/realtime.md, правило 2). Виняток тримається на `chunkSeq`:
 *
 * - чанки конкатенуються СТРОГО по порядку; дірка означає, що дельту загублено,
 *   і тоді ми не вгадуємо — інвалідуємо запит, а текст приїжджає з Postgres;
 * - `chunkSeq === 0` для відповіді, у якій уже є текст, означає ПЕРЕЗАПУСК
 *   генерації (автоматичний ретрай після тимчасової відмови провайдера):
 *   накопичене викидається, інакше дві спроби склеїлись би в одну відповідь.
 *
 * Тобто втрата дельти сповільнює рендер, але нічого не втрачає — джерелом
 * правди лишається БД.
 */

/** Наступний очікуваний `chunkSeq` для кожної відповіді в роботі */
const expectedChunk = new Map<string, number>();

export function initAiSync(queryClient: QueryClient): void {
  const socket = getSocket();
  const queryKey = getAiConversationQueryKey();

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey });
  };

  socket.on(REALTIME_EVENTS.aiMessageDelta, (payload: AiMessageDelta) => {
    const cached = queryClient.getQueryData<AiConversationResponse>(queryKey);
    // Панель ще не читала стрічку — патчити нічого; коли прочитає, візьме все з БД
    if (cached?.id !== payload.conversationId) {
      return;
    }

    const isRestart = payload.chunkSeq === 0;
    const expected = expectedChunk.get(payload.messageId) ?? 0;
    if (!isRestart && payload.chunkSeq !== expected) {
      // Дірка: далі патчити не можна — склеїли б текст із пропуском
      expectedChunk.delete(payload.messageId);
      invalidate();
      return;
    }
    expectedChunk.set(payload.messageId, payload.chunkSeq + 1);

    queryClient.setQueryData<AiConversationResponse>(queryKey, (current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        messages: current.messages.map((message) =>
          message.id === payload.messageId
            ? {
                ...message,
                status: 'STREAMING',
                content: isRestart ? payload.text : message.content + payload.text,
              }
            : message,
        ),
      };
    });
  });

  socket.on(REALTIME_EVENTS.aiMessageCompleted, (payload: AiMessageCompleted) => {
    expectedChunk.delete(payload.messageId);
    // Подія прийшла ПІСЛЯ комміту, тому перечитування гарантовано дає фінальний
    // текст. Патчити статус локально не варто: у відповіді ще й usage та
    // completedAt, і другий доступ до правди — це другий шанс розійтися з нею
    invalidate();
  });

  socket.on('connect', () => {
    // `recovered` = Socket.IO дочитав пропущені пакети сесії. Якщо ні — невідомо,
    // що сталось за час розриву, і накопиченому тексту довіряти не можна
    if (!socket.recovered) {
      expectedChunk.clear();
      invalidate();
    }
  });
}
