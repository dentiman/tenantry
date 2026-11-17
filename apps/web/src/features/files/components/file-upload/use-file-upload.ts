import { useCallback, useState } from 'react';
import type { FileResponseDtoOutput } from '../../../../api/generated/model/fileResponseDtoOutput';
import { uploadQueue, useUploadStore, type FileUploadEntry } from '../../stores/upload.store';

export type FileUploadState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'processing' }
  | { status: 'done'; file: FileResponseDtoOutput }
  | { status: 'error'; message: string };

/** Стан одного завантаження з черги, як його бачить екран, що чекає на файл */
export function toFileUploadState(entry: FileUploadEntry | undefined): FileUploadState {
  switch (entry?.phase) {
    case undefined:
    case 'canceled':
      // Скасування — не помилка: екран повертається до вибору файлу
      return { status: 'idle' };
    case 'queued':
    case 'preparing':
      return { status: 'uploading', progress: 0 };
    case 'transferring':
      return {
        status: 'uploading',
        progress: entry.total > 0 ? Math.round((entry.loaded / entry.total) * 100) : 0,
      };
    case 'verifying':
      return { status: 'processing' };
    case 'done':
      return entry.result ? { status: 'done', file: entry.result } : { status: 'processing' };
    case 'failed':
      return { status: 'error', message: entry.errorMessage ?? '' };
  }
}

/**
 * Завантаження одного файлу для екрана, що чекає на результат. Саме завантаження живе в черзі
 * застосунку (`stores/upload.store.ts`): воно триває, якщо екран закрили, і видно в лотку
 * активності. Хук — лише погляд на свій запис у черзі; API той самий, що до черги.
 *
 * `upload` повертає null при помилці або скасуванні — причина в `state`.
 */
export function useFileUpload() {
  const [uploadId, setUploadId] = useState<string | null>(null);
  // Підсумок тримаємо окремо: успішний запис зникає з черги за кілька секунд, а екран
  // мусить і далі бачити `done`
  const [settled, setSettled] = useState<FileUploadState | null>(null);
  const entry = useUploadStore((state) =>
    uploadId === null ? undefined : state.uploads.find((upload) => upload.id === uploadId),
  );

  const upload = useCallback(async (file: File): Promise<FileResponseDtoOutput | null> => {
    setSettled(null);
    const handle = uploadQueue.add(file);
    setUploadId(handle.id);
    const outcome = await handle.done;
    if (outcome.status === 'done') {
      setSettled({ status: 'done', file: outcome.result });
      return outcome.result;
    }
    setSettled(
      outcome.status === 'failed'
        ? { status: 'error', message: outcome.message }
        : { status: 'idle' },
    );
    return null;
  }, []);

  /** Відвʼязати екран від завантаження; сам запис лишається в черзі й лотку */
  const reset = useCallback(() => {
    setUploadId(null);
    setSettled(null);
  }, []);

  const state: FileUploadState = settled ?? toFileUploadState(entry);
  return { state, upload, reset };
}
