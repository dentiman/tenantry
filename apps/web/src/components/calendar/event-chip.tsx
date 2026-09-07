import { LockIcon, VideoIcon } from 'lucide-react';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { formatTime } from '../../lib/calendar-date';

/**
 * Колір несе ТИП події (`kind`), а не персональний вибір: інакше в тенанті за
 * пів року буде 40 подій вісьмома відтінками без жодної системи
 * (docs/calendar.md §5.1). Токени — семантичні, тому обидві теми працюють самі.
 */
const KIND_CLASSES: Record<CalendarEventResponse['kind'], string> = {
  MEETING: 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/15',
  CALL: 'bg-success/10 text-success border-success/30 hover:bg-success/15',
  DEADLINE: 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/15',
  OUT_OF_OFFICE: 'bg-warning/10 text-warning border-warning/30 hover:bg-warning/15',
  OTHER: 'bg-muted text-muted-foreground border-border hover:bg-accent',
};

interface EventChipProps {
  event: CalendarEventResponse;
  timeZone: string;
  /** Перетягування (CAL-2). Немає — плитка нерухома, як у місяці й агенді */
  onDragStart?: (pointer: React.PointerEvent, mode: 'move' | 'resize') => void;
  /** Тягнуть саму цю плитку: підіймаємо над сусідами і додаємо тінь */
  isDragging?: boolean;
  /** `absolute` — у сітці часу; `inline` — у клітинці місяця й у списку */
  variant?: 'absolute' | 'inline';
  /**
   * Плитка надто низька для двох рядків — тоді час не показуємо. Спіймано в
   * браузері: у 30-хвилинної події (24px при годині 48px) другий рядок
   * обрізався навпіл. Висоту знає сітка, а не плитка, тому це проп
   */
  compact?: boolean;
  style?: React.CSSProperties;
  /**
   * `fromKeyboard` — активація з Enter/Space, а не мишею. Сітка на ній НЕ
   * перевіряє «а це не хвіст перетягування?»: pointer-жесту не було взагалі
   */
  onSelect: (event: CalendarEventResponse, fromKeyboard: boolean) => void;
}

export function EventChip({
  event,
  timeZone,
  variant = 'inline',
  compact = false,
  style,
  onSelect,
  onDragStart,
  isDragging = false,
}: EventChipProps) {
  const isCancelled = event.status === 'CANCELLED';
  // Не відповів — плитка контурна: «я ще не сказав, чи буду» мусить бути видно
  // без відкривання картки
  const isPending = event.myResponse === 'NEEDS_ACTION';
  const isDeclined = event.myResponse === 'DECLINED';

  // Тягнути можна лише те, що дозволено змінювати: інакше сервер відповів би
  // 403 уже після того, як плитка «переїхала» під курсором
  const isDraggable = onDragStart !== undefined && event.canEdit && variant === 'absolute';

  return (
    <button
      type="button"
      style={style}
      // За цим атрибутом сітка відрізняє натискання по плитці від натискання по
      // порожньому місцю: створення протягуванням слухає pointerdown на всій
      // колонці дня, і без маркера почалось би поверх наявної події
      data-calendar-chip=""
      onPointerDown={
        isDraggable
          ? (pointer) => {
              onDragStart(pointer, 'move');
            }
          : undefined
      }
      onClick={(clickEvent) => {
        // `detail === 0` буває рівно у клавіатурної активації: мишачий клік
        // завжди несе номер натискання
        onSelect(event, clickEvent.detail === 0);
      }}
      // aria-label несе і час, і назву: у сітці візуальний контекст дає позиція,
      // а скрінрідер її не бачить
      aria-label={`${event.allDay ? '' : `${formatTime(event.startsAt, timeZone)} `}${event.title}`}
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-xs transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        KIND_CLASSES[event.kind],
        variant === 'absolute' && 'absolute',
        isDraggable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'z-30 shadow-lg ring-2 ring-primary/40',
        isPending && 'border-dashed',
        (isCancelled || isDeclined) && 'opacity-60',
      )}
    >
      <span className={cn('flex items-center gap-1 truncate font-medium', isCancelled && 'line-through')}>
        {event.visibility === 'PRIVATE' && <LockIcon className="size-3 shrink-0" />}
        {event.kind === 'CALL' && <VideoIcon className="size-3 shrink-0" />}
        <span className="truncate">{event.title}</span>
      </span>
      {!event.allDay && variant === 'absolute' && !compact && (
        <span className="truncate opacity-80">{formatTime(event.startsAt, timeZone)}</span>
      )}
      {/* Ручка тривалості. `div` у `button` — легально (phrasing-контент не
          порушено), а `stopPropagation` обовʼязковий: без нього той самий
          pointerdown спершу почав би ПЕРЕНОС плитки */}
      {isDraggable && !event.allDay && (
        <div
          role="presentation"
          onPointerDown={(pointer) => {
            pointer.stopPropagation();
            onDragStart(pointer, 'resize');
          }}
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 hover:opacity-100"
        >
          <div className="mx-auto h-0.5 w-6 rounded-full bg-current" />
        </div>
      )}
    </button>
  );
}
