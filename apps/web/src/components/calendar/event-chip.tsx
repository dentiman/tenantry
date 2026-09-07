import { useState } from 'react';
import { LockIcon, VideoIcon } from 'lucide-react';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@saas-skeleton/ui/components/ui/hover-card';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { formatTime } from '../../lib/calendar-date';
import { EventContextMenu, type EventIntent } from './event-context-menu';
import { EventPeekContent } from './event-peek';

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
  /** Картка по наведенню; вимикається там, де поруч уже видно все (напр. агенда) */
  peek?: boolean;
  /** Контекстне меню на правий клік; немає обробника — немає й меню */
  onIntent?: (event: CalendarEventResponse, intent: EventIntent) => void;
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
  peek = true,
  onIntent,
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

  /**
   * Peek — КОНТРОЛЬОВАНИЙ, і рівно з двох причин:
   * 1. під час перетягування картка мусить зникнути — інакше вона висить над
   *    плиткою, яка вже поїхала, і показує старий час;
   * 2. клік відкриває панель події, а картка по наведенню лишалась би позаду неї.
   */
  const [isPeekOpen, setPeekOpen] = useState(false);

  const chip = (
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
              setPeekOpen(false);
              onDragStart(pointer, 'move');
            }
          : undefined
      }
      onClick={(clickEvent) => {
        setPeekOpen(false);
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
            setPeekOpen(false);
            onDragStart(pointer, 'resize');
          }}
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 hover:opacity-100"
        >
          <div className="mx-auto h-0.5 w-6 rounded-full bg-current" />
        </div>
      )}
    </button>
  );

  /**
   * Два тригери на ОДНІЙ плитці складаються ланцюжком `render`:
   * `ContextMenuTrigger` рендерить `HoverCardTrigger`, а той — саму кнопку.
   * Обернути кнопку в `div` було не можна: у сітці вона позиціонована абсолютно,
   * і обгортка забрала б у неї геометрію.
   *
   * `HoverCardTrigger` при цьому МУСИТЬ лишитись усередині свого кореня
   * (`HoverCard` не рендерить елемента взагалі — він лише контекст), тому
   * вкладеність саме така: корінь картки → корінь меню → тригер меню → тригер
   * картки → кнопка. Спроба віддати меню вже готовий `<HoverCard>` як тригер
   * тихо загубила б `onContextMenu`: класти DOM-пропси на компонент без
   * елемента нікуди.
   */
  const trigger = peek ? (
    // `render` обовʼязковий: `PreviewCard.Trigger` за замовчуванням малює `<a>`,
    // а плитка — кнопка. Затримка 400 мс замість стокових 600: у сітці курсор
    // проходить над сусідніми плитками дорогою до потрібної, і надто швидка
    // картка блимала б, а надто повільна змушувала б чекати
    <HoverCardTrigger render={chip} delay={PEEK_DELAY_MS} />
  ) : (
    chip
  );

  const withMenu = onIntent ? (
    <EventContextMenu event={event} trigger={trigger} onIntent={onIntent} />
  ) : (
    trigger
  );

  if (!peek) {
    return withMenu;
  }

  return (
    <HoverCard
      open={isPeekOpen && !isDragging}
      onOpenChange={(next) => {
        setPeekOpen(next);
      }}
    >
      {withMenu}
      <HoverCardContent side="right" align="start" className="w-72">
        <EventPeekContent event={event} timeZone={timeZone} />
      </HoverCardContent>
    </HoverCard>
  );
}

/** Скільки тримати курсор на плитці, щоб картка зʼявилась */
const PEEK_DELAY_MS = 400;
