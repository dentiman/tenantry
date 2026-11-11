import { lazyPage } from '@saas-skeleton/ui/lib/lazy';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../../app-shell/app.routes';
import { requireGuest } from './auth.guards';
// Свідомо статично: вхід — перший екран кожного неавторизованого візиту, окремий чанк дав би
// зайвий RTT перед першим пейнтом (docs/frontend/lazy-loading.md §2)
// eslint-disable-next-line no-restricted-imports
import { LoginPage } from './pages/login';

/** Сторінки — окремі чанки (docs/frontend/lazy-loading.md) */
const ConfirmEmailPage = lazyPage(() => import('./pages/confirm-email'), 'ConfirmEmailPage');
const ResetPasswordPage = lazyPage(() => import('./pages/reset-password'), 'ResetPasswordPage');
const ResetPasswordConfirmPage = lazyPage(
  () => import('./pages/reset-password-confirm'),
  'ResetPasswordConfirmPage',
);

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: requireGuest,
  component: LoginPage,
});

/**
 * AUTH-3 (US4): публічні роути верхнього рівня, ПОЗА AppShell і поза
 * префіксами area — лист відкривають на іншому, часто незалогіненому
 * пристрої, тож гейт `requireAuth`/`requireGuest` тут навмисно не стоїть
 * (contracts/http-api.md §«/account»: confirm-роути публічні за побудовою).
 */
export const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPasswordPage,
});

export const resetPasswordConfirmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password/confirm',
  component: ResetPasswordConfirmPage,
});

/** Публічний і незалежний від AppShell (план D-13) — див. confirm-email.tsx */
export const confirmEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/confirm-email',
  component: ConfirmEmailPage,
});
