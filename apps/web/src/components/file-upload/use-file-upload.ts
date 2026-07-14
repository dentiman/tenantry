import { useCallback, useState } from 'react';
import axios from 'axios';
import { filesComplete, filesCreate } from '../../api/generated/api';
import type { FileResponseDtoOutput } from '../../api/generated/model/fileResponseDtoOutput';
import type { CreateFileUploadDtoMimeType } from '../../api/generated/model/createFileUploadDtoMimeType';
import { parseApiError } from '../../api/api-error';

export type FileUploadState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'processing' }
  | { status: 'done'; file: FileResponseDtoOutput }
  | { status: 'error'; message: string };

/**
 * Двофазний upload (зафіксований флоу файлової підсистеми):
 * POST /files → PENDING + presigned PUT → байти напряму в сховище (минаючи API) →
 * POST /files/:id/complete → READY. Повертає null при помилці — стан у state.
 */
export function useFileUpload() {
  const [state, setState] = useState<FileUploadState>({ status: 'idle' });

  const upload = useCallback(async (file: File): Promise<FileResponseDtoOutput | null> => {
    setState({ status: 'uploading', progress: 0 });
    try {
      const { file: created, uploadUrl } = await filesCreate({
        filename: file.name,
        // Реальну відповідність вмісту заявленому MIME перевіряє бекенд по magic bytes
        mimeType: file.type as CreateFileUploadDtoMimeType,
        size: file.size,
      });
      // Сирий axios без інтерсепторів: авторизація зашита в підпис presigned URL,
      // Bearer-заголовок чужому origin-у не потрібен і не має туди витікати
      await axios.put(uploadUrl, file, {
        headers: { 'Content-Type': file.type },
        onUploadProgress: (event) => {
          const progress = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
          setState({ status: 'uploading', progress });
        },
      });
      setState({ status: 'processing' });
      const ready = await filesComplete(created.id);
      setState({ status: 'done', file: ready });
      return ready;
    } catch (error) {
      setState({ status: 'error', message: parseApiError(error).message });
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return { state, upload, reset };
}
