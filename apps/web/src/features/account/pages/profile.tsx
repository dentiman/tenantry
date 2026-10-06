import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  FILE_MAX_SIZE_BYTES,
  IMAGE_MIME_TYPES,
  UpdateAccountProfileSchema,
  type UpdateAccountProfile,
  type UserResponse,
} from '@saas-skeleton/contracts';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { Progress, ProgressLabel, ProgressValue } from '@saas-skeleton/ui/components/ui/progress';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { parseApiError } from '@saas-skeleton/ui/api/api-error';
import {
  getAccountGetProfileQueryKey,
  useAccountGetProfile,
  useAccountUpdateProfile,
} from '../../../api/generated/api';
import { ContentSection } from '../../../components/section/content-section';
import { FileDropzone, useFileUpload } from '../../files/components/file-upload';
import { applyServerError, FormPhoneField, FormSelect, FormTextField } from '../../../components/form';
import { useAuthStore } from '../../auth/stores/auth.store';
import { SettingsStatus } from './status';

/**
 * Профіль: те, що юзер міняє собі сам. Роль, статус і email сюди не входять —
 * їх контракт `/account/profile` навіть не приймає (див. UpdateAccountProfileSchema).
 */
export function UserSettingsProfilePage() {
  const { t } = useTranslation('user-settings');
  const { data, isPending, isError } = useAccountGetProfile();

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/user-settings' }, { label: t('profile.title') }]}
        subtitle={t('profile.description')}
      />
      <SettingsStatus isPending={isPending} isError={isError || !data}>
        {data && (
          <div className="flex flex-col gap-6">
            <AvatarSection user={data} />
            <Separator />
            {/* key — форма перемонтовується разом зі зміною юзера: defaultValues
                читаються один раз, і без цього після оновлення лишились би старі */}
            <ProfileForm key={data.updatedAt} user={data} />
          </div>
        )}
      </SettingsStatus>
    </ContentSection>
  );
}

/** Спільне для обох блоків: оновити кеш /account і шапку сесії однією відповіддю */
function useProfileSync() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);

  return (user: UserResponse): void => {
    setUser(user);
    void queryClient.invalidateQueries({ queryKey: getAccountGetProfileQueryKey() });
  };
}

function ProfileForm({ user }: { user: UserResponse }) {
  const { t } = useTranslation('user-settings');
  const sync = useProfileSync();
  const updateProfile = useAccountUpdateProfile();

  const form = useForm<UpdateAccountProfile>({
    resolver: zodResolver(UpdateAccountProfileSchema),
    // Повні defaultValues — вимога applyServerError (звіряє імена полів із getValues)
    defaultValues: {
      name: user.name ?? '',
      phone: user.phone,
      phoneCountry: user.phoneCountry,
      locale: user.locale,
      timeZone: user.timeZone,
    },
  });
  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, isDirty, errors },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const updated = await updateProfile.mutateAsync({
        data: { ...values, name: values.name?.trim() ? values.name.trim() : null },
      });
      sync(updated);
      toast.add({ type: 'success', title: t('profile.saved') });
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
      <FieldGroup>
        <FormTextField
          control={control}
          name="name"
          label={t('profile.name')}
          placeholder={t('profile.namePlaceholder')}
        />
        <FormPhoneField
          control={control}
          name="phone"
          label={t('profile.phone')}
          countryValue={form.watch('phoneCountry')}
          // Пара phone/phoneCountry зшивається тут — так само, як у create-user
          onCountryChange={(code) => {
            setValue('phoneCountry', code, { shouldDirty: true });
          }}
        />
        <FormSelect
          control={control}
          name="locale"
          label={t('profile.language')}
          // Мов поки одна; список свідомо тут, а не в contracts — це підписи UI
          options={[{ id: 'en', label: 'English' }]}
        />
        {/* Таймзона — атрибут ПРОФІЛЮ, поруч із локаллю: обидві їдуть за
            людиною, якщо вона змінить компанію. Порожнє поле = «як в
            організації», тому окремої особистої секції «Calendar» під одне
            поле не заводимо (docs/calendar.md §9.5) */}
        <FormTextField
          control={control}
          name="timeZone"
          label={t('profile.timeZone')}
          placeholder={t('profile.timeZonePlaceholder')}
          description={t('profile.timeZoneHint')}
        />
      </FieldGroup>
      <p className="text-sm text-muted-foreground">{t('profile.languageHint')}</p>

      {errors.root?.server && (
        <p className="text-sm text-destructive">{errors.root.server.message}</p>
      )}

      <div>
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Аватар. Той самий двофазний presigned-флоу, що в адмінській `ChangeAvatarModal`,
 * але без модалки і через self-service мутацію — тут людина міняє СВІЙ файл.
 */
function AvatarSection({ user }: { user: UserResponse }) {
  const { t } = useTranslation('user-settings');
  const sync = useProfileSync();
  const updateProfile = useAccountUpdateProfile();
  const { state, upload, reset } = useFileUpload();
  const [isPicking, setIsPicking] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isBusy =
    state.status === 'uploading' || state.status === 'processing' || updateProfile.isPending;

  const save = async (avatarFileId: string | null): Promise<void> => {
    setSaveError(null);
    try {
      sync(await updateProfile.mutateAsync({ data: { avatarFileId } }));
      setIsPicking(false);
      reset();
    } catch (error) {
      // 5xx/network підхопить глобальний toast; тут — локальний fallback для 4xx
      setSaveError(parseApiError(error).message || t('profile.avatar.saveFailed'));
    }
  };

  const handleSelect = async (selected: File): Promise<void> => {
    const ready = await upload(selected);
    if (ready) {
      await save(ready.id);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <UserIdentity
          id={user.id}
          email={user.email}
          name={user.name}
          avatarUrl={user.avatarUrl}
          size="lg"
        />
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              setIsPicking((open) => !open);
            }}
          >
            {t('profile.avatar.change')}
          </Button>
          {user.avatarFileId && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={() => {
                void save(null);
              }}
            >
              {t('profile.avatar.remove')}
            </Button>
          )}
        </div>
      </div>

      {isBusy ? (
        <Progress
          aria-label={t('profile.avatar.uploading')}
          value={state.status === 'uploading' ? state.progress : null}
        >
          <ProgressLabel>
            {state.status === 'uploading'
              ? t('profile.avatar.uploading')
              : t('profile.avatar.saving')}
          </ProgressLabel>
          <ProgressValue className="ml-auto" />
        </Progress>
      ) : (
        isPicking && (
          <FileDropzone
            accept={IMAGE_MIME_TYPES}
            maxSizeBytes={FILE_MAX_SIZE_BYTES}
            onSelect={(file) => {
              void handleSelect(file);
            }}
          />
        )
      )}

      <p className="text-sm text-muted-foreground">{t('profile.avatar.description')}</p>
      {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
      {saveError && <p className="text-sm text-destructive">{saveError}</p>}
    </div>
  );
}
