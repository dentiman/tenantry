import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { ChatMessageListResponseDtoOutput } from '../../../api/generated/model/chatMessageListResponseDtoOutput';
import type { ChatMessageListResponseDtoOutputItemsItem as ChatMessage } from '../../../api/generated/model/chatMessageListResponseDtoOutputItemsItem';
import { transcriptKey } from '../chat-keys';
import { useChatOutboxStore } from '../stores/chat-outbox.store';

type TranscriptData = InfiniteData<ChatMessageListResponseDtoOutput, string | undefined>;

/**
 * Що сталося з повідомленням, яке прийшло (сокетом або відповіддю на POST):
 *  - `no-cache`  — стрічку цієї розмови ніхто не відкривав, патчити нічого: перший
 *    запит при відкритті вже віддасть рядок;
 *  - `ignored`   — такий `seq` у кеші вже є (дубль, відлуння власної відповіді або
 *    стрічка, перечитана раніше за подію);
 *  - `applied`   — це рівно наступний за найновішим `seq`: дописано у сторінку 0;
 *  - `resync`    — між кешем і повідомленням дірка: стрічка перечитується з сервера.
 */
export type MergeResult = 'no-cache' | 'ignored' | 'applied' | 'resync';

/**
 * Єдине правило, за яким збережене повідомлення потрапляє в кеш стрічки (docs/chat.md §4.3,
 * design.md D4). Його застосовують і міст сокета, і `onSuccess` надсилання — тому
 * надсилання підтверджується правильно навіть коли сокет лежить: якщо поки ми писали, інші
 * теж писали і сокет цього не доніс, дірка в `seq` сама відправить стрічку на перечитування.
 *
 * Правило трьох чисел, те саме, що в presence і сповіщень:
 *   `seq <= newest`      → дубль, ігноруємо;
 *   `seq === newest + 1` → наступне, застосовуємо;
 *   `seq >  newest + 1`  → загублені проміжні, перечитуємо.
 *
 * Дописуємо у сторінку 0, бо курсор сторінки — це її НАЙСТАРІШИЙ `seq`, він від нового
 * рядка не зсувається, тож `nextCursor` усіх сторінок лишається чинним.
 *
 * Оптимістичний рядок цього ж `clientMessageId` знімається в тому ж виклику: React
 * батчить обидва оновлення в один рендер, і «неготовий» та підтверджений рядки ніколи не
 * стоять поруч. Виняток — `resync` і `no-cache`: повідомлення в кеші ще немає, і прибрати
 * рядок означало б сховати репліку до приходу перечитаної стрічки, тому він знімається,
 * коли перечитування відпрацювало (до того часу рядок не дублюється — `buildRows`
 * прибирає з вихідних ті, що вже є в стрічці).
 */
export function mergeIncomingMessage(
  queryClient: QueryClient,
  conversationId: string,
  message: ChatMessage,
): MergeResult {
  const key = transcriptKey(conversationId);
  const settleOutbox = (): void => {
    if (message.clientMessageId) {
      useChatOutboxStore.getState().resolve(conversationId, message.clientMessageId);
    }
  };

  const cached = queryClient.getQueryData<TranscriptData>(key);
  const first = cached?.pages[0];
  const newest = first?.items[0]?.seq;

  if (!cached || !first || newest === undefined || message.seq > newest + 1) {
    // Кеша немає, він порожній або в ньому дірка: стрічку віддасть сервер. Інвалідація
    // неіснуючого запиту — no-op, а запит, що саме вантажиться, перечитається, щоб не
    // розминутись із рядком, який закомітили вже ПІСЛЯ його SELECT-а
    void queryClient.invalidateQueries({ queryKey: key }).then(settleOutbox);
    return first && newest !== undefined ? 'resync' : 'no-cache';
  }

  if (message.seq <= newest) {
    settleOutbox();
    return 'ignored';
  }

  queryClient.setQueryData<TranscriptData>(key, {
    ...cached,
    pages: [{ ...first, items: [message, ...first.items] }, ...cached.pages.slice(1)],
  });
  settleOutbox();
  return 'applied';
}
