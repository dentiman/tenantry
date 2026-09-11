import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDaysIcon, LockIcon, PlusIcon } from 'lucide-react';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from '@saas-skeleton/ui/components/ui/avatar';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@saas-skeleton/ui/components/ui/item';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { useCalendarAgenda } from '../../api/generated/api';
import {
  dayKey,
  daysFromToday,
  formatDateLong,
  formatTime,
  formatWeekdayLong,
} from '../../lib/calendar-date';
import { EventContextMenu, type EventIntent } from './event-context-menu';
import { KIND_LINE_WIDTH, KIND_STYLES } from './event-kind';

/**
 * Agenda — «що далі». Єдиний перегляд календаря, який ходить КУРСОРНИМ
 * ендпоінтом, а не вікном: у нескінченного фіда немає ні «сторінки 7», ні межі
 * «до якого числа» (docs/calendar.md §10).
 *
 * Механіка накопичення й лінивого довантаження — та сама, що в `ActivityFeed`:
 * маркер кінця в IntersectionObserver без `root`, спостерігач перестворюється на
 * кожен новий курсор.
 *
 * Анатомія — §11.8: СПИСОК КАРТОК на полотні (форма центру сповіщень), а не
 * таблиця в рамці. Дата групи — просто текст на прозорому фоні; картка тримає
 * назву, під нею «час · тип · місце · кастомер», а тип несе кольором ліва межа
 * 3px — та сама, що смужка плитки в сітці. Peek по наведенню тут свідомо НЕМАЄ:
 * рядок агенди вже несе час, тип, місце, кастомера і гостей, тож картка
 * дублювала б сама себе. Контекстне меню — навпаки, є: дії потрібні там само,
 * де й у сітці.
 */

interface AgendaDay {
  /** `yyyy-MM-dd` у зоні глядача */
  key: string;
  /** Інстант першої події доби — з нього формуються обидві половини заголовка */
  at: string;
  events: CalendarEventResponse[];
}

/**
 * Групування по днях робиться ТУТ, а не на сервері: сервер віддає плоский фід,
 * а зона, у якій «день» починається, — властивість глядача. Групи будуються
 * заздалегідь (а не лічильником усередині `map`), бо заголовку дня потрібна
 * кількість подій — для `aria-label`.
 */
function groupByDay(events: CalendarEventResponse[], timeZone: string): AgendaDay[] {
  const days: AgendaDay[] = [];
  for (const event of events) {
    const key = dayKey(event.occurrenceStart, timeZone);
    const last = days.at(-1);
    if (last?.key === key) {
      last.events.push(event);
    } else {
      days.push({ key, at: event.occurrenceStart, events: [event] });
    }
  }
  return days;
}

export function AgendaList({
  timeZone,
  onSelect,
  onCreate,
  onIntent,
}: {
  timeZone: string;
  onSelect: (event: CalendarEventResponse) => void;
  /** Порожній фід пропонує єдину осмислену дію — завести подію */
  onCreate: () => void;
  /** Дії контекстного меню виконує сторінка (той самий контракт, що в сітці) */
  onIntent: (event: CalendarEventResponse, intent: EventIntent) => void;
}) {
  const { t } = useTranslation('calendar');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<CalendarEventResponse[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const { data, isFetching, isError } = useCalendarAgenda({ cursor, limit: 30 });

  useEffect(() => {
    if (!data) {
      return;
    }
    setItems((prev) => {
      if (cursor === undefined) {
        return data.items;
      }
      const seen = new Set(prev.map((item) => item.id));
      return [...prev, ...data.items.filter((item) => !seen.has(item.id))];
    });
    setNextCursor(data.nextCursor);
  }, [data, cursor]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const canLoadMore = nextCursor !== null && !isFetching;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !canLoadMore) {
      return;
    }
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) {
          setCursor(nextCursor);
        }
      },
      { rootMargin: '96px' },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [canLoadMore, nextCursor]);

  // Скелет, а не спінер по центру: решта застосунку показує форму майбутнього
  // вмісту, і саме вона не дає розкладці стрибнути, коли приїдуть перші дні
  if (isFetching && items.length === 0) {
    return <AgendaSkeleton label={t('loading')} />;
  }

  if (isError && items.length === 0) {
    return (
      <Empty className="min-h-0 flex-1 rounded-lg border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDaysIcon />
          </EmptyMedia>
          <EmptyTitle className="text-destructive">{t('loadError')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  if (items.length === 0) {
    return (
      <Empty className="min-h-0 flex-1 rounded-lg border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDaysIcon />
          </EmptyMedia>
          <EmptyTitle>{t('agenda.empty')}</EmptyTitle>
          <EmptyDescription>{t('agenda.emptyHint')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={onCreate}>
            <PlusIcon />
            {t('toolbar.create')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const days = groupByDay(items, timeZone);

  return (
    /* Ні рамки, ні заливки, ні розділювачів: агенда — СПИСОК КАРТОК на полотні
       сторінки, як центр сповіщень (`notification-panel`), а не таблиця в
       рамці.

       Прокрутка — ОВЕРЛЕЙНИЙ `ScrollArea`, той самий, що в панелі сповіщень і
       в сітках календаря: нативна смуга тут не просто виглядала інакше за
       рештою застосунку, а забирала ширину — і у ВІДЖИТІ дашборда, де списку
       дістається 288px замість сторінки, до неї додавалась ще й горизонтальна
       (viewport Base UI глушить її сам, `axis="vertical"` — дефолт).

       `px-0.5` лишається: без нього скруглення й тінь карток впирались би в
       межі скролера (спіймано в браузері — ліва смужка виглядала зрізаною).
       Класи вмісту йдуть у `contentClassName`, бо flex-контейнером для груп
       мусить бути їхній ПРЯМИЙ предок, а це тепер `ScrollAreaContent` */
    <ScrollArea className="min-h-0 flex-1" contentClassName="flex flex-col gap-4 px-0.5">
      {days.map((day) => (
        <AgendaDayGroup
          key={day.key}
          day={day}
          timeZone={timeZone}
          onSelect={onSelect}
          onIntent={onIntent}
        />
      ))}
      {nextCursor !== null && (
        <div ref={sentinelRef} className="flex justify-center py-2">
          <Spinner aria-label={t('loadMore')} />
        </div>
      )}
    </ScrollArea>
  );
}

function AgendaDayGroup({
  day,
  timeZone,
  onSelect,
  onIntent,
}: {
  day: AgendaDay;
  timeZone: string;
  onSelect: (event: CalendarEventResponse) => void;
  onIntent: (event: CalendarEventResponse, intent: EventIntent) => void;
}) {
  const { t } = useTranslation('calendar');
  const offset = daysFromToday(day.at, timeZone);
  const weekday = formatWeekdayLong(day.at, timeZone);
  const date = formatDateLong(day.at, timeZone);
  // «Today»/«Tomorrow» замість дня тижня: у фіді, який починається з поточної
  // доби, це перше, чого шукає око. Далі за два дні відносний підпис уже гірший
  // за назву дня («in 4 days» вимагає рахувати), тому їх рівно два
  const relative = offset === 0 ? t('agenda.today') : offset === 1 ? t('agenda.tomorrow') : null;

  return (
    <section
      // Група на день — щоб скрінрідер міг пройти агенду ДНЯМИ і одразу чути,
      // наскільки день заповнений, а не гортати рядки поодинці
      aria-label={`${weekday}, ${date}, ${t('agenda.dayEvents', { count: day.events.length })}`}
      data-today={offset === 0 || undefined}
      className="flex flex-col gap-1.5"
    >
      {/* Заголовок дня — просто текст на полотні: ні заливки, ні межі, ні
          `sticky`. Смуга кольору між картками читалась як ще один рядок
          таблиці, а на прозорому фоні `sticky` неможливий у принципі — картки
          проступали б крізь неї (перевірено: напівпрозорий бар пропускав під
          собою літери) */}
      <h3
        className={cn(
          // `pl-3` ставить дату рівно над НАЗВОЮ події: у картки 3px смужки
          // плюс `pl-2.5`, тобто її текст починається на тих самих ~13px
          'flex items-baseline gap-2 pl-3 text-xs font-medium',
          offset === 0 ? 'text-primary' : 'text-foreground',
        )}
      >
        {relative ?? weekday}
        {/* `tabular-nums`: інакше дати «дихають» від групи до групи */}
        <span className="font-normal text-muted-foreground tabular-nums">
          {relative ? `${weekday} · ${date}` : date}
        </span>
      </h3>
      {day.events.map((event) => (
        <AgendaRow
          key={`${event.id}:${event.occurrenceStart}`}
          event={event}
          timeZone={timeZone}
          onSelect={onSelect}
          onIntent={onIntent}
        />
      ))}
    </section>
  );
}

/** Скільки аватарів гостей влазить у рядок, доки вони ще читаються як люди */
const VISIBLE_GUESTS = 3;

function AgendaRow({
  event,
  timeZone,
  onSelect,
  onIntent,
}: {
  event: CalendarEventResponse;
  timeZone: string;
  onSelect: (event: CalendarEventResponse) => void;
  onIntent: (event: CalendarEventResponse, intent: EventIntent) => void;
}) {
  const { t } = useTranslation('calendar');
  const isCancelled = event.status === 'CANCELLED';
  const isDeclined = event.myResponse === 'DECLINED';

  // Тип першим у метаданих: ліва смужка несе той самий факт кольором, і
  // словом він лишається доступним там, де кольору не видно (дальтонізм,
  // чорно-білий друк)
  const meta = [t(`kind.${event.kind}`), event.location, event.customer?.name]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  const time = event.allDay
    ? t('allDay')
    : `${formatTime(event.occurrenceStart, timeZone)} – ${formatTime(event.occurrenceEnd, timeZone)}`;

  const guests = event.attendees;

  const row = (
    <Item
      size="sm"
      render={
        <button
          type="button"
          onClick={() => {
            onSelect(event);
          }}
        />
      }
      variant="outline"
      className={cn(
        // Картка, а не рядок таблиці: тінь поверхні + скруглення (та сама
        // форма, що в центрі сповіщень).
        // Заливка — `bgSoft` (мінімальна прозорість кольору типу), а НЕ
        // `bg-card`: картка тут лежить і на полотні сторінки, і на
        // `bg-card`-картці кастомера — той самий колір зливав би її з
        // поверхнею, лишаючи межу єдиним розрізненням.
        // Наведення НЕ міняє фон: накладка `hover:bg-accent` перебивала б
        // власний колір типу (`bgSoft`) нейтральним сірим — картка й так
        // клікабельна кнопка з фокус-кільцем, додаткового hover-стану колір
        // не потребує
        'relative w-full items-center gap-2 overflow-hidden py-1.5 pr-3 pl-[13px] shadow-sm',
        'text-left transition-colors focus-visible:ring-inset',
        KIND_STYLES[event.kind].bgSoft,
        (isCancelled || isDeclined) && 'opacity-60',
      )}
    >
      {/* Смужка типу — не `border-left`: у `border` заокруглення ліпиться
          з кута НАПІВ (border-radius ділить дугу top-left порівну між
          верхньою і лівою межею, а верхньої тут немає — виходить криво
          зрізана чверть дуги, а не ціла).
          Тут навпаки — ПРЯМОКУТНИК на всю висоту (`inset-y-0`, без
          власного `rounded-*`), а заокруглення бере САМА картка:
          `overflow-hidden` + `rounded-lg` на `Item` ріжуть прямокутник
          по контуру картки, тож дуга смужки — це буквально та сама дуга,
          що в зовнішньої обводки, ціла, а не половинна */}
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0', KIND_LINE_WIDTH, KIND_STYLES[event.kind].line)}
      />
      <ItemContent className="min-w-0 gap-0">
        {/* `ItemTitle` реєстру — `w-fit`: рядок тягнеться під довжину тексту,
            а не колонки, і `Item` (`flex-wrap`) переносить аватари на другий
            рядок замість обрізання. Той самий патерн, що в `ContextPanelHeader`
            (`libs/ui/.../context-panel-slot.tsx`): `min-w-0` на весь шлях до
            `truncate`-елемента, `w-full` замість `w-fit` */}
        <ItemTitle
          className={cn('w-full min-w-0', 'text-[13px]', isCancelled && 'line-through')}
        >
          {event.visibility === 'PRIVATE' && (
            <LockIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">{event.title}</span>
        </ItemTitle>
        {/* Час — у ТІЙ САМІЙ колонці, першим у рядку метаданих: окрема колонка
            фіксованої ширини (шлях ReUI, `w-40`) з'їдала третину рядка на
            «9:00 AM – 9:45 AM» і лишала назву притиснутою до середини */}
        <ItemDescription className="text-[11px] leading-snug">
          <span className="tabular-nums">{time}</span>
          {meta && ` · ${meta}`}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="gap-1.5">
        {guests.length > 0 && (
          /* Аватари сховані від скрінрідера, а присутності на них НЕМАЄ, і це
             не забудькуватість: `UserPresenceBadge` — тултіп, тобто фокусований
             елемент, а весь рядок і так одна кнопка. Вкладена інтерактивність
             тут коштувала б дорожче за саму крапку — склад гостей із їхньою
             присутністю показує панель події, де рядок гостя кнопкою не є.

             Перекриття (стокова стопка-«у чаті», що й дає `AvatarGroup` за
             замовчуванням) раніше зривало 20-піксельний аватар: дві літери
             займали майже всю ширину, і сусід разом зі своїм `ring-2` зрізав
             другу («AD» читалось як «AC»). Тепер 24px і вужчий `ring-1` —
             того самого перекриття вистачає для «стопки», а літери цілі */
          <AvatarGroup aria-hidden="true" className="*:data-[slot=avatar]:ring-1">
            {guests.slice(0, VISIBLE_GUESTS).map((attendee) => (
              <Avatar key={attendee.id} size="sm" className="size-6">
                <AvatarFallback className="text-[10px]" colorSeed={attendee.user.id}>
                  {initialsOf(attendee.user)}
                </AvatarFallback>
              </Avatar>
            ))}
            {guests.length > VISIBLE_GUESTS && (
              <AvatarGroupCount className="size-6 text-[10px]">
                +{guests.length - VISIBLE_GUESTS}
              </AvatarGroupCount>
            )}
          </AvatarGroup>
        )}
        {/* Статус — найдрібніший елемент рядка: він потрібен лише щоб очі його
            ЗНАЙШЛИ, а що саме робити, людина дізнається вже в панелі події */}
        {event.myResponse === 'NEEDS_ACTION' && (
          <Badge variant="warning" className="h-4 px-1.5 text-[10px] font-medium">
            {t('rsvp.pending')}
          </Badge>
        )}
      </ItemActions>
    </Item>
  );

  return <EventContextMenu event={event} trigger={row} onIntent={onIntent} />;
}

/** Ті самі правила, що в `UserIdentity`: дві перші літери двох слів або пошта */
function initialsOf(user: { name: string | null; email: string }): string {
  const words = user.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const [first, second] = words;
  if (first && second) {
    return (first.charAt(0) + second.charAt(0)).toUpperCase();
  }
  return (first ?? user.email).slice(0, 2).toUpperCase();
}

/**
 * Скелет першого завантаження — за формою майбутнього вмісту: бар дня і кілька
 * рядків під ним. Спінер по центру порожнього прямокутника не сказав би, що
 * саме зараз приїде, і давав би стрибок розкладки.
 */
function AgendaSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-0.5"
    >
      {[0, 1].map((group) => (
        <div key={group} className="flex flex-col gap-1.5">
          <Skeleton className="ml-3 h-3 w-32" />
          {[0, 1, 2].map((row) => (
            /* Ліва смужка теж у скелеті: без неї картки «стрибають» на 3px,
               коли приїжджають справжні події */
            <div
              key={row}
              className="flex flex-col gap-1.5 rounded-lg border border-l-[3px] border-l-muted bg-card py-2.5 pr-3 pl-2.5 shadow-sm"
            >
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-2.5 w-56" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
