import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import { CustomerQuerySchema, UserQuerySchema } from '@saas-skeleton/contracts';
import { isCalendarView } from './lib/calendar-date';
import { useAuthStore } from './stores/auth.store';
import { NotFoundPage } from '@saas-skeleton/ui/components/not-found-page';
import { AppShell } from './app-shell/app-shell';
import { isUnder } from './app-shell/paths';
import { ToastHost } from './components/toast-host';
import { LoginPage } from './pages/login';
import { ResetPasswordPage } from './pages/reset-password';
import { ResetPasswordConfirmPage } from './pages/reset-password-confirm';
import { ConfirmEmailPage } from './pages/confirm-email';
import { DashboardPage } from './pages/dashboard';
import { UsersPage } from './pages/users';
import { CustomersPage } from './pages/customers';
import { CustomerDetailPage } from './pages/customer-detail';
import { UserDetailPage } from './pages/user-detail';
import { CalendarPage } from './pages/calendar';
import { ChatPage } from './pages/chat';
import { ChatConversationPage } from './pages/chat-conversation';
import { PlaygroundPage } from './pages/playground';
import { PlaygroundComboboxPage } from './pages/playground-combobox';
import { PlaygroundInputPage } from './pages/playground-input';
import { PlaygroundSelectPage } from './pages/playground-select';
import { PlaygroundTabsPage } from './pages/playground-tabs';
import { PlaygroundTextareaPage } from './pages/playground-textarea';
import { PlaygroundDialogPage } from './pages/playground-dialog';
import { PlaygroundInlineFormPage } from './pages/playground-inline-form';
import { PlaygroundVerticalFormPage } from './pages/playground-vertical-form';
import { PlaygroundUserSelectPage } from './pages/playground-user-select';
import { PlaygroundDataGridPage } from './pages/playground-data-grid';
import { GuidePage } from './pages/guide';
import { UserSettingsProfilePage } from './pages/user-settings/profile';
import { UserSettingsAccountPage } from './pages/user-settings/account';
import { UserSettingsSecurityPage } from './pages/user-settings/security';
import { UserSettingsNotificationsPage } from './pages/user-settings/notifications';
import { UserSettingsAppearancePage } from './pages/user-settings/appearance';
import { SettingsGeneralPage } from './pages/settings/general';
import { SettingsCalendarPage } from './pages/settings/calendar';
import { SettingsNumberingPage } from './pages/settings/numbering';
import { SettingsActivityPage } from './pages/settings/activity';

/**
 * Шляхи, які до появи area-навігації лежали в корені, а тепер живуть під
 * `/workspace`. Зовнішні посилання і закладки юзерів на них уже існують, тож
 * один нормалізатор у корені дешевший за дублюючі роути на кожен старий шлях.
 *
 * `href`, а не `to`: джерело — довільний старий рядок, типізації тут не буде.
 * `searchStr` обовʼязковий — стан гріда (фільтри, сторінка, сортування) живе в
 * URL, і редірект без нього викидав би юзера на порожній список.
 *
 * Тимчасова сумісність, не частина архітектури: видалити, коли старі посилання
 * протухнуть (орієнтир — кінець 2026).
 */
const LEGACY_WORKSPACE_PREFIXES = ['/users', '/customers'];

const rootRoute = createRootRoute({
  beforeLoad: ({ location }) => {
    if (LEGACY_WORKSPACE_PREFIXES.some((prefix) => isUnder(location.pathname, prefix))) {
      // TanStack Router: redirect() кидається як управляючий об'єкт, не помилка
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        href: `/workspace${location.pathname}${location.searchStr}`,
        replace: true,
      });
    }
  },
  // ToastHost тут, а не в main.tsx: placement залежить від роуту (адмінка/гостьові)
  component: () => (
    <>
      <Outlet />
      <ToastHost />
    </>
  ),
});

function requireGuest(): void {
  if (useAuthStore.getState().user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/workspace' });
  }
}

function requireAuth(): void {
  if (!useAuthStore.getState().user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/login' });
  }
}

/**
 * Налаштування організації редагує лише адмін — і бекенд це enforce-ить
 * (`@Roles(ADMIN)` на записі). Гейт тут не «замість» серверного, а щоб USER не
 * дивився на форми, які однаково не збережуться. Пункт area в рейлі ховає
 * `canSee` у `app-shell/areas.tsx` — це видимість, а enforcement саме тут.
 */
function requireAdmin(): void {
  const user = useAuthStore.getState().user;
  if (!user) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/login' });
  }
  if (user.role !== 'ADMIN') {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/workspace' });
  }
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: requireGuest,
  component: LoginPage,
});

/**
 * AUTH-3 (US4): публічні роути верхнього рівня, ПОЗА AppShell і поза
 * префіксами area — лист відкривають на іншому, часто незалогіненому
 * пристрої, тож гейт `requireAuth`/`requireGuest` тут навмисно не стоїть
 * (contracts/http-api.md §«/account»: confirm-роути публічні за побудовою).
 */
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPasswordPage,
});

const resetPasswordConfirmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password/confirm',
  component: ResetPasswordConfirmPage,
});

/** Публічний і незалежний від AppShell (план D-13) — див. confirm-email.tsx */
const confirmEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/confirm-email',
  component: ConfirmEmailPage,
});

/**
 * Гейт сесії і каркас застосунку. Pathless (`id`, а не `path`), бо префікс
 * задає вже area — див. `docs/frontend/app-shell.md`.
 *
 * `notFoundComponent` тут, а не в корені: так 404 усередині area (напр.
 * `/settings/nope`) малюється ВСЕРЕДИНІ шела — рейл і панель area лишаються на
 * місці, тож із помилки видно, куди йти далі. Гість сюди не доходить: гейт
 * `beforeLoad` відправляє його на /login.
 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireAuth,
  component: AppShell,
  notFoundComponent: () => <NotFoundPage homeTo="/workspace" />,
});

/** Корінь застосунку — це area workspace, окремої сторінки на `/` немає */
const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/workspace', replace: true });
  },
});

/**
 * Area «Workspace» — робоча частина застосунку. Layout-роут без компонента:
 * TanStack Router рендерить `Outlet` сам, а вся навігація area живе в шелі
 * (`app-shell/areas/workspace-sidebar.tsx`).
 */
const workspaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/workspace',
});

const dashboardRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/',
  component: DashboardPage,
});

// Стан списку живе в URL — лінк можна шерити, F5 не губить пошук/сторінку.
// .catch() — невалідні значення з URL тихо падають у дефолт замість помилки роута
const UsersSearchSchema = z.object({
  search: z.string().trim().optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  // max — дзеркало бекенда (PaginationQuerySchema): невалідний ліміт з URL падає
  // в дефолт тут, а не 400-кою на API
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  // Той самий whitelist полів, що й на бекенді (UserQuerySchema.sortBy) — не дублюємо enum
  sortBy: UserQuerySchema.shape.sortBy.catch(undefined),
  sortOrder: UserQuerySchema.shape.sortOrder.catch(undefined),
  // В URL і в query-параметрах API фільтр їде РЯДКОМ 'true'/'false' (не reuse
  // UserQuerySchema.shape.isActive — його transform дає boolean, а це wire-формат)
  isActive: z.enum(['true', 'false']).optional().catch(undefined),
});

/** TFilters для useDataGridFilters на сторінці users — runtime-форму гарантує validateSearch */
export type UsersSearch = z.infer<typeof UsersSearchSchema>;

const usersRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'users',
  validateSearch: (search) => UsersSearchSchema.parse(search),
  component: UsersPage,
  staticData: { layout: 'bleed' },
});

// Той самий контракт, що в /users: стан списку живе в URL, невалідні значення
// тихо падають у дефолт замість помилки роута
const CustomersSearchSchema = z.object({
  search: z.string().trim().optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).optional().catch(undefined),
  // Whitelist полів сортування — той самий, що на бекенді (не дублюємо enum)
  sortBy: CustomerQuerySchema.shape.sortBy.catch(undefined),
  sortOrder: CustomerQuerySchema.shape.sortOrder.catch(undefined),
  status: CustomerQuerySchema.shape.status.catch(undefined),
  kind: CustomerQuerySchema.shape.kind.catch(undefined),
});

export type CustomersSearch = z.infer<typeof CustomersSearchSchema>;

const customersRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'customers',
  validateSearch: (search) => CustomersSearchSchema.parse(search),
  component: CustomersPage,
  staticData: { layout: 'bleed' },
});

/** Картка кастомера: окремий роут — на неї дають посилання в листі й у тікеті */
const customerDetailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'customers/$customerId',
  component: CustomerDetailPage,
});

/** Сторінка юзера: окремий роут, а не драйвер — на неї можна дати посилання */
const userDetailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'users/$userId',
  component: UserDetailPage,
});

/**
 * Area «Calendar». Перегляд — у ШЛЯХУ (`/calendar/week`), період — у search
 * (`?date=2026-09-06`): і те, і те мусить переживати F5 і жити в надісланому
 * посиланні (docs/calendar.md §11.1). `$view` валідується `beforeLoad`-ом —
 * невідомий перегляд тихо падає в тиждень замість 404.
 */
const calendarRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/calendar',
});

const CalendarSearchSchema = z.object({
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
const calendarIndexRoute = createRoute({
  getParentRoute: () => calendarRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/calendar/$view', params: { view: 'week' }, replace: true });
  },
});

const calendarViewRoute = createRoute({
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
const calendarEventRoute = createRoute({
  getParentRoute: () => calendarRoute,
  path: 'events/$eventId',
  component: CalendarPage,
  staticData: { layout: 'bleed' },
});

/**
 * Area «Chat». Layout + index, як і задумувалось: index лишається станом
 * «розмову не вибрано», а сама розмова — дитина, додана без переписування.
 */
const chatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/chat',
});

const chatIndexRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '/',
  component: ChatPage,
});

/**
 * Відкрита розмова. `bleed`: стрічка і композер самі тримають свої відступи,
 * а сторінка має займати всю висоту — інакше композер поїхав би за екран.
 */
const chatConversationRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '$conversationId',
  component: ChatConversationPage,
  staticData: { layout: 'bleed' },
});

/**
 * Area «Settings» — налаштування ОРГАНІЗАЦІЇ. Своя area, а не розділ усередині
 * workspace: її під-розділи — повноцінне меню, і йому місце в навігаційній
 * колонці шела, а не в контенті сторінки (звідки й прибрано `SectionNav`).
 */
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  beforeLoad: requireAdmin,
});

const settingsGeneralRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  component: SettingsGeneralPage,
});

const settingsCalendarRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'calendar',
  component: SettingsCalendarPage,
});

const settingsNumberingRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'numbering',
  component: SettingsNumberingPage,
});

const settingsActivityRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'activity',
  component: SettingsActivityPage,
});

/**
 * ОСОБИСТІ налаштування — area без пункту в рейлі: вхід із дропдауна аватара, бо
 * в головній навігації словом «Settings» володіє організація (патерн
 * GitLab / Stripe / Notion, docs/settings.md). `/user-settings` = Profile
 * (індексний роут): у свої налаштування заходять найчастіше саме по профіль.
 */
const userSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/user-settings',
});

const userSettingsProfileRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: '/',
  component: UserSettingsProfilePage,
});

const userSettingsAccountRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'account',
  component: UserSettingsAccountPage,
});

const userSettingsSecurityRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'security',
  component: UserSettingsSecurityPage,
});

const userSettingsNotificationsRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'notifications',
  component: UserSettingsNotificationsPage,
});

const userSettingsAppearanceRoute = createRoute({
  getParentRoute: () => userSettingsRoute,
  path: 'appearance',
  component: UserSettingsAppearancePage,
});

/**
 * Area «Playground» — візуальні стенди примітивів UI. Layout + index: стенд
 * додається роутом і рядком у
 * `app-shell/areas/playground-sidebar.tsx`.
 */
const playgroundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/playground',
});

/** `/playground` → перший стенд каталогу: «домівка» area мусить щось показувати */
const playgroundIndexRoute = createRoute({
  getParentRoute: () => playgroundRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/playground/components/buttons', replace: true });
  },
});

const playgroundVerticalFormRoute = createRoute({
  getParentRoute: () => playgroundRoute,
  path: 'vertical-form',
  component: PlaygroundVerticalFormPage,
});

const playgroundInlineFormRoute = createRoute({
  getParentRoute: () => playgroundRoute,
  path: 'inline-form',
  component: PlaygroundInlineFormPage,
});

/**
 * Підменю «Components» (collapse у сайдбарі) — каталог примітивів окремими
 * сторінками, розділений на дві НЕ-колапсовні підгрупи (General/Platform,
 * `app-shell/areas/playground-sidebar.tsx`). Сам `components` — лише
 * контейнер шляху, власної сторінки не має.
 */
const playgroundComponentsRoute = createRoute({
  getParentRoute: () => playgroundRoute,
  path: 'components',
});

/** General Components: спільна libs/ui, придатна для обох фронтів (web і platform-web) */
const playgroundComponentsButtonsRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'buttons',
  component: PlaygroundPage,
});

/** General Components: Combobox — пошук-з-попапом, фундамент усіх бізнес-селектів */
const playgroundComponentsComboboxRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'combobox',
  component: PlaygroundComboboxPage,
});

/** General Components: Input + адорнований InputGroup — бандл на одній сторінці */
const playgroundComponentsInputRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'input',
  component: PlaygroundInputPage,
});

/** General Components: Select — базовий випадаючий список */
const playgroundComponentsSelectRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'select',
  component: PlaygroundSelectPage,
});

/** General Components: Textarea — багаторядкове текстове поле */
const playgroundComponentsTextareaRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'textarea',
  component: PlaygroundTextareaPage,
});

/** General Components: другий приклад — задає шаблон для решти каталогу */
const playgroundComponentsTabsRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'tabs',
  component: PlaygroundTabsPage,
});

/**
 * Стенд DataGrid на фейкових інвойсах. `bleed` — як у справжніх списків
 * (Customers/Users): грід сам тримає поля й упирається в краї полотна
 */
const playgroundComponentsDataGridRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'data-grid',
  component: PlaygroundDataGridPage,
  staticData: { layout: 'bleed' },
});

/** Platform Components: бізнес-орієнтовані, з бекендом, лише в tenant-порталі */
const playgroundComponentsUserSelectRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'user-select',
  component: PlaygroundUserSelectPage,
});

const playgroundDialogRoute = createRoute({
  getParentRoute: () => playgroundRoute,
  path: 'dialog',
  component: PlaygroundDialogPage,
});

/**
 * Area «Guide» — путівник по продукту. Одна сторінка без дочірніх роутів:
 * параграфи — секції з якорями, навігацію по них веде друга колонка
 * (`areas/guide-sidebar.tsx`) прокруткою, а не переходами. Звичайна розкладка,
 * не `bleed`: сторінку скролить шел.
 */
const guideRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/guide',
  component: GuidePage,
  staticData: { backdrop: 'brand' },
});

/**
 * Неіснуючий роут ПОЗА будь-якою area (`/nonsense`). Свідомо splat-роут ПІД
 * `appRoute`, а не `notFoundComponent` кореня: так 404 проходить той самий гейт
 * `beforeLoad: requireAuth`, що й решта застосунку — залогінений бачить сторінку
 * всередині шела, гість летить на /login. Промахи ВСЕРЕДИНІ area (`/chat/nope`)
 * ловить `notFoundComponent` на `appRoute`.
 * Статичні й динамічні роути ранжуються вище за splat, тож нічого не перехоплює.
 */
const notFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: () => <NotFoundPage homeTo="/workspace" />,
});

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
      customerDetailRoute,
    ]),
    calendarRoute.addChildren([calendarIndexRoute, calendarViewRoute, calendarEventRoute]),
    chatRoute.addChildren([chatIndexRoute, chatConversationRoute]),
    settingsRoute.addChildren([
      settingsGeneralRoute,
      settingsCalendarRoute,
      settingsNumberingRoute,
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
  }
}
