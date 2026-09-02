import { useEffect } from 'react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@saas-skeleton/ui/components/ui/dialog';
import {
  FieldGroup,
  FieldSeparator,
  FieldSet,
  FieldLegend,
} from '@saas-skeleton/ui/components/ui/field';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { UpdateCustomerSchema, type UpdateCustomer } from '@saas-skeleton/contracts';
import {
  getCustomersFindAllQueryKey,
  getCustomersFindOneQueryKey,
  useCustomersUpdate,
  useUsersFindAll,
} from '../api/generated/api';
import type { CustomerDetailResponseDtoOutput } from '../api/generated/model/customerDetailResponseDtoOutput';
import {
  applyServerError,
  FormPhoneField,
  FormSelect,
  FormTextareaField,
  FormTextField,
} from './form';

/** Порожній рядок у селекті = «нічий»: Base UI не вміє null як значення пункту */
const UNASSIGNED = '';

/**
 * Повне редагування картки. Номер і статус тут відсутні свідомо: номер незмінний
 * (на нього посилаються в документах), а статус — подія з власним ендпоінтом.
 */
export function EditCustomerModal({
  customer,
  onClose,
}: {
  customer: CustomerDetailResponseDtoOutput | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('customers');
  const queryClient = useQueryClient();
  const updateCustomer = useCustomersUpdate();
  // Список для вибору відповідального. limit великий свідомо: селект без пошуку
  // має сенс лише поки команда невелика — з ростом це стане окремим комбобоксом
  const { data: users } = useUsersFindAll({ limit: 200, isActive: 'true' });

  const form = useForm<UpdateCustomer>({
    resolver: zodResolver(UpdateCustomerSchema),
    defaultValues: {},
  });
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { isSubmitting, errors },
  } = form;

  // Форма заповнюється при кожному відкритті: картку могли змінити з іншої вкладки
  useEffect(() => {
    if (!customer) return;
    reset({
      name: customer.name,
      legalName: customer.legalName ?? '',
      kind: customer.kind,
      email: customer.email ?? '',
      phone: customer.phone,
      phoneCountry: customer.phoneCountry,
      website: customer.website ?? '',
      taxId: customer.taxId ?? '',
      currency: customer.currency,
      ownerId: customer.ownerId ?? UNASSIGNED,
      notes: customer.notes ?? '',
      addressLine1: customer.addressLine1 ?? '',
      addressLine2: customer.addressLine2 ?? '',
      city: customer.city ?? '',
      region: customer.region ?? '',
      postalCode: customer.postalCode ?? '',
      country: customer.country ?? '',
    });
  }, [customer, reset]);

  const kindOptions = [
    { id: 'ORGANIZATION', label: t('kind.ORGANIZATION') },
    { id: 'PERSON', label: t('kind.PERSON') },
  ];

  const ownerOptions = [
    { id: UNASSIGNED, label: t('edit.ownerNone') },
    ...(users?.items ?? []).map((user) => ({ id: user.id, label: user.name ?? user.email })),
  ];

  const onSubmit = handleSubmit(async (values) => {
    if (!customer) return;
    try {
      await updateCustomer.mutateAsync({
        id: customer.id,
        // Порожній вибір відповідального означає «нічий», а не «не чіпати»
        data: { ...values, ownerId: values.ownerId === UNASSIGNED ? null : values.ownerId },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getCustomersFindAllQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getCustomersFindOneQueryKey(customer.id) }),
      ]);
      onClose();
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <Dialog
      open={customer !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('edit.heading')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
          <FieldSet>
            <FieldLegend>{t('edit.sections.identity')}</FieldLegend>
            <FieldGroup>
              <FormTextField control={control} name="name" label={t('edit.name')} />
              <FormTextField control={control} name="legalName" label={t('edit.legalName')} />
              <FormSelect
                control={control}
                name="kind"
                label={t('edit.kind')}
                options={kindOptions}
              />
              <FormSelect
                control={control}
                name="ownerId"
                label={t('edit.owner')}
                options={ownerOptions}
              />
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet>
            <FieldLegend>{t('edit.sections.contact')}</FieldLegend>
            <FieldGroup>
              <FormTextField control={control} name="email" label={t('edit.email')} type="email" />
              <FormPhoneField
                control={control}
                name="phone"
                label={t('edit.phone')}
                countryValue={form.watch('phoneCountry')}
                onCountryChange={(code) => {
                  setValue('phoneCountry', code, { shouldDirty: true });
                }}
              />
              <FormTextField control={control} name="website" label={t('edit.website')} />
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet>
            <FieldLegend>{t('edit.sections.address')}</FieldLegend>
            <FieldGroup>
              <FormTextField control={control} name="addressLine1" label={t('edit.addressLine1')} />
              <FormTextField control={control} name="addressLine2" label={t('edit.addressLine2')} />
              <FormTextField control={control} name="city" label={t('edit.city')} />
              <FormTextField control={control} name="region" label={t('edit.region')} />
              <FormTextField control={control} name="postalCode" label={t('edit.postalCode')} />
              {/* Країна — рядок ISO alpha-2: суворіша валідація адрес шкодить
                  (формати індексів і «регіонів» різні в кожній країні) */}
              <FormTextField control={control} name="country" label={t('edit.country')} />
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet>
            <FieldLegend>{t('edit.sections.business')}</FieldLegend>
            <FieldGroup>
              <FormTextField control={control} name="taxId" label={t('edit.taxId')} />
              <FormTextField control={control} name="currency" label={t('edit.currency')} />
              <FormTextareaField control={control} name="notes" label={t('edit.notes')} />
            </FieldGroup>
          </FieldSet>

          {errors.root?.server && (
            <p className="text-sm text-destructive">{errors.root.server.message}</p>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>{t('edit.cancel')}</DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('edit.submitting') : t('edit.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
