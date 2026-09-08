import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@saas-skeleton/ui/components/ui/dialog';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreateUserSchema, type CreateUser } from '@saas-skeleton/contracts';
import { getUsersFindAllQueryKey, useUsersCreate } from '../api/generated/api';
import {
  applyServerError,
  FormPasswordField,
  FormPhoneField,
  FormSelect,
  FormTextField,
} from './form';

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
    // Повні defaultValues — вимога applyServerError: він звіряє імена полів із getValues
    defaultValues: {
      email: '',
      name: '',
      role: 'USER',
      phone: null,
      phoneCountry: null,
      password: '',
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
    <Dialog open={isOpen} onOpenChange={close}>
      {/* size="sm" — метрика ЗОНИ ДІЙ хедера: там кнопка стоїть в одному ряду з
          дзвінком і перемикачем теми, і повні 36px робили б її вищою за сусідів */}
      <DialogTrigger render={<Button size="sm" />}>
        {t('create.trigger')}
        <UserPlus />
      </DialogTrigger>
      <DialogContent className="flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[420px]">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>{t('create.heading')}</DialogTitle>
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
            <FormSelect
              control={control}
              name="role"
              label={t('create.role')}
              options={roleOptions}
            />
            <FormPhoneField
              control={control}
              name="phone"
              label={t('create.phone')}
              // placeholder свідомо не задаємо: поле саме показує приклад номера
              // обраної країни, і він змінюється разом із прапором
              countryValue={form.watch('phoneCountry')}
              // Пара phone/phoneCountry зшивається тут: поле володіє номером,
              // форма — вибраною країною (сервер бере її як є, не переґадуючи з +1)
              onCountryChange={(code) => {
                setValue('phoneCountry', code, { shouldDirty: true });
              }}
            />
            <FormPasswordField
              control={control}
              name="password"
              label={t('create.password')}
              autoComplete="new-password"
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
