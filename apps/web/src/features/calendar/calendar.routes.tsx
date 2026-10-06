import { createRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { appRoute } from '../../app-shell/app.routes';
import { settingsRoute } from '../settings/settings.routes';
import { isCalendarView } from './lib/calendar-date';
import { CalendarPage } from './pages/calendar';
import { SettingsCalendarPage } from './pages/calendar-settings';

/**
 * Area «Calendar». Перегляд — у ШЛЯХУ (`/calendar/week`), період — у search
 * (`?date=2026-09-06`): і те, і те мусить переживати F5 і жити в надісланому
 * посиланні (docs/calendar.md §11.1). `$view` валідується `beforeLoad`-ом —
 * невідомий перегляд тихо падає в тиждень замість 404.
 */
export const calendarRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/calendar',
});

export const CalendarSearchSchema = z.object({
  // `yyyy-MM-dd`; невалідне значення з URL тихо падає в дефолт (сьогодні),
  // як і решта search-схем застосунку
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
});

export type CalendarSearch = z.infer<typeof CalendarSearchSchema>;

/** `/calendar` → тиждень: «домівка» area мусить щось показувати */
export const calendarIndexRoute = createRoute({
  getParentRoute: () => calendarRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/calendar/$view', params: { view: 'week' }, replace: true });
  },
});

export const calendarViewRoute = createRoute({
  getParentRoute: () => calendarRoute,
  path: '$view',
  validateSearch: (search) => CalendarSearchSchema.parse(search),
  beforeLoad: ({ params }) => {
    if (!isCalendarView(params.view)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/calendar/$view', params: { view: 'week' }, replace: true });
    }
  },
  component: CalendarPage,
  staticData: { layout: 'bleed' },
});

/**
 * Deep link на подію (з інбоксу, з журналу, з листа). Окремий роут, а не
 * `?eventId=`: посилання на зустріч дають так само, як на картку кастомера.
 */
export const calendarEventRoute = createRoute({
  getParentRoute: () => calendarRoute,
  path: 'events/$eventId',
  component: CalendarPage,
  staticData: { layout: 'bleed' },
});

export const settingsCalendarRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'calendar',
  component: SettingsCalendarPage,
});
