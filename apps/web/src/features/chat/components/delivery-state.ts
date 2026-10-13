import type { ChatMessage } from './use-chat';

/** Як стан доставки малюється в бульбашці: годинник, одна галочка, дві, дві акцентні, помилка */
export type DeliveryIcon = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Іконка за станом вихідного повідомлення (CHAT-2b). Чиста функція — перевіряється без DOM */
export function deliveryIcon(status: ChatMessage['status']): DeliveryIcon {
  switch (status) {
    case 'QUEUED':
    case 'SENDING':
      return 'pending';
    case 'SENT':
      return 'sent';
    case 'DELIVERED':
      return 'delivered';
    case 'READ':
      return 'read';
    case 'FAILED':
      return 'failed';
  }
}

/** Вихідне клієнтові — це те, що йшло (або йде) провайдеру; нотатки й внутрішні реплік сюди не належать */
export function isDeliverable(message: Pick<ChatMessage, 'direction' | 'visibility'>): boolean {
  return message.direction === 'OUTBOUND' && message.visibility === 'PUBLIC';
}

/**
 * Ключ тексту причини відмови (`chat:failure.*`). Конкретний випадок «не вдалося підтвердити» має
 * свій текст; решта — за класом. Сирий заголовок провайдера лише запасний варіант на екрані, а не
 * єдине пояснення (design.md D13).
 */
export function failureKey(failure: NonNullable<ChatMessage['failure']>): string {
  if (failure.unconfirmed === true) {
    return 'failure.unconfirmed';
  }
  return `failure.${failure.class}`;
}

/**
 * Чи пропонувати «надіслати ще раз»: лише для невдалого вихідного, і не коли вікно закрите —
 * вікно відкриє лише нове повідомлення клієнта (шаблони — CHAT-3b), повтор одразу вийшов би 422.
 */
export function canResend(message: ChatMessage): boolean {
  return (
    isDeliverable(message) &&
    message.status === 'FAILED' &&
    message.failure?.class !== 'WINDOW_CLOSED'
  );
}

export type ComposerMode = 'reply' | 'note';

/**
 * Який режим композера діє: відповідь клієнтові можлива, лише поки вікно відкрите; нотатка — завжди.
 * Внутрішня розмова режимів не має — там завжди звичайна репліка.
 */
export function effectiveMode(requested: ComposerMode, canReply: boolean): ComposerMode {
  return canReply ? requested : 'note';
}
