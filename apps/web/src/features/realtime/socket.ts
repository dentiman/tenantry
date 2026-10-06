import { io, type Socket } from 'socket.io-client';
import {
  REALTIME_EVENTS,
  REALTIME_PATH,
  TENANT_NAMESPACE,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@saas-skeleton/contracts';
import { refreshTokens } from '../../api/http-client';
import { useAuthStore } from '../auth/stores/auth.store';

/**
 * Клієнтські карти подій дзеркальні до серверних: те, що сервер шле, клієнт слухає.
 */
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Singleton ПОЗА React-деревом. У `useEffect` це жити не може: React StrictMode
 * у dev монтує ефекти двічі, і на кожен рендер зʼявлявся б другий socket — тобто
 * друга lease, зайвий heartbeat і фантомний online після закриття однієї вкладки.
 */
let socket: AppSocket | null = null;
let initialized = false;

export function getSocket(): AppSocket {
  socket ??= io(TENANT_NAMESPACE, {
    path: REALTIME_PATH,
    // Той самий транспорт, що на сервері: polling вимкнено, тому sticky sessions
    // не потрібні (див. docs/realtime-internals.md § «Інфраструктура»)
    transports: ['websocket'],
    // Підключаємось не на імпорті модуля, а коли зʼявився токен
    autoConnect: false,
    // Саме функція, а не обʼєкт: вона викликається на КОЖЕН (ре)конект і завжди
    // бере найсвіжіший токен зі стору. Обʼєкт зафіксував би той, що був на старті.
    auth: (cb) => {
      cb({ token: useAuthStore.getState().accessToken ?? '' });
    },
  });
  return socket;
}

/** Оновлення токена у ВЖЕ відкритому зʼєднанні — без disconnect і без presence-flicker */
function sendAuthUpdate(accessToken: string): void {
  const current = getSocket();
  current.emit(REALTIME_EVENTS.authUpdate, { accessToken }, (result) => {
    if (result.status === 'rejected') {
      // Сервер не прийняв токен у поточній сесії (напр. змінилась роль) —
      // це не помилка, а привід пройти повний handshake заново
      current.disconnect();
      current.connect();
    }
  });
}

/**
 * Єдина точка життєвого циклу socket-а. Викликається один раз із bootstrap,
 * до першого рендера.
 */
export function initSocket(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  const current = getSocket();

  // Сервер попереджає завчасно — перевикористовуємо ТОЙ САМИЙ single-flight
  // refresh, що й axios-інтерсептор: два незалежні refresh-флоу ротували б
  // refresh-токен один в одного і вибили б сесію
  current.on(REALTIME_EVENTS.authExpiring, () => {
    void refreshTokens().catch(() => {
      // Якщо звичайний refresh теж не вдався — сесію чистить axios-інтерсептор
      // на найближчому 401; socket просто закриється сервером по exp
    });
  });

  // Зміни в сторі — єдиний драйвер конекту: логін, logout і refresh усі проходять через нього
  useAuthStore.subscribe((state, prev) => {
    if (state.accessToken === prev.accessToken) {
      return;
    }
    if (!state.accessToken) {
      current.disconnect();
      return;
    }
    if (current.connected) {
      sendAuthUpdate(state.accessToken);
    } else {
      current.connect();
    }
  });

  // Закриття вкладки має бути ЯВНИМ: тоді сервер бачить `client namespace disconnect`
  // і віддає lease одразу. Без цього браузер просто рве транспорт, що незрізненно
  // від зниклої мережі — і юзер висів би online до кінця TTL.
  window.addEventListener('pagehide', () => {
    current.disconnect();
  });

  if (useAuthStore.getState().accessToken) {
    current.connect();
  }
}
