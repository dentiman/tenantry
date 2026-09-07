import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PlusIcon } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Calendar } from '@saas-skeleton/ui/components/ui/calendar';
import {
  SidebarGroup,
  SidebarGroupContent,
} from '@saas-skeleton/ui/components/ui/sidebar';
import {
  asWeekStart,
  CALENDAR_VIEWS,
  parseDayKeyAsLocalDate,
  todayKey,
  type CalendarView,
} from '../../lib/calendar-date';
import { useCalendarPreferences } from '../../components/calendar/use-calendar-preferences';

/**
 * Друга колонка area «Calendar» — той самий випадок, що чат: це КОНТЕЙНЕР
 * ВИГЛЯДУ, а не меню (`AppArea.Sidebar` віддає компонент, docs/frontend/app-shell.md).
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
  const { t } = useTranslation('calendar');
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search }) as {
    date?: string;
  };
  const { viewerTimeZone, weekStartsOn } = useCalendarPreferences();

  // Активний перегляд читається з ШЛЯХУ — та сама доктрина, що `resolveArea`:
  // дубльованого стану «який перегляд відкрито» в застосунку немає
  const activeView = CALENDAR_VIEWS.find((view) => pathname.endsWith(`/${view}`)) ?? 'week';
  const selectedKey = search.date ?? todayKey(viewerTimeZone);

  const go = (view: CalendarView, date: string): void => {
    void navigate({ to: '/calendar/$view', params: { view }, search: { date } });
  };

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <Button
            className="w-full"
            onClick={() => {
              // Кнопка веде на сітку — саму панель створення відкриває сторінка
              // (стан панелі належить їй, а не навігації)
              go(activeView === 'agenda' ? 'week' : activeView, todayKey(viewerTimeZone));
            }}
          >
            <PlusIcon />
            {t('toolbar.today')}
          </Button>
        </SidebarGroupContent>
      </SidebarGroup>

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

    </>
  );
}
