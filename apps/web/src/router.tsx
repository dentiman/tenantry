import { createRouter } from '@tanstack/react-router';
import { RouteError, RoutePending } from '@saas-skeleton/ui/components/route-fallbacks';
import { reportError } from '@saas-skeleton/ui/lib/report-error';
import type { RouteAccess } from './features/auth/auth.access';
import {
  rootRoute,
  appRoute,
  appIndexRoute,
  workspaceRoute,
  notFoundRoute,
} from './app-shell/app.routes';
import {
  userSettingsRoute,
  userSettingsProfileRoute,
  userSettingsAccountRoute,
  userSettingsSecurityRoute,
  userSettingsAppearanceRoute,
} from './features/account/account.routes';
import { settingsActivityRoute } from './features/activities/activities.routes';
import {
  assistantRoute,
  assistantIndexRoute,
  assistantConversationRoute,
  settingsAiRoute,
} from './features/ai/ai.routes';
import {
  loginRoute,
  resetPasswordRoute,
  resetPasswordConfirmRoute,
  confirmEmailRoute,
} from './features/auth/auth.routes';
import {
  calendarRoute,
  calendarIndexRoute,
  calendarViewRoute,
  calendarEventRoute,
  settingsCalendarRoute,
  customerEventsRoute,
} from './features/calendar/calendar.routes';
import {
  chatRoute,
  chatIndexRoute,
  chatConversationRoute,
  settingsMessagingRoute,
} from './features/chat/chat.routes';
import {
  customersRoute,
  customerDetailRoute,
  customerOverviewRoute,
  customerContactsRoute,
} from './features/customers/customers.routes';
import { invoicesDemoRoute } from './features/invoices-demo/invoices-demo.routes';
import { dashboardRoute } from './features/dashboard/dashboard.routes';
import { aboutRoute, guideRoute } from './features/guide/guide.routes';
import { userSettingsNotificationsRoute } from './features/notifications/notifications.routes';
import { settingsNumberingRoute } from './features/numbering/numbering.routes';
import {
  playgroundRoute,
  playgroundIndexRoute,
  playgroundVerticalFormRoute,
  playgroundInlineFormRoute,
  playgroundComponentsRoute,
  playgroundComponentsButtonsRoute,
  playgroundComponentsCardsRoute,
  playgroundComponentsComboboxRoute,
  playgroundComponentsInputRoute,
  playgroundComponentsPopupsRoute,
  playgroundComponentsSelectRoute,
  playgroundComponentsTextareaRoute,
  playgroundComponentsTabsRoute,
  playgroundComponentsDataGridRoute,
  playgroundComponentsUserSelectRoute,
  playgroundDialogRoute,
} from './features/playground/playground.routes';
import { settingsRoute, settingsGeneralRoute } from './features/settings/settings.routes';
import { usersRoute, userDetailRoute } from './features/users/users.routes';

/**
 * Composition root маршрутів (docs/modules.md §7.4): визначення живуть у теках модулів
 * (`features/<модуль>/<модуль>.routes.tsx`, оболонка — `app-shell/app.routes.tsx`), а тут лише
 * збирається дерево — рядок на модуль. Маршрут фічі може висіти під лейаутом модуля нижче
 * (`settingsCalendarRoute` — під `settingsRoute`): він імпортує батька сам, а дерево складає root.
 */
const routeTree = rootRoute.addChildren([
  loginRoute,
  resetPasswordRoute,
  resetPasswordConfirmRoute,
  confirmEmailRoute,
  aboutRoute, // guide: публічна копія путівника, без гейта й шела
  appRoute.addChildren([
    appIndexRoute,
    workspaceRoute.addChildren([
      dashboardRoute,
      usersRoute,
      userDetailRoute,
      customersRoute,
      // Картка кастомера — лейаут: власні вкладки + вкладки фіч (docs/modules.md §7.4)
      customerDetailRoute.addChildren([
        customerOverviewRoute,
        customerContactsRoute,
        customerEventsRoute, // calendar
      ]),
      invoicesDemoRoute, // invoices-demo
    ]),
    calendarRoute.addChildren([calendarIndexRoute, calendarViewRoute, calendarEventRoute]),
    chatRoute.addChildren([chatIndexRoute, chatConversationRoute]),
    assistantRoute.addChildren([assistantIndexRoute, assistantConversationRoute]),
    settingsRoute.addChildren([
      settingsGeneralRoute,
      settingsCalendarRoute,
      settingsMessagingRoute,
      settingsNumberingRoute,
      settingsAiRoute,
      settingsActivityRoute,
    ]),
    userSettingsRoute.addChildren([
      userSettingsProfileRoute,
      userSettingsAccountRoute,
      userSettingsSecurityRoute,
      userSettingsNotificationsRoute,
      userSettingsAppearanceRoute,
    ]),
    playgroundRoute.addChildren([
      playgroundIndexRoute,
      playgroundVerticalFormRoute,
      playgroundInlineFormRoute,
      playgroundComponentsRoute.addChildren([
        playgroundComponentsButtonsRoute,
        playgroundComponentsCardsRoute,
        playgroundComponentsComboboxRoute,
        playgroundComponentsDataGridRoute,
        playgroundComponentsInputRoute,
        playgroundComponentsPopupsRoute,
        playgroundComponentsSelectRoute,
        playgroundComponentsTabsRoute,
        playgroundComponentsTextareaRoute,
        playgroundComponentsUserSelectRoute,
      ]),
      playgroundDialogRoute,
    ]),
    guideRoute,
    notFoundRoute,
  ]),
]);

/**
 * Політика ледачого завантаження — одна на всі маршрути (docs/frontend/lazy-loading.md):
 * - `defaultPreload: 'intent'` — чанк (і loader) стартує на hover/focus/touchstart посилання,
 *   до кліку; сам клік тоді майже миттєвий;
 * - `defaultPendingMs`/`defaultPendingMinMs` — скелет з'являється лише якщо перехід триває
 *   довше 300 мс і тоді тримається не менше 300 мс: швидкі переходи не мигають, а повільні
 *   не виглядають зависанням (до цього стара сторінка лишається на місці);
 * - спільні `RoutePending`/`RouteError` — на роутах їх не оголошуємо;
 * - `defaultOnCatch` — кожна помилка межі роута йде в `reportError` (єдина точка для Sentry,
 *   `src/lib/error-reporting.ts`); у production роутер сам її не логує.
 */
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingMs: 300,
  defaultPendingMinMs: 300,
  defaultPendingComponent: RoutePending,
  defaultErrorComponent: RouteError,
  defaultOnCatch: (error) => {
    reportError({ error, source: 'route' });
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }

  /**
   * Розкладка контенту — властивість РОУТУ, а не сторінки.
   *
   * `padded` (дефолт) — відступи шела: сторінка компонує картки й форми в
   * колонку, і поля навколо них потрібні. `bleed` — відступів немає зовсім:
   * сторінка сама є одним великим полотном (таблиця гріда, сітка календаря),
   * яке має впиратись у краї вікна, і власні поля вона роздає собі сама.
   *
   * Чому staticData, а не проп сторінки чи ще один портал: це СТАТИЧНА
   * властивість екрана, вона не залежить від даних і не міняється в часі, тож
   * її місце поруч із роутом — і в `routeTree` видно всі винятки одним
   * поглядом. Портал тут був би зайвий: шел нічого не рендерить від сторінки,
   * він лише вибирає клас контейнера.
   */
  interface StaticDataRouteOption {
    layout?: 'padded' | 'bleed';
    /**
     * Брендовий фон на все вікно, а шел над ним — скляний (напівпрозорий
     * сайдбар із блюром, прозоре полотно). Для «вітринних» сторінок (гід,
     * майбутній дашборд-вітрина); робочі екрани його не беруть і лишаються
     * суцільними. Та сама логіка, що з `layout`: властивість екрана, а не
     * даних. Стилі — `libs/ui/src/brand-backdrop.css`.
     */
    backdrop?: 'brand';
    /**
     * Який фон під `backdrop: 'brand'`: `shell` (дефолт, три плями й точки), `auth` (фон
     * сторінок входу: база кольору сайдбара й ауры по кутах, без точок) або `guide` (те саме,
     * але світло зліва, на стику колонки й контенту). Без `backdrop` ні на що не впливає.
     */
    backdropVariant?: 'shell' | 'auth' | 'guide';
    /**
     * Хто може відкрити сторінку (лейаут → усі діти). ЄДИНЕ джерело: гейт `requireAuth` на
     * `appRoute` відсікає за ним перехід, а меню й рейл (`libs/ui/src/navigation`) ховають
     * пункти, чия сторінка юзера не пустила б. Бекенд (`@Roles`) лишається справжнім захистом.
     */
    access?: RouteAccess;
  }
}
