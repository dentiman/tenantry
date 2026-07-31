import { Button, Card } from '@heroui/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PlatformLoginSchema, type PlatformLogin } from '@saas-skeleton/contracts/platform';
import { usePlatformAuthLogin } from '../api/generated/api';
import { useAuthStore } from '../stores/auth.store';
import { applyServerError, FormPasswordField, FormTextField } from '../components/form';

export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const login = usePlatformAuthLogin();

  const form = useForm<PlatformLogin>({
    resolver: zodResolver(PlatformLoginSchema),
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
      setSession(res.user, res.accessToken);
      await navigate({ to: '/' });
    } catch (error) {
      // 401 → root.server з message бекенда; network/5xx покаже глобальний toast
      applyServerError(error, form);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="mb-6 text-center text-xl font-semibold text-foreground">
          {t('login.title')}
        </h1>
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
          <FormTextField
            control={control}
            name="email"
            label={t('login.email')}
            type="email"
            autoComplete="email"
          />
          <FormPasswordField
            control={control}
            name="password"
            label={t('login.password')}
            autoComplete="current-password"
          />
          {errors.root?.server && (
            <p className="text-sm text-danger">{errors.root.server.message}</p>
          )}
          <Button type="submit" variant="primary" fullWidth isDisabled={isSubmitting}>
            {isSubmitting ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
