import { describe, expect, it } from 'vitest';
import type { FileResponseDtoOutput } from '../../../../api/generated/model/fileResponseDtoOutput';
import type { FileUploadEntry } from '../../stores/upload.store';
import { toFileUploadState } from './use-file-upload';

const entry = (patch: Partial<FileUploadEntry>): FileUploadEntry => ({
  id: 'u1',
  source: new File(['x'], 'photo.png', { type: 'image/png' }),
  phase: 'queued',
  loaded: 0,
  total: 200,
  retryable: false,
  startedAt: 0,
  ...patch,
});

describe('toFileUploadState', () => {
  it('a waiting or preparing upload already reads as uploading from zero', () => {
    expect(toFileUploadState(entry({ phase: 'queued' }))).toEqual({ status: 'uploading', progress: 0 });
    expect(toFileUploadState(entry({ phase: 'preparing' }))).toEqual({ status: 'uploading', progress: 0 });
  });

  it('reports the transfer as a percentage and verification as processing', () => {
    expect(toFileUploadState(entry({ phase: 'transferring', loaded: 50 }))).toEqual({
      status: 'uploading',
      progress: 25,
    });
    expect(toFileUploadState(entry({ phase: 'verifying' }))).toEqual({ status: 'processing' });
  });

  it('ends as done with the file, or as an error with its message', () => {
    const file = { id: 'f1' } as FileResponseDtoOutput;
    expect(toFileUploadState(entry({ phase: 'done', result: file }))).toEqual({ status: 'done', file });
    expect(toFileUploadState(entry({ phase: 'failed', errorMessage: 'Too large' }))).toEqual({
      status: 'error',
      message: 'Too large',
    });
  });

  it('a cancelled or forgotten upload returns the screen to idle, not to an error', () => {
    expect(toFileUploadState(entry({ phase: 'canceled' }))).toEqual({ status: 'idle' });
    expect(toFileUploadState(undefined)).toEqual({ status: 'idle' });
  });
});
