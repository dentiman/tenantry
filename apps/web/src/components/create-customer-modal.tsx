import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@saas-skeleton/ui/components/ui/dialog';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreateCustomerSchema, type CreateCustomer } from '@saas-skeleton/contracts';
import { getCustomersFindAllQueryKey, useCustomersCreate } from '../api/generated/api';
import { useAuthStore } from '../stores/auth.store';
import {
  applyServerError,
  FormPhoneField,
  FormSelect,
  FormTextField,
  FormUserSelect,
} from './form';

/**
 * Швидке створення: назва + тип, решта — опційно. Це не спрощення форми, а
 * доменне правило (docs/customers.md §6): форма на 15 обов'язкових полів
 * призводить до того, що клієнта заводять у блокнот, а не в систему.
 * Усе інше добирається на картці.
 */
export function CreateCustomerModal() {
  const { t } = useTranslation('customers');
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const createCustomer = useCustomersCreate();
  // Дефолтний відповідальний — той, хто заводить кастомера. Сервер зробив би те
  // саме («не передали → автор дії»), але у формі це мусить бути ВИДНО: інакше
  // порожнє поле читається як «нічий», а створений кастомер виявиться моїм
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);

  const kindOptions = [
    { id: 'ORGANIZATION', label: t('kind.ORGANIZATION') },
    { id: 'PERSON', label: t('kind.PERSON') },
  ];

  const form = useForm<CreateCustomer>({
    resolver: zodResolver(CreateCustomerSchema),
    // Повні defaultValues — вимога applyServerError: він звіряє імена полів із getValues
    defaultValues: {
      name: '',
      kind: 'ORGANIZATION',
      email: '',
      phone: null,
      phoneCountry: null,
      ownerId: currentUserId,
    },
  });
  const {
    control,
    handleSubmit,
    reset,
    setValue,
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
      await createCustomer.mutateAsync({ data: values });
      await queryClient.invalidateQueries({ queryKey: getCustomersFindAllQueryKey() });
      close(false);
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <Dialog open={isOpen} onOpenChange={close}>
      <DialogTrigger render={<Button />}>
        {t('create.trigger')}
        <Building2 />
      </DialogTrigger>
      <DialogContent className="flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[420px]">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>{t('create.heading')}</DialogTitle>
          <DialogDescription>{t('create.hint')}</DialogDescription>
        </DialogHeader>
        {/* Форма і є body діалогу: скрол тільки тут, хедер лишається на місці */}
        <form
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
        >
          <FieldGroup>
            <FormTextField
              control={control}
              name="name"
              label={t('create.name')}
              placeholder={t('create.namePlaceholder')}
            />
            <FormSelect
              control={control}
              name="kind"
              label={t('create.kind')}
              options={kindOptions}
            />
            <FormUserSelect
              control={control}
              name="ownerId"
              label={t('create.owner')}
            />
            <FormTextField
              control={control}
              name="email"
              label={t('create.email')}
              type="email"
              placeholder={t('create.emailPlaceholder')}
            />
            <FormPhoneField
              control={control}
              name="phone"
              label={t('create.phone')}
              countryValue={form.watch('phoneCountry')}
              onCountryChange={(code) => {
                setValue('phoneCountry', code, { shouldDirty: true });
              }}
            />
          </FieldGroup>

          {errors.root?.server && (
            <p className="text-sm text-destructive">{errors.root.server.message}</p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose render={<Button variant="secondary" />}>{t('create.cancel')}</DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('create.submitting') : t('create.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
