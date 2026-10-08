import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { TriangleAlertIcon } from 'lucide-react';
import { Calendar } from '@saas-skeleton/ui/components/ui/calendar';
import {
  SidebarGroup,
  SidebarGroupContent,
} from '@saas-skeleton/ui/components/ui/sidebar';
import {
  asWeekStart,
  CALENDAR_VIEWS,
  dayKey,
  daysOfRange,
  parseDayKeyAsLocalDate,
  todayKey,
  viewRange,
  type CalendarView,
} from './lib/calendar-date';
import { useCalendarPreferences } from './components/use-calendar-preferences';

/**
 * Друга колонка area «Calendar» — той самий випадок, що чат: це КОНТЕЙНЕР
 * ВИГЛЯДУ, а не меню (`Area.panel` — компонент, docs/frontend/app-shell.md).
 * Тут живе міні-місяць для навігації по датах — і тільки він.
 *
 * Переліку переглядів (Day/Week/Month/Agenda) тут НЕМАЄ свідомо: той самий
 * перемикач стоїть у тулбарі сторінки, поруч із періодом, яким керує. Дві копії
 * одного контролю в двох різних виглядах — те саме, від чого вже позбулись
 * `SectionNav` у налаштуваннях (docs/frontend/app-shell.md).
 *
 * `react-day-picker` тут використовується РІВНО за призначенням — як вибір дати.
 * Малювати в ньому події неможливо: це date-picker, а не сітка календаря
 * (docs/calendar.md §11.3, застереження 2).
 */
export function CalendarSidebar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search }) as {
    date?: string;
  };
  const { t } = useTranslation('calendar');
  const { viewerTimeZone, weekStartsOn, isDeviceZoneDifferent } = useCalendarPreferences();

  // Активний перегляд читається з ШЛЯХУ — та сама доктрина, що `useActiveArea`:
  // дубльованого стану «який перегляд відкрито» в застосунку немає
  const activeView = CALENDAR_VIEWS.find((view) => pathname.endsWith(`/${view}`)) ?? 'week';
  const selectedKey = search.date ?? todayKey(viewerTimeZone);

  /**
   * Дні, які ЗАРАЗ відкриті в сітці, підсвічуються в міні-календарі суцільною
   * смугою (патерн Notion Calendar, docs/calendar.md §11.9): у тижневому
   * перегляді це головна підказка «де я», бо сам тиждень із міні-місяця не
   * читається — там видно лише вибраний день.
   *
   * Тільки `day` і `week`. Для `month` смуга накрила б майже весь міні-місяць,
   * нічого не повідомивши (той місяць і так відкритий), а в `agenda` періоду не
   * існує взагалі — фід курсорний.
   *
   * Дати — ЛОКАЛЬНІ (`parseDayKeyAsLocalDate`), а не `TZDate`: `react-day-picker`
   * будує свої дні в зоні пристрою і порівнює через `isSameDay`, тож зонний
   * інстант підсвітив би сусідній день (та сама грабля, що з `selected`).
   */
  const inViewDays: Date[] =
    activeView === 'day' || activeView === 'week'
      ? (() => {
          const { from, to } = viewRange(activeView, selectedKey, viewerTimeZone, weekStartsOn);
          return daysOfRange(from, to, viewerTimeZone).map((day) =>
            parseDayKeyAsLocalDate(dayKey(day, viewerTimeZone)),
          );
        })()
      : [];
  const firstInView = inViewDays.at(0);
  const lastInView = inViewDays.at(-1);

  const go = (view: CalendarView, date: string): void => {
    void navigate({ to: '/calendar/$view', params: { view }, search: { date } });
  };

  return (
    <>
      {/* Падінг тут — СТОКОВИЙ `p-2` групи, і саме він потрібен: 8px від стінки
          рівно стільки ж, скільки в кнопки «Today» вище і в пунктів «Views»
          нижче, тож міні-місяць стоїть із ними в одну вертикаль. Без падінгу
          (перша спроба) сітка впиралась у межі колонки, а плитка вибраного дня
          лягала прямо на лінію.

          Прибрано інше — ТРЕТІЙ, вкладений відступ: власний `p-2` календаря
          (`p-0` нижче) і мій `px-1` на контенті групи. Разом вони давали 20px з
          боку, від яких сітка 7×28px не влазила в 225px і розпирала колонку.
          Тепер інсет один, а `w-full` розтягує сітку на решту 209px. */}
      <SidebarGroup>
        <SidebarGroupContent>
          <Calendar
            mode="single"
            className="p-0"
            // `classNames.root`, а не `className`: у реєстровій обгортці корінь
            // отримує `w-fit` саме через `classNames`, і клас із `className`
            // програє йому в CSS-порядку незалежно від місця в списку
            classNames={{ root: 'w-full' }}
            weekStartsOn={asWeekStart(weekStartsOn)}
            selected={parseDayKeyAsLocalDate(selectedKey)}
            // Кастомні модифікатори RDP: смуга і два її кінці. Закруглення
            // окремими модифікаторами, бо «перший день у смузі» — не стан дня, а
            // його місце в періоді, і сам `inView` про це не знає
            modifiers={{
              inView: inViewDays,
              ...(firstInView ? { inViewStart: [firstInView] } : {}),
              ...(lastInView ? { inViewEnd: [lastInView] } : {}),
            }}
            modifiersClassNames={{
              inView: 'rounded-none bg-calendar-in-view',
              inViewStart: 'rounded-l-(--cell-radius)',
              inViewEnd: 'rounded-r-(--cell-radius)',
            }}
            onSelect={(day: Date | undefined) => {
              if (day) {
                const month = String(day.getMonth() + 1).padStart(2, '0');
                const date = String(day.getDate()).padStart(2, '0');
                go(activeView, `${String(day.getFullYear())}-${month}-${date}`);
              }
            }}
          />
        </SidebarGroupContent>
      </SidebarGroup>

      {/* Зона глядача — ПІД міні-місяцем, а не банером над сіткою (перенесено
          2026-09-08). У колонці підказка вузька і не з'їдає висоту календаря, а
          головне — стоїть поруч із самим орієнтиром «яка зараза дата», якому й
          належить.

          Це `Link`, а не `Alert`: у сайдбарі підказка ПОСТІЙНА, а `role="alert"`
          означає `aria-live` — скрінрідер зачитував би її при кожному
          монтуванні колонки. Вигляд лишився той самий, що в `Alert
          variant="warning" accent="left"`, бо це той самий сигнал; тепер
          клікається весь блок, а не лише слова «Change your time zone» */}
      {isDeviceZoneDifferent && (
        <SidebarGroup>
          <SidebarGroupContent>
            <Link
              to="/user-settings"
              className="flex gap-2 rounded-lg border border-warning/30 border-l-[3px] border-l-warning bg-warning/10 px-2 py-1.5 text-warning transition-colors hover:bg-warning/15"
            >
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs leading-tight font-medium">
                  {t('zoneBanner.title', { zone: viewerTimeZone })}
                </span>
                <span className="text-[11px] leading-tight underline underline-offset-2">
                  {t('zoneBanner.action')}
                </span>
              </span>
            </Link>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  );
}
