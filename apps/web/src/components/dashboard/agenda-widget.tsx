import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';
import { buttonVariants } from '@saas-skeleton/ui/components/ui/button';
import { ContextPanelPortal } from '@saas-skeleton/ui/components/context-panel-slot';
import { AgendaList } from '../calendar/agenda-list';
import { EventPanel, type EventPanelTarget } from '../calendar/event-panel';
import { useCalendarPreferences } from '../calendar/use-calendar-preferences';
import { EventDeleteDialog, useEventIntents } from '../calendar/use-event-intents';
import { defaultCreateStart, todayKey } from '../../lib/calendar-date';
import { DashboardWidget } from './widget';

/**
 * «Найближчі події» на дашборді — ТОЙ САМИЙ `AgendaList`, що малює перегляд
 * Agenda в календарі, лише в межах картки.
 *
 * Другого списку подій у застосунку не заводимо: рядок агенди вже несе час,
 * тип, місце, кастомера і гостей, має контекстне меню і відкриває панель
 * події — власна «спрощена» версія на дашборді розійшлася б із ним із першою ж
 * зміною (як розійшлись би дві реалізації колапсу чи нумерації). Віджит
 * додає рівно оболонку: назву, вихід у календар і межу висоти.
 *
 * Фід той самий і за даними: `useCalendarAgenda` з тим самим ключем кеша, тож
 * відкритий поруч календар і дашборд не роблять двох запитів.
 */
export function DashboardAgendaWidget() {
  const { t } = useTranslation('dashboard');
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

  /** Час нової події — те саме правило, що в кнопці тулбара календаря */
  const openDraft = (): void => {
    const startsAt = defaultCreateStart(todayKey(timeZone), timeZone, preferences.workDayStart);
    setTarget({
      event: null,
      draft: {
        startsAt,
        endsAt: new Date(startsAt.getTime() + preferences.defaultEventDurationMinutes * 60_000),
      },
    });
  };

  return (
    <DashboardWidget
      title={t('widgets.agenda.title')}
      action={
        /* Посилання, а не кнопка з `navigate`: це перехід, тож він мусить
           відкриватись у новій вкладці середнім кліком і показувати URL у
           статусному рядку. Ідіом той самий, що на `/playground` —
           `buttonVariants` на `Link`, без обгортки в `Button` */
        <Link
          to="/calendar/$view"
          params={{ view: 'agenda' }}
          search={{}}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          {t('widgets.agenda.openCalendar')}
          <ArrowRightIcon data-icon="inline-end" />
        </Link>
      }
    >
      {/* Межа висоти живе ТУТ, а не в `AgendaList`: сам список нескінченний
          (курсорний фід), і у віджиті обмежувати його мусить оболонка — так
          само, як сторінка календаря обмежує його висотою вікна. `h-72` — це
          приблизно чотири дні по дві події: достатньо, щоб «що далі» читалось
          без прокрутки, і не настільно, щоб один віджит зайняв екран */}
      <div className="flex h-72 min-h-0 flex-col">
        <AgendaList
          timeZone={timeZone}
          onSelect={(event) => {
            setTarget({ event });
          }}
          onCreate={openDraft}
          onIntent={intents.applyIntent}
        />
      </div>

      <EventDeleteDialog intents={intents} />

      {/* Та сама контекстна панель шела, що в календарі й на картці кастомера:
          дашборд лишається на екрані, поки поруч відкрита подія */}
      {target !== null && (
        <ContextPanelPortal contentKey={target.event?.id ?? 'draft'} label="DashboardAgendaWidget">
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
    </DashboardWidget>
  );
}
