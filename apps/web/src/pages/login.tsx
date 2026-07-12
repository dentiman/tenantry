import { Button, Card } from '@heroui/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LoginSchema, type Login } from '@saas-skeleton/contracts';
import { useAuthLogin } from '../api/generated/api';
import { useAuthStore } from '../stores/auth.store';
import { applyServerError, FormTextField } from '../components/form';

export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const login = useAuthLogin();

  const form = useForm<Login>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = await login.mutateAsync({ data: values });
      setSession(res.user, res.tokens);
      await navigate({ to: '/' });
    } catch (error) {
      // 401 → root.server з message бекенда; network/5xx покаже глобальний toast
      applyServerError(error, form);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="mb-6 text-center text-xl font-semibold text-foreground">{t('login.title')}</h1>
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
          <FormTextField
            control={control}
            name="email"
            label={t('login.email')}
            type="email"
            autoComplete="email"
          />
          <FormTextField
            control={control}
            name="password"
            label={t('login.password')}
            type="password"
            autoComplete="current-password"
          />
          {errors.root?.server && (
            <p className="text-sm text-danger">{errors.root.server.message}</p>
          )}
          <Button type="submit" variant="primary" fullWidth isDisabled={isSubmitting}>
            {isSubmitting ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          {t('login.noAccount')}{' '}
          <Link to="/register" className="font-medium text-link hover:underline">
            {t('login.registerLink')}
          </Link>
        </p>
      </Card>
    </div>
  );
}
