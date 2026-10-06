import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { SetTenantUserPasswordSchema } from '@saas-skeleton/contracts/platform';
import { useTenantUsersSetPassword } from '../../../api/generated/api';
import type { TenantUserListResponseDtoOutputItemsItem } from '../../../api/generated/model/tenantUserListResponseDtoOutputItemsItem';
import { applyServerError, FormPasswordField } from '@saas-skeleton/ui/components/form';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@saas-skeleton/ui/components/ui/dialog';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';

interface TenantUserPasswordModalProps {
  tenantId: string;
  /** null — модалка закрита (controlled ззовні) */
  user: TenantUserListResponseDtoOutputItemsItem | null;
  onClose: () => void;
}

interface PasswordForm {
  password: string;
  confirmPassword: string;
}

/**
 * Оператор задає юзеру tenant-а новий пароль. Підтвердження — лише UX-перевірка форми:
 * контракт про нього не знає, форма розширює контрактну схему, а не підміняє її.
 */
export function TenantUserPasswordModal({ tenantId, user, onClose }: TenantUserPasswordModalProps) {
  const { t } = useTranslation('tenant-users');
  const setPassword = useTenantUsersSetPassword();

  const schema = useMemo(
    () =>
      SetTenantUserPasswordSchema.extend({ confirmPassword: z.string() }).refine(
        (values) => values.password === values.confirmPassword,
        { path: ['confirmPassword'], message: t('password.mismatch') },
      ),
    [t],
  );

  const form = useForm<PasswordForm>({
    resolver: zodResolver(schema),
    // Повні defaultValues — вимога applyServerError
    defaultValues: { password: '', confirmPassword: '' },
  });
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = form;

  const close = (open: boolean): void => {
    if (!open) {
      reset();
      onClose();
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!user) {
      return;
    }
    try {
      await setPassword.mutateAsync({
        tenantId,
        userId: user.id,
        data: { password: values.password },
      });
      toast.add({ type: 'success', title: t('password.done') });
      close(false);
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <Dialog open={user !== null} onOpenChange={close}>
      <DialogContent className="flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[420px]">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>{t('password.heading')}</DialogTitle>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
        >
          {user && <UserIdentity id={user.id} email={user.email} name={user.name} size="lg" />}
          <p className="text-sm text-muted-foreground">{t('password.description')}</p>

          <FieldGroup>
            <FormPasswordField
              control={control}
              name="password"
              label={t('password.new')}
              autoComplete="new-password"
            />
            <FormPasswordField
              control={control}
              name="confirmPassword"
              label={t('password.confirm')}
              autoComplete="new-password"
            />
          </FieldGroup>

          {errors.root?.server && (
            <p className="text-sm text-destructive">{errors.root.server.message}</p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose render={<Button variant="secondary" />}>
              {t('password.cancel')}
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('password.submitting') : t('password.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
