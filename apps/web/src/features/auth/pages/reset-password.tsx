import { useState } from 'react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PasswordResetRequestSchema, type PasswordResetRequest } from '@saas-skeleton/contracts';
import { usePasswordResetRequest } from '../../../api/generated/api';
import { FormTextField } from '../../../components/form';

/**
 * AUTH-3: без оракула — 204 однаковий для будь-якого email (contracts/http-api.md
 * §«POST /auth/password-reset»), тому форма завжди показує той самий успіх,
 * незалежно від того, чи існує акаунт.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  const [sent, setSent] = useState(false);
  const requestReset = usePasswordResetRequest();

  const form = useForm<PasswordResetRequest>({
    resolver: zodResolver(PasswordResetRequestSchema),
    defaultValues: { email: '', tenant: '' },
  });
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    await requestReset.mutateAsync({ data: values });
    // Немає гілки на помилку: ендпоінт завжди 204, навіть для мережевих проблем
    // фронт не має чим відрізнити «немає такого email» від «лист уже в дорозі»
    setSent(true);
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-center text-xl">{t('resetPassword.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col gap-4 text-center">
              <p className="text-sm text-muted-foreground">{t('resetPassword.sent')}</p>
              <Link to="/login" className="text-sm text-primary underline underline-offset-4">
                {t('resetPassword.backToLogin')}
              </Link>
            </div>
          ) : (
            <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
              <FieldGroup>
                <FormTextField
                  control={control}
                  name="tenant"
                  label={t('login.tenant')}
                  autoComplete="organization"
                />
                <FormTextField
                  control={control}
                  name="email"
                  label={t('login.email')}
                  type="email"
                  autoComplete="email"
                />
              </FieldGroup>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? t('resetPassword.submitting') : t('resetPassword.submit')}
              </Button>
              <Link
                to="/login"
                className="text-center text-sm text-muted-foreground underline underline-offset-4"
              >
                {t('resetPassword.backToLogin')}
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
