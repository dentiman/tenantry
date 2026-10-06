import { useMemo, useState } from 'react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PasswordResetConfirmSchema } from '@saas-skeleton/contracts';
import { usePasswordResetConfirm } from '../../../api/generated/api';
import { applyServerError, FormPasswordField } from '../../../components/form';
import { useAuthStore } from '../stores/auth.store';

interface ConfirmForm {
  newPassword: string;
  confirmPassword: string;
}

/**
 * `/reset-password/confirm?token=…` — лінк із листа. Токен читається з URL і
 * одразу зникає з рядка адреси (history.replaceState): він одноразовий, і
 * лишати його у видимій адресі (яку копіюють, шерять, зберігають у історії
 * браузера) не має сенсу вже після першого рендеру.
 */
export function ResetPasswordConfirmPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const search: { token?: string } = useSearch({ strict: false });
  const token = search.token ?? '';
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const confirmReset = usePasswordResetConfirm();

  const schema = useMemo(
    () =>
      PasswordResetConfirmSchema.pick({ newPassword: true })
        .extend({ confirmPassword: z.string() })
        .refine((values) => values.newPassword === values.confirmPassword, {
          path: ['confirmPassword'],
          message: t('resetPasswordConfirm.mismatch'),
        }),
    [t],
  );

  const form = useForm<ConfirmForm>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const response = await confirmReset.mutateAsync({
        data: { token, newPassword: values.newPassword },
      });
      // Токен зник з URL, а не лишився в історії — одноразове посилання, яке
      // спрацювало, більше не мусить бути видимим у рядку адреси
      window.history.replaceState(null, '', '/reset-password/confirm');
      setSession(response.user, response.tokens);
      await navigate({ to: '/workspace' });
    } catch (error) {
      // Недійсний/протухлий/використаний токен — та сама 400 без fieldErrors
      // (contracts/http-api.md: «однакова відповідь, токен не споживається»)
      setTokenInvalid(true);
      applyServerError(error, form);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-center text-xl">{t('resetPasswordConfirm.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!token || tokenInvalid ? (
            <div className="flex flex-col gap-4 text-center">
              <p className="text-sm text-destructive">{t('resetPasswordConfirm.invalidLink')}</p>
              <Link to="/reset-password" className="text-sm text-primary underline underline-offset-4">
                {t('resetPasswordConfirm.requestNew')}
              </Link>
            </div>
          ) : (
            <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
              <FieldGroup>
                <FormPasswordField
                  control={control}
                  name="newPassword"
                  label={t('resetPasswordConfirm.newPassword')}
                  autoComplete="new-password"
                />
                <FormPasswordField
                  control={control}
                  name="confirmPassword"
                  label={t('resetPasswordConfirm.confirmPassword')}
                  autoComplete="new-password"
                />
              </FieldGroup>
              {errors.root?.server && (
                <p className="text-sm text-destructive">{errors.root.server.message}</p>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? t('resetPasswordConfirm.submitting') : t('resetPasswordConfirm.submit')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
