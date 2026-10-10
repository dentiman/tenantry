import { Button } from '@saas-skeleton/ui/components/ui/button';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LoginSchema, type Login } from '@saas-skeleton/contracts';
import { useAuthLogin } from '../../../api/generated/api';
import { useAuthStore } from '../stores/auth.store';
import { applyServerError, FormPasswordField, FormTextField } from '../../../components/form';
import { AuthLayout } from '../components/auth-layout';
import {
  DEFAULT_DEMO_ACCOUNT,
  DEMO_LOGINS_ENABLED,
  DemoAccounts,
} from '../components/demo-accounts';

export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const login = useAuthLogin();

  const form = useForm<Login>({
    resolver: zodResolver(LoginSchema),
    // Демо-стенд: форма відкривається вже з флагманським акаунтом, презентеру
    // нічого не треба вводити (вимикається `VITE_DEMO_LOGINS=false`)
    defaultValues: {
      email: DEFAULT_DEMO_ACCOUNT?.email ?? '',
      password: DEFAULT_DEMO_ACCOUNT?.password ?? '',
      tenant: DEFAULT_DEMO_ACCOUNT?.tenant ?? '',
    },
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
      await navigate({ to: '/workspace' });
    } catch (error) {
      // 401 → root.server з message бекенда; network/5xx покаже глобальний toast
      applyServerError(error, form);
    }
  });

  return (
    <AuthLayout title={t('login.title')}>
      <div className="flex flex-col gap-6">
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
            {/* MT-3: недовірена підказка «де шукати юзера» (тимчасово ручне поле;
                піддомени — MT-4). Порожнє → дефолтний tenant інсталяції. Останнє:
                більшості людей воно не потрібне, тож не стоїть перед email */}
            <FormTextField
              control={control}
              name="tenant"
              label={t('login.tenant')}
              autoComplete="organization"
            />
          </FieldGroup>
          {errors.root?.server && (
            <p className="text-sm text-destructive">{errors.root.server.message}</p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t('login.submitting') : t('login.submit')}
          </Button>
          <Link
            to="/reset-password"
            className="text-center text-sm text-muted-foreground underline underline-offset-4"
          >
            {t('login.forgotPassword')}
          </Link>
        </form>
        {DEMO_LOGINS_ENABLED && (
          <DemoAccounts
            disabled={isSubmitting}
            onSelect={(account) => {
              form.reset({
                email: account.email,
                password: account.password,
                tenant: account.tenant,
              });
              void onSubmit();
            }}
          />
        )}
      </div>
    </AuthLayout>
  );
}
