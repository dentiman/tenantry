import { createRouter } from '@tanstack/react-router';
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
import { chatRoute, chatIndexRoute, chatConversationRoute } from './features/chat/chat.routes';
import {
  customersRoute,
  customerDetailRoute,
  customerOverviewRoute,
  customerContactsRoute,
} from './features/customers/customers.routes';
import { dashboardRoute } from './features/dashboard/dashboard.routes';
import { guideRoute } from './features/guide/guide.routes';
import { userSettingsNotificationsRoute } from './features/notifications/notifications.routes';
import { settingsNumberingRoute } from './features/numbering/numbering.routes';
import {
  playgroundRoute,
  playgroundIndexRoute,
  playgroundVerticalFormRoute,
  playgroundInlineFormRoute,
  playgroundComponentsRoute,
  playgroundComponentsButtonsRoute,
  playgroundComponentsComboboxRoute,
  playgroundComponentsInputRoute,
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
    ]),
    calendarRoute.addChildren([calendarIndexRoute, calendarViewRoute, calendarEventRoute]),
    chatRoute.addChildren([chatIndexRoute, chatConversationRoute]),
    assistantRoute.addChildren([assistantIndexRoute, assistantConversationRoute]),
    settingsRoute.addChildren([
      settingsGeneralRoute,
      settingsCalendarRoute,
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
        playgroundComponentsComboboxRoute,
        playgroundComponentsDataGridRoute,
        playgroundComponentsInputRoute,
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

export const router = createRouter({ routeTree });

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
     * Хто може відкрити сторінку (лейаут → усі діти). ЄДИНЕ джерело: гейт `requireAuth` на
     * `appRoute` відсікає за ним перехід, а меню й рейл (`libs/ui/src/navigation`) ховають
     * пункти, чия сторінка юзера не пустила б. Бекенд (`@Roles`) лишається справжнім захистом.
     */
    access?: RouteAccess;
  }
}
