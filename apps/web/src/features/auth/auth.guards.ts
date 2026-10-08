import { redirect } from '@tanstack/react-router';
import { allMatchesAllowed } from '@saas-skeleton/ui/navigation';
import { isAllowed } from './auth.access';
import { useAuthStore } from './stores/auth.store';

export function requireGuest(): void {
  if (useAuthStore.getState().user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/workspace' });
  }
}

/**
 * Гейт застосунку: сесія + доступ до КОЖНОГО збігу шляху. Доступ оголошує роут у
 * `staticData.access` (`auth.access.ts`), тож обмеження на лейауті (`/settings`) діє на всіх
 * дітей, а той самий предикат ховає пункти меню. Це зручність, а не захист — enforcement
 * на бекенді (`@Roles`).
 */
export function requireAuth({
  matches,
}: {
  matches: readonly { staticData?: { access?: unknown } }[];
}): void {
  const user = useAuthStore.getState().user;
  if (!user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/login' });
  }
  if (!allMatchesAllowed(matches, (access) => isAllowed(access, user))) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/workspace' });
  }
}
