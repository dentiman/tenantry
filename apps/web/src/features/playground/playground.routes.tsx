import { createRoute, redirect } from '@tanstack/react-router';
import { appRoute } from '../../app-shell/app.routes';
import { PlaygroundPage } from './pages/playground';
import { PlaygroundComboboxPage } from './pages/playground-combobox';
import { PlaygroundDataGridPage } from './pages/playground-data-grid';
import { PlaygroundDialogPage } from './pages/playground-dialog';
import { PlaygroundInlineFormPage } from './pages/playground-inline-form';
import { PlaygroundInputPage } from './pages/playground-input';
import { PlaygroundSelectPage } from './pages/playground-select';
import { PlaygroundTabsPage } from './pages/playground-tabs';
import { PlaygroundTextareaPage } from './pages/playground-textarea';
import { PlaygroundUserSelectPage } from './pages/playground-user-select';
import { PlaygroundVerticalFormPage } from './pages/playground-vertical-form';

/**
 * Area «Playground» — візуальні стенди примітивів UI. Layout + index: стенд
 * додається роутом і рядком у
 * `app-shell/areas/playground-sidebar.tsx`.
 */
export const playgroundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/playground',
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
