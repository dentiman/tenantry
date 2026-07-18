import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreateTenantSchema, type CreateTenant } from '@saas-skeleton/contracts/platform';
import { getTenantsFindAllQueryKey, useTenantsCreate } from '../api/generated/api';
import { applyServerError, FormTextField } from './form';

export function CreateTenantModal() {
  const { t } = useTranslation('tenants');
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const createTenant = useTenantsCreate();

  const form = useForm<CreateTenant>({
    resolver: zodResolver(CreateTenantSchema),
    defaultValues: {
      slug: '',
      name: '',
      admin: { email: '', password: '', name: '' },
    },
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
      await createTenant.mutateAsync({
        data: {
          ...values,
          admin: {
            ...values.admin,
            name: values.admin.name?.trim() ? values.admin.name.trim() : null,
          },
        },
      });
      await queryClient.invalidateQueries({ queryKey: getTenantsFindAllQueryKey() });
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
          <Modal.Dialog className="sm:max-w-[440px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('create.heading')}</Modal.Heading>
            </Modal.Header>
            <form onSubmit={(e) => void onSubmit(e)} noValidate>
              <Modal.Body className="flex flex-col gap-4">
                <div>
                  <FormTextField
                    control={control}
                    name="slug"
                    label={t('create.slug')}
                    placeholder={t('create.slugPlaceholder')}
                  />
                  <p className="mt-1 text-xs text-muted">{t('create.slugHint')}</p>
                </div>
                <FormTextField
                  control={control}
                  name="name"
                  label={t('create.name')}
                  placeholder={t('create.namePlaceholder')}
                />

                <div className="mt-2 border-t border-border pt-4">
                  <p className="mb-3 text-sm font-medium text-foreground">
                    {t('create.adminSectionTitle')}
                  </p>
                  <div className="flex flex-col gap-4">
                    <FormTextField
                      control={control}
                      name="admin.email"
                      label={t('create.adminEmail')}
                      type="email"
                      placeholder={t('create.adminEmailPlaceholder')}
                    />
                    <FormTextField
                      control={control}
                      name="admin.name"
                      label={t('create.adminName')}
                      placeholder={t('create.adminNamePlaceholder')}
                    />
                    <div>
                      <FormTextField
                        control={control}
                        name="admin.password"
                        label={t('create.adminPassword')}
                        type="password"
                        autoComplete="new-password"
                      />
                      <p className="mt-1 text-xs text-muted">{t('create.adminPasswordHint')}</p>
                    </div>
                  </div>
                </div>

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
