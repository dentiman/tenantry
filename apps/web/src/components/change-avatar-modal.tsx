import { useState } from 'react';
import { Avatar, Label, Modal, ProgressBar } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FILE_MAX_SIZE_BYTES, IMAGE_MIME_TYPES } from '@saas-skeleton/contracts';
import { getUsersFindAllQueryKey, useUsersUpdate } from '../api/generated/api';
import type { UserListResponseDtoOutputItemsItem } from '../api/generated/model/userListResponseDtoOutputItemsItem';
import { parseApiError } from '../api/api-error';
import { FileDropzone, useFileUpload } from './file-upload';

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
    <Modal.Backdrop isOpen={user !== null} onOpenChange={close}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[420px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t('avatar.heading')}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4">
            {user && (
              <div className="flex items-center gap-3">
                <Avatar size="lg">
                  {user.avatarUrl && <Avatar.Image alt={user.email} src={user.avatarUrl} />}
                  <Avatar.Fallback>{initials(user.name ?? user.email)}</Avatar.Fallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{user.email}</p>
                  <p className="text-sm text-muted">{t('avatar.description')}</p>
                </div>
              </div>
            )}

            {isBusy ? (
              <ProgressBar
                aria-label={t('avatar.uploading')}
                className="w-full"
                {...(state.status === 'uploading'
                  ? { value: state.progress }
                  : { isIndeterminate: true })}
              >
                <Label>
                  {state.status === 'uploading' ? t('avatar.uploading') : t('avatar.saving')}
                </Label>
                <ProgressBar.Output />
                <ProgressBar.Track>
                  <ProgressBar.Fill />
                </ProgressBar.Track>
              </ProgressBar>
            ) : (
              <FileDropzone
                accept={IMAGE_MIME_TYPES}
                maxSizeBytes={FILE_MAX_SIZE_BYTES}
                onSelect={(f) => {
                  void handleSelect(f);
                }}
              />
            )}

            {state.status === 'error' && <p className="text-sm text-danger">{state.message}</p>}
            {saveError && <p className="text-sm text-danger">{saveError}</p>}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function initials(nameOrEmail: string): string {
  return nameOrEmail
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
