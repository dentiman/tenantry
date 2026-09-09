import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlusIcon } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@saas-skeleton/ui/components/ui/item';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { useCalendarAgenda } from '../../api/generated/api';
import { formatDateTime } from '../../lib/calendar-date';
import { ContextPanelPortal } from '@saas-skeleton/ui/components/context-panel-slot';
import { EventPanel, type EventPanelTarget } from './event-panel';
import { useCalendarPreferences } from './use-calendar-preferences';

/** Скільки найближчих подій показуємо на картці клієнта */
const LIMIT = 3;

/**
 * «Найближчі події» на картці кастомера (F-38). Ходить ТИМ САМИМ курсорним
 * agenda-ендпоінтом із фільтром `customerId` — окремого «події клієнта» в API
 * немає й не потрібно.
 *
 * Історія зустрічей тут не дублюється: вона вже є в стрічці подій кастомера,
 * бо активності календаря лінкуються на клієнта роллю `context` (§9.1).
 */
export function CustomerEventsCard({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const { t } = useTranslation('calendar');
  const preferences = useCalendarPreferences();
  const [target, setTarget] = useState<EventPanelTarget | null>(null);

  const { data, isPending } = useCalendarAgenda({ customerId, limit: LIMIT });
  const events = data?.items ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t('customer.upcoming')}</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const startsAt = new Date();
            setTarget({
              event: null,
              draft: {
                startsAt,
                endsAt: new Date(
                  startsAt.getTime() + preferences.defaultEventDurationMinutes * 60_000,
                ),
                // Клієнт передзаповнений: зустріч заводять саме з його картки
                customerId,
              },
            });
          }}
        >
          <CalendarPlusIcon />
          {t('customer.create')}
        </Button>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('customer.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {events.map((event) => (
              <li key={event.id}>
                <Item
                  render={
                    <button
                      type="button"
                      onClick={() => {
                        setTarget({ event });
                      }}
                    />
                  }
                  className="w-full text-left"
                >
                  <ItemContent>
                    <ItemTitle>{event.title}</ItemTitle>
                    <ItemDescription>
                      {event.allDay
                        ? t('allDay')
                        : formatDateTime(event.startsAt, preferences.viewerTimeZone)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {/* Та сама контекстна панель шела, що й у календарі: картка кастомера
          лишається на екрані, поки поруч відкрита зустріч */}
      {target !== null && (
        <ContextPanelPortal contentKey={target.event?.id ?? 'draft'} label="CustomerEventsCard">
          <EventPanel
            target={target}
            timeZone={preferences.viewerTimeZone}
            defaultDurationMinutes={preferences.defaultEventDurationMinutes}
            defaultReminderMinutes={preferences.defaultReminderMinutes}
            onClose={() => {
              setTarget(null);
            }}
          />
        </ContextPanelPortal>
      )}
      <span className="sr-only">{customerName}</span>
    </Card>
  );
}
