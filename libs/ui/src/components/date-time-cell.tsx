import { formatDate, formatTime } from '@saas-skeleton/ui/lib/format';
import { cn } from '@saas-skeleton/ui/lib/utils';

interface DateTimeCellProps {
  /** ISO-рядок із API; null/невалідний — прочерк */
  value?: string | null;
  className?: string;
}

/**
 * Момент часу в комірці списку: дата зверху, час під нею.
 *
 * Стандартна форма для колонок «Created», «Started», «Completed» в УСІХ грідах
 * обох фронтів — тому компонент у пакеті, а не в застосунку. До цього те саме
 * значення показувалось трьома різними способами: у tenant-грідах лише дата
 * (час губився зовсім), у `/jobs` — дата й час одним рядком, а на картках —
 * `formatDateTime`. Один компонент прибирає і розбіжність, і вибір на місці.
 *
 * Рішення:
 * - **Два рядки, а не один**: `2026-09-09 14:30` в одному рядку читається як
 *   технічна позначка з лога і з'їдає ширину колонки; розкладені по рядках
 *   дата й час дають одне й те саме значення в удвічі вужчій колонці.
 * - **Кегль на щабель менший** (`text-xs`): у рядку списку це метадані, а не
 *   зміст. Той самий хід, що в другому рядку `UserIdentity`.
 * - **Дві сходинки сірого, а не один колір**: дата — `foreground/80` (ледь
 *   тихіше за основний текст, бо саме її шукають оком), час — повний
 *   `muted-foreground`. Однаковий колір злив би рядки в один блок, а
 *   `muted-foreground` на обох зробив би колонку нечитабельною.
 */
export function DateTimeCell({ value, className }: DateTimeCellProps) {
  const date = formatDate(value);
  if (date === '—') {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <span className={cn('flex flex-col text-xs leading-tight tabular-nums', className)}>
      <span className="text-foreground/80">{date}</span>
      <span className="text-muted-foreground">{formatTime(value)}</span>
    </span>
  );
}
