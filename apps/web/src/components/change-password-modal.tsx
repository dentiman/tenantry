import { useMemo } from 'react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@saas-skeleton/ui/components/ui/dialog';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { SetUserPasswordSchema } from '@saas-skeleton/contracts';
import { useUsersSetPassword } from '../api/generated/api';
import type { UserListResponseDtoOutputItemsItem } from '../api/generated/model/userListResponseDtoOutputItemsItem';
import { applyServerError, FormPasswordField } from './form';
import { UserIdentity } from './user-identity';

interface ChangePasswordModalProps {
  /** null — модалка закрита (controlled ззовні, як ChangeAvatarModal) */
  user: UserListResponseDtoOutputItemsItem | null;
  onClose: () => void;
}

interface ChangePasswordForm {
  password: string;
  confirmPassword: string;
}

/**
 * Адмін задає юзеру новий пароль. Підтвердження живе ТІЛЬКИ тут: серверу другий
 * екземпляр того самого рядка не дає нічого, тому контракт (`SetUserPasswordSchema`)
 * про нього не знає — форма розширює контрактну схему, а не підміняє її.
 */
export function ChangePasswordModal({ user, onClose }: ChangePasswordModalProps) {
  const { t } = useTranslation('users');
  const setPassword = useUsersSetPassword();

  // Схема залежить від t (повідомлення про розбіжність локалізоване), тому будується тут
  const schema = useMemo(
    () =>
      SetUserPasswordSchema.extend({ confirmPassword: z.string() }).refine(
        (values) => values.password === values.confirmPassword,
        { path: ['confirmPassword'], message: t('password.mismatch') },
      ),
    [t],
  );

  const form = useForm<ChangePasswordForm>({
    resolver: zodResolver(schema),
    // Повні defaultValues — вимога applyServerError (звіряє імена полів із getValues)
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
      await setPassword.mutateAsync({ id: user.id, data: { password: values.password } });
      // Список не інвалідуємо: жодне поле юзера у гріді не змінилось
      close(false);
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <Dialog open={user !== null} onOpenChange={close}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('password.heading')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
          {user && (
            <UserIdentity
              email={user.email}
              name={user.name}
              avatarUrl={user.avatarUrl}
              size="lg"
            />
          )}
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

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t('password.cancel')}</DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('password.submitting') : t('password.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
