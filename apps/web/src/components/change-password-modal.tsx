import { useMemo } from 'react';
import { Button, Modal } from '@heroui/react';
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
    <Modal.Backdrop isOpen={user !== null} onOpenChange={close}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[420px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t('password.heading')}</Modal.Heading>
          </Modal.Header>
          <form onSubmit={(e) => void onSubmit(e)} noValidate>
            <Modal.Body className="flex flex-col gap-4">
              {user && (
                <UserIdentity
                  email={user.email}
                  name={user.name}
                  avatarUrl={user.avatarUrl}
                  size="lg"
                />
              )}
              <p className="text-sm text-muted">{t('password.description')}</p>

              <FormPasswordField
                control={control}
                name="password"
                label={t('password.new')}
                autoComplete="new-password"
                variant="secondary"
              />
              <FormPasswordField
                control={control}
                name="confirmPassword"
                label={t('password.confirm')}
                autoComplete="new-password"
                variant="secondary"
              />

              {errors.root?.server && (
                <p className="text-sm text-danger">{errors.root.server.message}</p>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="tertiary">
                {t('password.cancel')}
              </Button>
              <Button type="submit" variant="primary" isDisabled={isSubmitting}>
                {isSubmitting ? t('password.submitting') : t('password.submit')}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
