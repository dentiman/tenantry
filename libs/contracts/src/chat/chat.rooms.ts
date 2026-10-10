/**
 * Room розмови: хто ЗАРАЗ ДИВИТЬСЯ на неї (docs/chat.md §4.8.2). Ім'я формує і api, і —
 * з CHAT-0.2c — воркер (питає, хто глядить, перш ніж писати сповіщення), тому формула живе
 * в контрактах, а не в одному з двох процесів: розійшовшись, вони мовчки перестали б
 * бачити одне одного.
 *
 * Це НЕ канал доставки повідомлень: `chat.message-created.v1` іде в особисті room-и (0.2a).
 * У room розмови — лише typing і відповідь на питання «хто глядить».
 */
export function conversationRoom(tenantId: string, conversationId: string): string {
  return `tenant:${tenantId}:conversation:${conversationId}`;
}

/** Префікс room-ів розмов одного тенанта — для підрахунку підписок сокета */
export function conversationRoomPrefix(tenantId: string): string {
  return `tenant:${tenantId}:conversation:`;
}

/**
 * Стеля одночасно «переглядуваних» розмов на ОДИН сокет. Звичайний клієнт тримає одну; межа
 * тут — захист від зловживання (тисячі приєднань на одному зʼєднанні роздули б памʼять
 * ноди), а не функція.
 */
export const CHAT_MAX_VIEWED_CONVERSATIONS = 5;

/** Скільки сервер велить клієнту показувати індикатор набору без поновлення */
export const CHAT_TYPING_TTL_MS = 6_000;

/**
 * Як часто клієнт поновлює сигнал, поки людина друкує. Менше за TTL: безперервний набір
 * тоді не блимає (кожен імпульс продовжує термін раніше, ніж він мине).
 */
export const CHAT_TYPING_PULSE_MS = 3_000;
