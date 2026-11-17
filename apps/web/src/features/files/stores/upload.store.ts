import axios from 'axios';
import i18n from 'i18next';
import { create } from 'zustand';
import { parseApiError } from '@saas-skeleton/ui/api/api-error';
import { filesComplete, filesCreate } from '../../../api/generated/api';
import type { CreateFileUploadDtoMimeType } from '../../../api/generated/model/createFileUploadDtoMimeType';
import type { FileResponseDtoOutput } from '../../../api/generated/model/fileResponseDtoOutput';
import { useActivityStore } from '../../../lib/activity';
import { createLeaveGuard, toActivityItem, type UploadStepKey } from '../lib/upload-activity';
import {
  createUploadQueue,
  isActiveUpload,
  type UploadEntry,
  type UploadTransport,
} from '../lib/upload-queue';

export type FileUploadEntry = UploadEntry<File, FileResponseDtoOutput>;
export type FileUploadTransport = UploadTransport<File, FileResponseDtoOutput>;

/**
 * Двофазний upload (зафіксований флоу файлової підсистеми, docs/file-storage.md):
 * POST /files → PENDING + presigned PUT → байти напряму в сховище (минаючи API) →
 * POST /files/:id/complete → READY.
 */
const apiTransport: FileUploadTransport = {
  create: async (file, signal) => {
    const { file: created, uploadUrl } = await filesCreate(
      {
        filename: file.name,
        // Реальну відповідність вмісту заявленому MIME перевіряє бекенд по magic bytes
        mimeType: file.type as CreateFileUploadDtoMimeType,
        size: file.size,
      },
      undefined,
      signal,
    );
    return { id: created.id, uploadUrl };
  },
  put: async (uploadUrl, file, { signal, onProgress }) => {
    // Сирий axios без інтерсепторів: авторизація зашита в підпис presigned URL,
    // Bearer-заголовок чужому origin-у не потрібен і не має туди витікати
    await axios.put(uploadUrl, file, {
      headers: { 'Content-Type': file.type },
      signal,
      onUploadProgress: (event) => {
        onProgress(event.loaded, event.total ?? file.size);
      },
    });
  },
  complete: (id, signal) => filesComplete(id, undefined, signal),
  describeError: (error) => parseApiError(error).message,
};

interface UploadState {
  uploads: readonly FileUploadEntry[];
}

/** Знімок черги для React. Змінює його лише сама черга (`onChange` нижче) */
export const useUploadStore = create<UploadState>()(() => ({ uploads: [] }));

const stepLabel = (key: UploadStepKey): string => i18n.t(`common:uploads.steps.${key}`);

const syncLeaveGuard =
  typeof window === 'undefined' ? (): void => undefined : createLeaveGuard(window);

/**
 * Єдина черга завантажень застосунку — поза деревом сторінок, тому завантаження переживає
 * навігацію й закриття діалогу, з якого його почали. Кожна зміна йде у два місця: у стор
 * (для `useFileUpload`) і в реєстр активності (для лотка в шелі).
 */
export const uploadQueue = createUploadQueue<File, FileResponseDtoOutput>({
  transport: apiTransport,
  onChange: (entries) => {
    const previous = useUploadStore.getState().uploads;
    useUploadStore.setState({ uploads: entries });

    const activity = useActivityStore.getState();
    const alive = new Set(entries.map((entry) => entry.id));
    for (const gone of previous) {
      if (!alive.has(gone.id)) {
        activity.remove(gone.id);
      }
    }
    for (const entry of entries) {
      // Посилання на запис міняється лише разом із ним — незмінені не чіпаємо
      if (!previous.includes(entry)) {
        activity.upsert(toActivityItem(entry, uploadQueue, stepLabel));
      }
    }
    syncLeaveGuard(entries.filter((entry) => isActiveUpload(entry.phase)).length);
  },
});
