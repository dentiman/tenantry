import { redirect } from '@tanstack/react-router';
import { allMatchesAllowed } from '@saas-skeleton/ui/navigation';
import { isAllowed } from './auth.access';
import { useAuthStore } from './stores/auth.store';

export function requireGuest(): void {
  if (useAuthStore.getState().operator) {
    // TanStack Router: redirect() кидається як управляючий об'єкт, не помилка
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/tenants' });
  }
}

/** Сесія + доступ до кожного збігу шляху (`staticData.access`) — дзеркало web */
export function requireAuth({
  matches,
}: {
  matches: readonly { staticData?: { access?: unknown } }[];
}): void {
  if (!useAuthStore.getState().operator) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/login' });
  }
  if (!allMatchesAllowed(matches, isAllowed)) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/tenants' });
  }
}
