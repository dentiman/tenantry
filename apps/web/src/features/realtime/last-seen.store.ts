import { create } from 'zustand';

interface LastSeenState {
  /** userId → ISO останньої підтвердженої присутності, отриманий socket-дельтою */
  byUser: Record<string, string>;
  observe: (userId: string, lastSeenAt: string) => void;
  forget: (userId: string) => void;
}

/**
 * Накладка на `user.lastSeenAt` зі списку юзерів (RT-3).
 *
 * Навіщо взагалі: рядок юзера фетчиться один раз, далі присутність живе
 * дельтами. У мить, коли приходить `offline`, поле в кеші застаріле рівно на
 * час від фетчу — і UI написав би «last seen 12 minutes ago» саме тоді, коли
 * правильно «now». Дельта везе точний час, ця накладка його памʼятає.
 *
 * Zustand, а не TanStack Query: пишеться з `presence-sync`, тобто з коду ПОЗА
 * React-деревом (той самий випадок, що `notification-ui.store`). Патчити кеш
 * списку юзерів напряму не можна — ключів запиту стільки, скільки комбінацій
 * фільтрів і сторінок.
 */
export const useLastSeenStore = create<LastSeenState>((set) => ({
  byUser: {},
  observe: (userId, lastSeenAt) => {
    set((state) => ({ byUser: { ...state.byUser, [userId]: lastSeenAt } }));
  },
  // Юзер повернувся онлайн — накладка більше не потрібна: показується «Online»,
  // а свіже значення приїде з наступним фетчем списку
  forget: (userId) => {
    set((state) => {
      if (!(userId in state.byUser)) {
        return state;
      }
      const { [userId]: _removed, ...rest } = state.byUser;
      return { byUser: rest };
    });
  },
}));
