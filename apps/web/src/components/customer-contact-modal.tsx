import { useEffect } from 'react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@saas-skeleton/ui/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreateCustomerContactSchema, type CreateCustomerContact } from '@saas-skeleton/contracts';
import {
  getCustomersFindOneQueryKey,
  useCustomersAddContact,
  useCustomersUpdateContact,
} from '../api/generated/api';
import type { CustomerDetailResponseDtoOutputContactsItem } from '../api/generated/model/customerDetailResponseDtoOutputContactsItem';
import { applyServerError, FormPhoneField, FormTextareaField, FormTextField } from './form';

type Contact = CustomerDetailResponseDtoOutputContactsItem;

const EMPTY: CreateCustomerContact = {
  name: '',
  position: '',
  email: '',
  phone: null,
  phoneCountry: null,
  isPrimary: false,
  notes: '',
};

/**
 * Одна модалка на створення і редагування: поля ті самі, різниця тільки в тому,
 * яка мутація летить. Окремі компоненти дали б два місця, де форма контакту
 * розходиться.
 */
export function CustomerContactModal({
  customerId,
  contact,
  isOpen,
  onClose,
}: {
  customerId: string;
  /** null — створення нового контакту */
  contact: Contact | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('customers');
  const queryClient = useQueryClient();
  const addContact = useCustomersAddContact();
  const updateContact = useCustomersUpdateContact();

  const form = useForm<CreateCustomerContact>({
    resolver: zodResolver(CreateCustomerContactSchema),
    defaultValues: EMPTY,
  });
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { isSubmitting, errors },
  } = form;

  useEffect(() => {
    if (!isOpen) return;
    reset(
      contact
        ? {
            name: contact.name,
            position: contact.position ?? '',
            email: contact.email ?? '',
            phone: contact.phone,
            phoneCountry: contact.phoneCountry,
            isPrimary: contact.isPrimary,
            notes: contact.notes ?? '',
          }
        : EMPTY,
    );
  }, [contact, isOpen, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (contact) {
        await updateContact.mutateAsync({ id: customerId, contactId: contact.id, data: values });
      } else {
        await addContact.mutateAsync({ id: customerId, data: values });
      }
      await queryClient.invalidateQueries({ queryKey: getCustomersFindOneQueryKey(customerId) });
      onClose();
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[440px]">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>{contact ? t('contacts.edit') : t('contacts.add')}</DialogTitle>
        </DialogHeader>
        {/* Форма і є body діалогу: скрол тільки тут, хедер лишається на місці */}
        <form
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
        >
          <FieldGroup>
            <FormTextField control={control} name="name" label={t('contacts.name')} />
            <FormTextField
              control={control}
              name="position"
              label={t('contacts.position')}
              placeholder={t('contacts.positionPlaceholder')}
            />
            <FormTextField
              control={control}
              name="email"
              label={t('contacts.email')}
              type="email"
            />
            <FormPhoneField
              control={control}
              name="phone"
              label={t('contacts.phone')}
              countryValue={watch('phoneCountry')}
              onCountryChange={(code) => {
                setValue('phoneCountry', code, { shouldDirty: true });
              }}
            />
            <Field orientation="horizontal">
              <FieldLabel htmlFor="contact-primary">{t('contacts.makePrimary')}</FieldLabel>
              {/* Прапорець знімається зі старого основного сервером — інакше
                  частковий унікальний індекс віддав би 409 замість очікуваної дії */}
              <Switch
                id="contact-primary"
                checked={watch('isPrimary') ?? false}
                onCheckedChange={(checked) => {
                  setValue('isPrimary', checked, { shouldDirty: true });
                }}
              />
            </Field>
            <FormTextareaField
              control={control}
              name="notes"
              label={t('contacts.notes')}
              rows={3}
            />
          </FieldGroup>

          {errors.root?.server && (
            <p className="text-sm text-destructive">{errors.root.server.message}</p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose render={<Button variant="secondary" />}>
              {t('contacts.cancel')}
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('contacts.submitting') : t('contacts.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
