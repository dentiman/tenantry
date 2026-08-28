import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { UploadIcon } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from '@saas-skeleton/ui/components/ui/empty';

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
 * Dropzone: клік або drag&drop одного файлу; тип і розмір валідуються локально
 * (авторитетна перевірка — на бекенді), помилка показується під зоною.
 *
 * Компонента дропзони в реєстрі shadcn немає, тож він лишається власним — але
 * оболонку дає `Empty`, а клік бере справжня `Button`, тому попереднього костиля
 * `role="button"` + `tabIndex` + `onKeyDown` на `<div>` більше немає: фокус,
 * Enter/Space і `disabled` приходять від нативної кнопки
 * (знятий role="button" на div — docs/frontend/ui-migration-history.md §4).
 */
export function FileDropzone({
  accept,
  maxSizeBytes,
  onSelect,
  isDisabled,
  prompt,
}: FileDropzoneProps) {
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

  return (
    <div className="flex flex-col gap-2">
      <Empty
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => {
          setIsDragOver(false);
        }}
        onDrop={onDrop}
        className={`border-2 border-dashed p-6 transition-colors ${
          isDragOver ? 'border-foreground bg-accent' : 'border-border'
        } ${isDisabled ? 'opacity-50' : ''}`}
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UploadIcon />
          </EmptyMedia>
          <EmptyDescription>{prompt ?? t('dropzone.prompt')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isDisabled}
            onClick={openPicker}
          >
            {t('dropzone.choose')}
          </Button>
        </EmptyContent>
      </Empty>
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
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
