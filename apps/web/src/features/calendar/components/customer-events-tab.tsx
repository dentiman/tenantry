import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from '@tanstack/react-router';
import { CalendarPlusIcon } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import { ContextPanelPortal } from '@saas-skeleton/ui/components/context-panel-slot';
import { AgendaList } from './agenda-list';
import { EventPanel, type EventPanelTarget } from './event-panel';
import { useCalendarPreferences } from './use-calendar-preferences';
import { EventDeleteDialog, useEventIntents } from './use-event-intents';
import { defaultCreateStart, todayKey } from '../lib/calendar-date';

/**
 * Вкладка «Події» на картці кастомера — маршрут календаря `events` під лейаутом
 * `customerDetailRoute` (docs/modules.md §7.4). Той самий `AgendaList`, що в
 * перегляді Agenda і у віджеті дашборда, лише відфільтрований за кастомером: окремого
 * «списку подій клієнта» не заводимо, бо він розійшовся б з агендою з першою ж зміною.
 *
 * Картка «Upcoming» на вкладці «Огляд» лишається: там три найближчі, тут — увесь фід.
 */
export function CustomerEventsTab() {
  const { t } = useTranslation('calendar');
  const { customerId } = useParams({ from: '/app/workspace/customers/$customerId' });
  const preferences = useCalendarPreferences();
  const timeZone = preferences.viewerTimeZone;
  const [target, setTarget] = useState<EventPanelTarget | null>(null);

  /** Дії рядка — той самий виконавець, що на сторінці календаря */
  const intents = useEventIntents({
    onOpen: (event) => {
      setTarget({ event });
    },
    onDuplicate: (draft) => {
      setTarget({ event: null, draft });
    },
  });

  /** Нова зустріч — одразу з цим кастомером: заводять її саме з його картки */
  const openDraft = (): void => {
    const startsAt = defaultCreateStart(todayKey(timeZone), timeZone, preferences.workDayStart);
    setTarget({
      event: null,
      draft: {
        startsAt,
        endsAt: new Date(startsAt.getTime() + preferences.defaultEventDurationMinutes * 60_000),
        customerId,
      },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={openDraft}>
          <CalendarPlusIcon />
          {t('customer.create')}
        </Button>
      </div>

      {/* Межа висоти — тут, як у віджеті дашборда: сам список нескінченний (курсорний фід)
          і прокручується власним ScrollArea */}
      <div className="flex h-[36rem] min-h-0 flex-col">
        <AgendaList
          timeZone={timeZone}
          customerId={customerId}
          onSelect={(event) => {
            setTarget({ event });
          }}
          onCreate={openDraft}
          onIntent={intents.applyIntent}
        />
      </div>

      <EventDeleteDialog intents={intents} />

      {/* Та сама контекстна панель шела, що в календарі: картка кастомера лишається на
          екрані, поки поруч відкрита зустріч */}
      {target !== null && (
        <ContextPanelPortal contentKey={target.event?.id ?? 'draft'} label="CustomerEventsTab">
          <EventPanel
            target={target}
            timeZone={timeZone}
            weekStartsOn={preferences.weekStartsOn}
            defaultDurationMinutes={preferences.defaultEventDurationMinutes}
            defaultReminderMinutes={preferences.defaultReminderMinutes}
            onClose={() => {
              setTarget(null);
            }}
          />
        </ContextPanelPortal>
      )}
    </div>
  );
}

/**
 * Внесок у слот `customerDetailTabs` (`slot-fills.ts`): вкладка-посилання на маршрут вище.
 * `value` = сегмент шляху `events` — за ним лейаут підсвічує активну вкладку.
 */
export function CustomerEventsTabTrigger({ customerId }: { customerId: string }) {
  const { t } = useTranslation('calendar');
  return (
    <TabsTrigger
      value="events"
      nativeButton={false}
      render={<Link to="/workspace/customers/$customerId/events" params={{ customerId }} />}
    >
      {t('customer.tab')}
    </TabsTrigger>
  );
}
