import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ChangeOwnPasswordSchema } from '@saas-skeleton/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@saas-skeleton/ui/components/ui/alert-dialog';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { useAccountChangePassword, useAccountRevokeAllSessions } from '../../api/generated/api';
import { ContentSection } from '../../components/section/content-section';
import { applyServerError, FormPasswordField } from '../../components/form';
import { useAuthStore } from '../../stores/auth.store';

interface ChangePasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * Безпека акаунта. Дві дії, і обидві мають один побічний ефект: усі refresh-сесії
 * юзера відкликаються, а поточному пристрою сервер повертає СВІЖУ пару токенів —
 * її треба покласти в стор, інакше людина вилетіла б на /login за власну ж дію.
 */
export function UserSettingsSecurityPage() {
  const { t } = useTranslation('user-settings');

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/user-settings' }, { label: t('security.title') }]}
        subtitle={t('security.description')}
      />
      <div className="flex flex-col gap-8">
        <PasswordForm />
        <Separator />
        <SessionsSection />
      </div>
    </ContentSection>
  );
}

function PasswordForm() {
  const { t } = useTranslation('user-settings');
  const setTokens = useAuthStore((s) => s.setTokens);
  const changePassword = useAccountChangePassword();

  // Підтвердження живе ТІЛЬКИ у формі: серверу другий екземпляр рядка нічого не дає,
  // тому контракт про нього не знає — форма розширює його схему, а не підміняє
  const schema = useMemo(
    () =>
      ChangeOwnPasswordSchema.extend({ confirmPassword: z.string() }).refine(
        (values) => values.newPassword === values.confirmPassword,
        { path: ['confirmPassword'], message: t('security.password.mismatch') },
      ),
    [t],
  );

  const form = useForm<ChangePasswordForm>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const tokens = await changePassword.mutateAsync({
        data: { currentPassword: values.currentPassword, newPassword: values.newPassword },
      });
      // Стара пара щойно померла разом з усіма іншими сесіями
      setTokens(tokens);
      reset();
      toast.add({ type: 'success', title: t('security.password.changed') });
    } catch (error) {
      // Невірний поточний пароль приїжджає полем currentPassword — стане під ним
      applyServerError(error, form);
    }
  });

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">{t('security.password.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('security.password.description')}</p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
        <FieldGroup>
          <FormPasswordField
            control={control}
            name="currentPassword"
            label={t('security.password.current')}
            autoComplete="current-password"
          />
          <FormPasswordField
            control={control}
            name="newPassword"
            label={t('security.password.new')}
            autoComplete="new-password"
          />
          <FormPasswordField
            control={control}
            name="confirmPassword"
            label={t('security.password.confirm')}
            autoComplete="new-password"
          />
        </FieldGroup>

        {errors.root?.server && (
          <p className="text-sm text-destructive">{errors.root.server.message}</p>
        )}

        <div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('security.password.submitting') : t('security.password.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * Списку пристроїв тут немає — і це не спрощення UI, а чесне відображення моделі:
 * рядок refresh-токена живе до найближчої ротації і щоразу отримує новий id, тож
 * «сесії» як сутності, яку можна показати і вибірково вбити, не існує.
 */
function SessionsSection() {
  const { t } = useTranslation('user-settings');
  const setTokens = useAuthStore((s) => s.setTokens);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const revokeAll = useAccountRevokeAllSessions();

  const revoke = async (): Promise<void> => {
    const tokens = await revokeAll.mutateAsync();
    setTokens(tokens);
    setIsConfirmOpen(false);
    toast.add({ type: 'success', title: t('security.sessions.done') });
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">{t('security.sessions.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('security.sessions.description')}</p>
      </div>

      <p className="text-sm text-muted-foreground">{t('security.sessions.note')}</p>

      <div>
        <Button
          variant="secondary"
          disabled={revokeAll.isPending}
          onClick={() => {
            setIsConfirmOpen(true);
          }}
        >
          {t('security.sessions.signOutAll')}
        </Button>
      </div>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('security.sessions.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('security.sessions.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{t('security.sessions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void revoke();
              }}
            >
              {t('security.sessions.confirm')}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
