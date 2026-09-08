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
import { KIND_LINE_WIDTH, KIND_STYLES } from './event-kind';
import type { SpanSegment } from './layout-spans';
import { EventPeekContent } from './event-peek';
import type { DragMode } from './use-event-drag';

/**
 * Закруглення за сегментом смуги. Порожнього варіанта немає навмисно: `full`
 * теж мусить бути в таблиці, інакше одноденна плитка залежала б від дефолту в
 * базових класах — і будь-яка зміна там тихо ламала б смуги.
 */
const SEGMENT_CLASSES: Record<SpanSegment, string> = {
  full: 'rounded-sm',
  start: 'rounded-l-sm',
  middle: 'rounded-none',
  end: 'rounded-r-sm',
};

interface EventChipProps {
  event: CalendarEventResponse;
  timeZone: string;
  /** Перетягування (CAL-2). Немає — плитка нерухома, як у місяці й агенді */
  onDragStart?: (pointer: React.PointerEvent, mode: DragMode) => void;
  /** Тягнуть саму цю плитку: підіймаємо над сусідами і додаємо тінь */
  isDragging?: boolean;
  /** `absolute` — у сітці часу; `inline` — у клітинці місяця й у списку */
  variant?: 'absolute' | 'inline';
  /**
   * Частина багатоденної смуги. Кути закруглюються лише там, де подія СПРАВДІ
   * починається чи закінчується: рівний край читається як «продовжується за
   * межу вікна» (`layout-spans.ts`).
   */
  segment?: SpanSegment;
  /**
   * Смуга в календарі днів (all-day рядок тижня, ряд місяця) — тоді краї
   * тягнуться ГОРИЗОНТАЛЬНО і міняють ДАТИ. Ручка малюється лише на тому краю,
   * який справді є краєм події: у сегменті `middle` тягнути нічого
   */
  spanResize?: boolean;
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
  segment = 'full',
  spanResize = false,
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
  // 403 уже після того, як плитка «переїхала» під курсором.
  // Варіант плитки тут НЕ при чому: у місяці плитки `inline`, і їх теж
  // переносять — просто зсув там міряється днями, а не хвилинами
  const isDraggable = onDragStart !== undefined && event.canEdit;
  // Ручки тривалості — лише в часовій сітці: у місяці немає координати години,
  // тягнути «нижній край» нікуди
  const hasResizeHandles = isDraggable && !event.allDay && variant === 'absolute';

  /**
   * Peek — КОНТРОЛЬОВАНИЙ, і рівно з двох причин:
   * 1. під час перетягування картка мусить зникнути — інакше вона висить над
   *    плиткою, яка вже поїхала, і показує старий час;
   * 2. клік відкриває панель події, а картка по наведенню лишалась би позаду неї.
   */
  const [isPeekOpen, setPeekOpen] = useState(false);

  const kindStyle = KIND_STYLES[event.kind];
  // Смужка = «подія починається тут». У сегментах `middle`/`end` початок лежить
  // за межею вікна, тому носієм кольору лишається сама заливка
  const hasLine = segment === 'full' || segment === 'start';

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
        'relative flex w-full flex-col overflow-hidden py-0.5 pr-1.5 text-left text-xs transition-colors',
        SEGMENT_CLASSES[segment],
        // Відступ ліворуч тримає смужку; там, де смуги немає (продовження
        // смуги з попереднього вікна), він зайвий
        hasLine ? 'pl-2.5' : 'pl-1.5',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        // Заливка — прямо на кнопці. Спершу вона лежала окремим шаром із
        // `-z-10`, і в сітці плитка виглядала ПОРОЖНЬОЮ: у кнопки немає свого
        // стекового контексту, тож негативний z-index провалював шар під фон
        // колонки дня. Окремий шар тут узагалі не потрібен — на відміну від
        // Notion, наші заливки непрозорі, і підкладку їм підміняти нічим
        kindStyle.bg,
        kindStyle.bgHover,
        kindStyle.text,
        variant === 'absolute' && 'absolute',
        isDraggable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'z-30 shadow-lg ring-2 ring-primary/40',
        // Немає відповіді — плитка контурна: «я ще не сказав, чи буду» мусить
        // бути видно без відкривання картки. Рамка тут ЄДИНИЙ випадок, коли
        // плитка її має, тому й `border` живе в цій умові, а не в базі
        isPending && 'border border-dashed border-current',
        (isCancelled || isDeclined) && 'opacity-60',
      )}
    >
      {/* Смужка типу — той самий носій, що ліва межа рядка в агенді. У
          продовженні багатоденної смуги її немає: там лівий край не є початком
          події, і маркер брехав би */}
      {hasLine && (
        <span
          aria-hidden="true"
          className={cn('absolute inset-y-0 left-0 rounded-l-sm', KIND_LINE_WIDTH, kindStyle.line)}
        />
      )}
      <span className={cn('flex items-center gap-1 truncate font-medium', isCancelled && 'line-through')}>
        {event.visibility === 'PRIVATE' && <LockIcon className="size-3 shrink-0" />}
        {event.kind === 'CALL' && <VideoIcon className="size-3 shrink-0" />}
        <span className="truncate">{event.title}</span>
      </span>
      {!event.allDay && variant === 'absolute' && !compact && (
        <span className="truncate opacity-80">{formatTime(event.startsAt, timeZone)}</span>
      )}
      {/* Ручки тривалості — ДВІ: верхня рухає початок, нижня кінець («почалось
          раніше» трапляється не рідше, ніж «затягнулось»). `div` у `button` —
          легально (phrasing-контент не порушено), а `stopPropagation`
          обовʼязковий: без нього той самий pointerdown спершу почав би ПЕРЕНОС
          плитки. Обидві ручки видно лише на наведення — у сітці по тридцять
          плиток, і постійні смужки читались би як частина розмітки */}
      {/* Краї смуги: тягнуться по горизонталі й міняють дати. Ручка є лише там,
          де подія справді починається/закінчується — у продовженні смуги
          (`middle`, і відповідний край у `start`/`end`) її немає */}
      {isDraggable && spanResize && (
        <>
          {(segment === 'full' || segment === 'start') && (
            <div
              role="presentation"
              onPointerDown={(pointer) => {
                pointer.stopPropagation();
                setPeekOpen(false);
                onDragStart(pointer, 'resize-start');
              }}
              className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize opacity-0 hover:opacity-100"
            >
              <div className="my-auto h-3 w-0.5 rounded-full bg-current" />
            </div>
          )}
          {(segment === 'full' || segment === 'end') && (
            <div
              role="presentation"
              onPointerDown={(pointer) => {
                pointer.stopPropagation();
                setPeekOpen(false);
                onDragStart(pointer, 'resize-end');
              }}
              className="absolute inset-y-0 right-0 flex w-1.5 cursor-ew-resize items-center opacity-0 hover:opacity-100"
            >
              <div className="mx-auto h-3 w-0.5 rounded-full bg-current" />
            </div>
          )}
        </>
      )}
      {hasResizeHandles && (
        <>
          <div
            role="presentation"
            onPointerDown={(pointer) => {
              pointer.stopPropagation();
              setPeekOpen(false);
              onDragStart(pointer, 'resize-start');
            }}
            className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize opacity-0 hover:opacity-100"
          >
            <div className="mx-auto h-0.5 w-6 rounded-full bg-current" />
          </div>
          <div
            role="presentation"
            onPointerDown={(pointer) => {
              pointer.stopPropagation();
              setPeekOpen(false);
              onDragStart(pointer, 'resize-end');
            }}
            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 hover:opacity-100"
          >
            <div className="mx-auto h-0.5 w-6 rounded-full bg-current" />
          </div>
        </>
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
