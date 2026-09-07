import { useTranslation } from 'react-i18next';
import { BuildingIcon, ClockIcon, LockIcon, MapPinIcon, UsersIcon } from 'lucide-react';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import { formatDateTime, formatFullDate, formatTime } from '../../lib/calendar-date';

/**
 * Вміст peek-картки події (CAL-2, наведення на плитку).
 *
 * **Тільки читання — жодної дії.** Плитка в сітці показує назву і час, і цього
 * мало, щоб зрозуміти «а що це за зустріч»; але як тільки в картку по наведенню
 * потрапляє кнопка, вона стає пасткою: щоб натиснути, треба тримати курсор у
 * коридорі між тригером і поповером. Дії живуть у панелі (клік) і в контекстному
 * меню (правий клік) — там вони не зникають з-під руки.
 *
 * Порядок рядків — за питаннями, які людина ставить у цьому порядку: коли? де?
 * з ким? для кого? Тому час завжди перший, а кастомер останній.
 */
export function EventPeekContent({
  event,
  timeZone,
}: {
  event: CalendarEventResponse;
  timeZone: string;
}) {
  const { t } = useTranslation('calendar');
  const accepted = event.attendees.filter((a) => a.response === 'ACCEPTED').length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-start gap-1.5 leading-tight font-medium">
          {event.visibility === 'PRIVATE' && <LockIcon className="mt-0.5 size-3.5 shrink-0" />}
          <span className={event.status === 'CANCELLED' ? 'line-through' : undefined}>
            {event.title}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">{t(`kind.${event.kind}`)}</span>
      </div>

      <Row icon={<ClockIcon />}>
        {/* Дата з місяцем, а не `formatDayLabel`: у сітці й так видно, який це
            день тижня, а от «яке число» — рівно те, чого плитка не показує.
            `formatDayLabel` (weekday+day) до того ж дає «8 Tue» — порядок,
            який `Intl` вибирає сам, і в реченні він читається дивно */}
        {event.allDay
          ? `${t('allDay')} · ${formatFullDate(event.occurrenceStart, timeZone)}`
          : `${formatDateTime(event.occurrenceStart, timeZone)} – ${formatTime(
              event.occurrenceEnd,
              timeZone,
            )}`}
      </Row>

      {event.location && <Row icon={<MapPinIcon />}>{event.location}</Row>}

      {event.attendees.length > 0 && (
        <Row icon={<UsersIcon />}>
          {t('peek.guests', { count: event.attendees.length })}
          {accepted > 0 && ` · ${t('peek.accepted', { count: accepted })}`}
        </Row>
      )}

      {event.customer && <Row icon={<BuildingIcon />}>{event.customer.name}</Row>}

      {/* Своя відповідь — те, через що peek і відкривають найчастіше: «я вже
          сказав, що буду?». Показуємо лише коли я справді учасник */}
      {event.myResponse && (
        <span className="text-xs text-muted-foreground">
          {t('peek.myResponse', { response: t(`rsvp.${event.myResponse.toLowerCase()}`) })}
        </span>
      )}
    </div>
  );
}

function Row({ icon, children }: { icon: React.ReactElement; children: React.ReactNode }) {
  return (
    <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
      {/* Розмір іконки задає контейнер, а не кожен виклик: у peek вони однакові */}
      <span className="mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">{icon}</span>
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}
