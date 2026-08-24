import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@saas-skeleton/ui/components/ui/dialog';
import { Progress, ProgressLabel, ProgressValue } from '@saas-skeleton/ui/components/ui/progress';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FILE_MAX_SIZE_BYTES, IMAGE_MIME_TYPES } from '@saas-skeleton/contracts';
import { getUsersFindAllQueryKey, useUsersUpdate } from '../api/generated/api';
import type { UserListResponseDtoOutputItemsItem } from '../api/generated/model/userListResponseDtoOutputItemsItem';
import { parseApiError } from '@saas-skeleton/ui/api/api-error';
import { FileDropzone, useFileUpload } from './file-upload';
import { UserIdentity } from './user-identity';

interface ChangeAvatarModalProps {
  /** null — модалка закрита (controlled ззовні, відкривається row action-ом гріда) */
  user: UserListResponseDtoOutputItemsItem | null;
  onClose: () => void;
}

/**
 * Демо-споживач файлової підсистеми: аватар користувача. Вибір файлу →
 * useFileUpload (двофазний presigned-флоу з прогресом) → PATCH users.avatarFileId.
 */
export function ChangeAvatarModal({ user, onClose }: ChangeAvatarModalProps) {
  const { t } = useTranslation('users');
  const queryClient = useQueryClient();
  const updateUser = useUsersUpdate();
  const { state, upload, reset } = useFileUpload();
  const [saveError, setSaveError] = useState<string | null>(null);

  const close = (open: boolean): void => {
    if (!open) {
      reset();
      setSaveError(null);
      onClose();
    }
  };

  const isBusy =
    state.status === 'uploading' || state.status === 'processing' || updateUser.isPending;

  const handleSelect = async (selected: File): Promise<void> => {
    if (!user) {
      return;
    }
    setSaveError(null);
    const ready = await upload(selected);
    if (!ready) {
      return; // повідомлення вже в state.error
    }
    try {
      await updateUser.mutateAsync({ id: user.id, data: { avatarFileId: ready.id } });
      await queryClient.invalidateQueries({ queryKey: getUsersFindAllQueryKey() });
      close(false);
    } catch (error) {
      // 5xx/network підхопить глобальний toast; тут — локальний fallback для 4xx
      setSaveError(parseApiError(error).message || t('avatar.saveFailed'));
    }
  };

  return (
    <Dialog open={user !== null} onOpenChange={close}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('avatar.heading')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {user && (
            <UserIdentity
              email={user.email}
              name={user.name}
              avatarUrl={user.avatarUrl}
              size="lg"
            />
          )}
          <p className="text-sm text-muted-foreground">{t('avatar.description')}</p>

          {isBusy ? (
            // value={null} — індетермінований стан Base UI (заливка «бігає»);
            // під час uploading показуємо реальний відсоток із useFileUpload
            <Progress
              aria-label={t('avatar.uploading')}
              value={state.status === 'uploading' ? state.progress : null}
            >
              <ProgressLabel>
                {state.status === 'uploading' ? t('avatar.uploading') : t('avatar.saving')}
              </ProgressLabel>
              <ProgressValue className="ml-auto" />
            </Progress>
          ) : (
            <FileDropzone
              accept={IMAGE_MIME_TYPES}
              maxSizeBytes={FILE_MAX_SIZE_BYTES}
              onSelect={(f) => {
                void handleSelect(f);
              }}
            />
          )}

          {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
