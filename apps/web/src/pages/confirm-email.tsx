import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import { Link, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAccountConfirmEmailChange } from '../api/generated/api';
import { useAuthStore } from '../stores/auth.store';

type Status = 'pending' | 'success' | 'error';

/**
 * `/confirm-email?token=…` — публічний роут верхнього рівня, ПОЗА AppShell і
 * поза префіксами area (план D-13): лист відкривають на іншому, часто
 * незалогіненому пристрої — гейт авторизації викинув би на /login раніше,
 * ніж токен встиг би спрацювати.
 *
 * Токен одноразовий, тому підтвердження — ефект при монтуванні, а не форма;
 * `hasRun` захищає від подвійного виклику StrictMode в dev (другий виклик з
 * тим самим токеном отримав би 400 і показав хибну помилку).
 */
export function ConfirmEmailPage() {
  const { t } = useTranslation('user-settings');
  const search: { token?: string } = useSearch({ strict: false });
  const token = search.token ?? '';
  const hasSession = useAuthStore((s) => s.user !== null);
  const [status, setStatus] = useState<Status>(token ? 'pending' : 'error');
  const confirmEmailChange = useAccountConfirmEmailChange();
  const hasRun = useRef(false);

  useEffect(() => {
    if (!token || hasRun.current) {
      return;
    }
    hasRun.current = true;
    // Токен зникає з URL одразу, незалежно від результату — одноразове
    // посилання не мусить лишатись у видимій адресі
    window.history.replaceState(null, '', '/confirm-email');
    confirmEmailChange
      .mutateAsync({ data: { token } })
      .then(() => {
        setStatus('success');
      })
      .catch(() => {
        setStatus('error');
      });
    // Ефект зумисне лише за token: mutateAsync — свіжий інстанс щорендеру,
    // а лічильника hasRun вище й так достатньо для одноразовості
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-center text-xl">{t('confirmEmail.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 text-center">
            {status === 'pending' && (
              <p className="text-sm text-muted-foreground">{t('confirmEmail.pending')}</p>
            )}
            {status === 'success' && (
              <>
                <p className="text-sm text-foreground">{t('confirmEmail.success')}</p>
                <Link
                  to={hasSession ? '/user-settings/account' : '/login'}
                  className="text-sm text-primary underline underline-offset-4"
                >
                  {hasSession ? t('confirmEmail.goToAccount') : t('confirmEmail.goToLogin')}
                </Link>
              </>
            )}
            {status === 'error' && (
              <p className="text-sm text-destructive">{t('confirmEmail.invalidLink')}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
