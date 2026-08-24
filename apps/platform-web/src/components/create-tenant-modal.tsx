import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreateTenantSchema, type CreateTenant } from '@saas-skeleton/contracts/platform';
import { getTenantsFindAllQueryKey, useTenantsCreate } from '../api/generated/api';
import {
  applyServerError,
  FormPasswordField,
  FormTextField,
} from '@saas-skeleton/ui/components/form';
import { Plus } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@saas-skeleton/ui/components/ui/dialog';
import {
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '@saas-skeleton/ui/components/ui/field';

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
    <Dialog open={isOpen} onOpenChange={close}>
      <DialogTrigger render={<Button />}>
        {t('create.trigger')}
        <Plus />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('create.heading')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
          <FieldGroup>
            <FormTextField
              control={control}
              name="slug"
              label={t('create.slug')}
              placeholder={t('create.slugPlaceholder')}
              description={t('create.slugHint')}
            />
            <FormTextField
              control={control}
              name="name"
              label={t('create.name')}
              placeholder={t('create.namePlaceholder')}
            />

            <FieldSeparator />

            <FieldSet>
              <FieldLegend variant="label">{t('create.adminSectionTitle')}</FieldLegend>
              <FieldGroup>
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
                <FormPasswordField
                  control={control}
                  name="admin.password"
                  label={t('create.adminPassword')}
                  autoComplete="new-password"
                  description={t('create.adminPasswordHint')}
                />
              </FieldGroup>
            </FieldSet>
          </FieldGroup>

          {errors.root?.server && (
            <p className="text-sm text-destructive">{errors.root.server.message}</p>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t('create.cancel')}</DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('create.submitting') : t('create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
