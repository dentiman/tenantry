import { lazyPage } from '@saas-skeleton/ui/lib/lazy';
import { createRoute, redirect } from '@tanstack/react-router';
import { appRoute } from '../../app-shell/app.routes';
import { PLAYGROUND_ENABLED } from './playground.flag';

/** Сторінки — окремі чанки (docs/frontend/lazy-loading.md) */
const PlaygroundPage = lazyPage(() => import('./pages/playground'), 'PlaygroundPage');
const PlaygroundCardsPage = lazyPage(
  () => import('./pages/playground-cards'),
  'PlaygroundCardsPage',
);
const PlaygroundComboboxPage = lazyPage(
  () => import('./pages/playground-combobox'),
  'PlaygroundComboboxPage',
);
const PlaygroundDataGridPage = lazyPage(
  () => import('./pages/playground-data-grid'),
  'PlaygroundDataGridPage',
);
const PlaygroundDialogPage = lazyPage(
  () => import('./pages/playground-dialog'),
  'PlaygroundDialogPage',
);
const PlaygroundInlineFormPage = lazyPage(
  () => import('./pages/playground-inline-form'),
  'PlaygroundInlineFormPage',
);
const PlaygroundInputPage = lazyPage(
  () => import('./pages/playground-input'),
  'PlaygroundInputPage',
);
const PlaygroundPopupsPage = lazyPage(
  () => import('./pages/playground-popups'),
  'PlaygroundPopupsPage',
);
const PlaygroundSelectPage = lazyPage(
  () => import('./pages/playground-select'),
  'PlaygroundSelectPage',
);
const PlaygroundTabsPage = lazyPage(() => import('./pages/playground-tabs'), 'PlaygroundTabsPage');
const PlaygroundTextareaPage = lazyPage(
  () => import('./pages/playground-textarea'),
  'PlaygroundTextareaPage',
);
const PlaygroundUserSelectPage = lazyPage(
  () => import('./pages/playground-user-select'),
  'PlaygroundUserSelectPage',
);
const PlaygroundVerticalFormPage = lazyPage(
  () => import('./pages/playground-vertical-form'),
  'PlaygroundVerticalFormPage',
);

/**
 * Area «Playground» — візуальні стенди примітивів UI. Layout + index: стенд
 * додається роутом і рядком у
 * `app-shell/areas/playground-sidebar.tsx`.
 */
export const playgroundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/playground',
  // Вимкнений Playground (`playground.flag.ts`) не має й прямих адрес — не лише пункту в рейлі
  beforeLoad: () => {
    if (!PLAYGROUND_ENABLED) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/', replace: true });
    }
  },
});

/** `/playground` → перший стенд каталогу: «домівка» area мусить щось показувати */
export const playgroundIndexRoute = createRoute({
  getParentRoute: () => playgroundRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/playground/components/buttons', replace: true });
  },
});

export const playgroundVerticalFormRoute = createRoute({
  getParentRoute: () => playgroundRoute,
  path: 'vertical-form',
  component: PlaygroundVerticalFormPage,
});

export const playgroundInlineFormRoute = createRoute({
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
export const playgroundComponentsRoute = createRoute({
  getParentRoute: () => playgroundRoute,
  path: 'components',
});

/** General Components: спільна libs/ui, придатна для обох фронтів (web і platform-web) */
export const playgroundComponentsButtonsRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'buttons',
  component: PlaygroundPage,
});

/**
 * General Components: Card — каталог карткових ПОВЕРХОНЬ. Окремий стенд, бо
 * вигляд картки задає не проп, а фон під нею, і різницю видно лише поруч:
 * сторінка перемикає сцену між звичайним полотном і брендовим фоном.
 */
export const playgroundComponentsCardsRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'cards',
  component: PlaygroundCardsPage,
});

/**
 * General Components: Popups — меню, списки й картки-підказки на різних фонах. Окремий
 * стенд, бо попап лежить поверх тексту сторінки, і суцільний `--popover` на брендовому
 * склі виглядає сірою плямою: тут добирають густину скла й розмиття.
 */
export const playgroundComponentsPopupsRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'popups',
  component: PlaygroundPopupsPage,
});

/** General Components: Combobox — пошук-з-попапом, фундамент усіх бізнес-селектів */
export const playgroundComponentsComboboxRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'combobox',
  component: PlaygroundComboboxPage,
});

/** General Components: Input + адорнований InputGroup — бандл на одній сторінці */
export const playgroundComponentsInputRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'input',
  component: PlaygroundInputPage,
});

/** General Components: Select — базовий випадаючий список */
export const playgroundComponentsSelectRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'select',
  component: PlaygroundSelectPage,
});

/** General Components: Textarea — багаторядкове текстове поле */
export const playgroundComponentsTextareaRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'textarea',
  component: PlaygroundTextareaPage,
});

/** General Components: другий приклад — задає шаблон для решти каталогу */
export const playgroundComponentsTabsRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'tabs',
  component: PlaygroundTabsPage,
});

/**
 * Стенд DataGrid на фейкових інвойсах. `bleed` — як у справжніх списків
 * (Customers/Users): грід сам тримає поля й упирається в краї полотна
 */
export const playgroundComponentsDataGridRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'data-grid',
  component: PlaygroundDataGridPage,
  staticData: { layout: 'bleed' },
});

/** Platform Components: бізнес-орієнтовані, з бекендом, лише в tenant-порталі */
export const playgroundComponentsUserSelectRoute = createRoute({
  getParentRoute: () => playgroundComponentsRoute,
  path: 'user-select',
  component: PlaygroundUserSelectPage,
});

export const playgroundDialogRoute = createRoute({
  getParentRoute: () => playgroundRoute,
  path: 'dialog',
  component: PlaygroundDialogPage,
});
