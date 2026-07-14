import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface FileDropzoneProps {
  /** Allowlist MIME-типів (клієнтський фільтр; авторитетна перевірка — на бекенді) */
  accept: readonly string[];
  maxSizeBytes: number;
  onSelect: (file: File) => void;
  isDisabled?: boolean;
  /** Текст підказки; дефолт — common:dropzone.prompt */
  prompt?: string;
}

/**
 * Мінімалістичний dropzone (у HeroUI v3 компонента немає): клік або drag&drop
 * одного файлу. Валідує тип/розмір локально і показує помилку під зоною.
 */
export function FileDropzone({ accept, maxSizeBytes, onSelect, isDisabled, prompt }: FileDropzoneProps) {
  const { t } = useTranslation('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (file: File | null | undefined): void => {
    if (!file || isDisabled) {
      return;
    }
    if (!accept.includes(file.type)) {
      setError(t('dropzone.invalidType'));
      return;
    }
    if (file.size > maxSizeBytes) {
      setError(t('dropzone.tooLarge', { maxMb: Math.round(maxSizeBytes / 1024 / 1024) }));
      return;
    }
    setError(null);
    onSelect(file);
  };

  const openPicker = (): void => {
    if (!isDisabled) {
      inputRef.current?.click();
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragOver(false);
    pick(event.dataTransfer.files[0]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        aria-disabled={isDisabled}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => {
          setIsDragOver(false);
        }}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${
          isDragOver ? 'border-foreground bg-surface' : 'border-border'
        } ${isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer text-muted hover:bg-surface'}`}
      >
        {prompt ?? t('dropzone.prompt')}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          // Дозволяє вибрати той самий файл повторно після помилки
          e.target.value = '';
        }}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
