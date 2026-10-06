import { redirect } from '@tanstack/react-router';
import { useAuthStore } from './stores/auth.store';

export function requireGuest(): void {
  if (useAuthStore.getState().user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/workspace' });
  }
}

export function requireAuth(): void {
  if (!useAuthStore.getState().user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/login' });
  }
}

/**
 * Налаштування організації редагує лише адмін — і бекенд це enforce-ить
 * (`@Roles(ADMIN)` на записі). Гейт тут не «замість» серверного, а щоб USER не
 * дивився на форми, які однаково не збережуться. Пункт area в рейлі ховає
 * `canSee` у `app-shell/areas.tsx` — це видимість, а enforcement саме тут.
 */
export function requireAdmin(): void {
  const user = useAuthStore.getState().user;
  if (!user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/login' });
  }
  if (user.role !== 'ADMIN') {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/workspace' });
  }
}
