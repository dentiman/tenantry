import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreateUserSchema, type CreateUser } from '@saas-skeleton/contracts';
import { getUsersFindAllQueryKey, useUsersCreate } from '../api/generated/api';
import { applyServerError, FormPasswordField, FormSelect, FormTextField } from './form';

export function CreateUserModal() {
  const { t } = useTranslation('users');
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const createUser = useUsersCreate();

  const roleOptions = [
    { id: 'USER', label: t('roles.USER') },
    { id: 'ADMIN', label: t('roles.ADMIN') },
  ];

  const form = useForm<CreateUser>({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: { email: '', name: '', role: 'USER', password: '' },
  });
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = form;

  const close = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      reset();
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createUser.mutateAsync({
        data: { ...values, name: values.name?.trim() ? values.name.trim() : null },
      });
      await queryClient.invalidateQueries({ queryKey: getUsersFindAllQueryKey() });
      close(false);
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <Modal isOpen={isOpen} onOpenChange={close}>
      <Button variant="primary">{t('create.trigger')}</Button>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[420px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('create.heading')}</Modal.Heading>
            </Modal.Header>
            <form onSubmit={(e) => void onSubmit(e)} noValidate>
              <Modal.Body className="flex flex-col gap-4">
                <FormTextField
                  control={control}
                  name="email"
                  label={t('create.email')}
                  type="email"
                  placeholder={t('create.emailPlaceholder')}
                />
                <FormTextField
                  control={control}
                  name="name"
                  label={t('create.name')}
                  placeholder={t('create.namePlaceholder')}
                />
                <FormSelect control={control} name="role" label={t('create.role')} options={roleOptions} />
                <FormPasswordField
                  control={control}
                  name="password"
                  label={t('create.password')}
                  autoComplete="new-password"
                />
                {errors.root?.server && (
                  <p className="text-sm text-danger">{errors.root.server.message}</p>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">
                  {t('create.cancel')}
                </Button>
                <Button type="submit" variant="primary" isDisabled={isSubmitting}>
                  {isSubmitting ? t('create.submitting') : t('create.submit')}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
