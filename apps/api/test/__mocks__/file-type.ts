/**
 * Мок file-type для e2e: пакет ESM-only і не вантажиться в Jest (та сама причина,
 * що й pg-boss, див. мок поруч). Реалізує чесний міні-детект по magic bytes для
 * форматів, що фігурують у тестах — поведінка збігається зі справжнім file-type.
 */
export interface FileTypeResult {
  ext: string;
  mime: string;
}

export function fileTypeFromBuffer(buffer: Uint8Array): Promise<FileTypeResult | undefined> {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return Promise.resolve({ ext: 'png', mime: 'image/png' });
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return Promise.resolve({ ext: 'jpg', mime: 'image/jpeg' });
  }
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return Promise.resolve({ ext: 'pdf', mime: 'application/pdf' });
  }
  return Promise.resolve(undefined);
}
