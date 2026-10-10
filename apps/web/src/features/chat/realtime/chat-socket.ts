import {
  CLIENT_EVENTS,
  type ClientEventAck,
  type ClientEventErrorCode,
} from '@saas-skeleton/contracts';
import { getSocket, type AppSocket } from '../../realtime/socket';

/** Скільки чекати на відповідь сервера, перш ніж вважати подію втраченою */
export const ACK_TIMEOUT_MS = 5_000;

/** Сокет, яким користується чат: лише те, що потрібно ack-хелперу (зручно підміняти в тестах) */
type AckSocket = Pick<AppSocket, 'connected'> & {
  timeout: (ms: number) => { emitWithAck: (event: string, payload: unknown) => Promise<unknown> };
};

const FAILED: ClientEventAck<never> = { ok: false, code: 'INTERNAL' };

function isAck(value: unknown): value is ClientEventAck<unknown> {
  if (typeof value !== 'object' || value === null || !('ok' in value)) {
    return false;
  }
  return (
    value.ok === true || (value.ok === false && 'code' in value && typeof value.code === 'string')
  );
}

/**
 * Подія client → server з відповіддю (docs/chat.md §4.8.2). Повертає конверт відповіді,
 * а НЕ кидає: усе, що робить чат через сокет, — прискорення або ефемерна дрібниця, і
 * відмова чи таймаут не повинні ламати екран чи показувати помилку.
 *
 * Не підключений сокет відсікається одразу. Socket.IO інакше буферизував би подію до
 * наступного підключення, і вона долетіла б із запізненням — уже після того, як клієнт
 * сам перепідписався на `connect`.
 */
export async function emitChatEvent(
  event: (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS],
  payload: unknown,
  socket: AckSocket = getSocket() as unknown as AckSocket,
): Promise<ClientEventAck<unknown>> {
  if (!socket.connected) {
    return FAILED;
  }
  try {
    const result = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload);
    return isAck(result) ? result : FAILED;
  } catch {
    // Таймаут: відповіді не було — для клієнта це та сама відмова
    return FAILED;
  }
}

export type { ClientEventErrorCode };

/**
 * Рух курсора прочитаного: через сокет, а за його відсутності чи відмови — запасним REST.
 *
 * Обидва шляхи рухають курсор лише вперед і ідемпотентні, тож «таймаут, потім REST» нічого
 * не подвоює: найгірше — другий запит нічого не змінить. `fallback` передається, а не
 * імпортується, щоб правило «сокет, інакше REST» перевірялось тестом без мережі.
 */
export async function reportRead(
  conversationId: string,
  seq: number,
  fallback: (seq: number) => void,
  socket?: AckSocket,
): Promise<void> {
  const ack = await emitChatEvent(CLIENT_EVENTS.chatRead, { conversationId, seq }, socket);
  if (!ack.ok) {
    fallback(seq);
  }
}
