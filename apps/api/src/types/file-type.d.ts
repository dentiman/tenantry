/**
 * file-type — ESM-only з types, які не резолвляться під moduleResolution=node10
 * (та сама категорія, що pg-boss, див. критичне правило 8 у CLAUDE.md). Runtime ок:
 * Node 24 вміє require(esm). Декларуємо вручну єдину використовувану функцію;
 * зникне з переходом на moduleResolution node16/bundler.
 */
declare module 'file-type' {
  export interface FileTypeResult {
    ext: string;
    mime: string;
  }
  export function fileTypeFromBuffer(
    buffer: Uint8Array | ArrayBuffer,
  ): Promise<FileTypeResult | undefined>;
}
