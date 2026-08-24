import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PlatformLoginSchema, type PlatformLogin } from '@saas-skeleton/contracts/platform';
import { usePlatformAuthLogin } from '../api/generated/api';
import { useAuthStore } from '../stores/auth.store';
import {
  applyServerError,
  FormPasswordField,
  FormTextField,
} from '@saas-skeleton/ui/components/form';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';

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
      <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-center text-xl">{t('login.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
            <FieldGroup>
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
            </FieldGroup>
            {errors.root?.server && (
              <p className="text-sm text-destructive">{errors.root.server.message}</p>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
