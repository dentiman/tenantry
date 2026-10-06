import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../../app-shell/app.routes';
import { requireGuest } from './auth.guards';
import { ConfirmEmailPage } from './pages/confirm-email';
import { LoginPage } from './pages/login';
import { ResetPasswordPage } from './pages/reset-password';
import { ResetPasswordConfirmPage } from './pages/reset-password-confirm';

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
