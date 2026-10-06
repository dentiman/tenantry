import { redirect } from '@tanstack/react-router';
import { useAuthStore } from './stores/auth.store';

export function requireGuest(): void {
  if (useAuthStore.getState().operator) {
    // TanStack Router: redirect() кидається як управляючий об'єкт, не помилка
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/tenants' });
  }
}

export function requireAuth(): void {
  if (!useAuthStore.getState().operator) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/login' });
  }
}
