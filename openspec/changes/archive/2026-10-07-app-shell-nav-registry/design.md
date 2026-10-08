# Design

## Context

Both frontends use a two-level shell (docs/frontend/app-shell.md). `APP_AREAS` in
`app-shell/areas.tsx` is the rail: each entry has `id`, `prefix: AreaPrefix`, `labelKey`, `icon`,
optional `hiddenFromRail` / `canSee`, and a `Sidebar` component for the second column.
`resolveArea(pathname)` and `DEFAULT_AREA` are read by `app-rail.tsx` and `area-sidebar.tsx` only.
Menu areas pass a hand-written `items` array to a local `AreaNav` (identical copies in both apps);
paths are typed through manual `AreaPrefix` / `NavPath` unions in each `paths.ts`.

Tenant portal today:

| Area (owner)                   | Second column                       | Items named from other modules     |
| ------------------------------ | ----------------------------------- | ---------------------------------- |
| Workspace (`app`)              | menu: Dashboard, Users, Customers   | dashboard, users, customers        |
| Calendar (`calendar`)          | component: mini-month               | —                                  |
| Chat (`chat`)                  | component: conversation list        | —                                  |
| Settings (`settings`, ADMIN)   | menu: 5 items                       | calendar, numbering, ai, activities |
| Playground (`playground`)      | component: collapsible catalogue    | —                                  |
| Guide (`guide`)                | component: contents with scroll-spy | —                                  |
| User settings (`account`, no rail) | menu: 5 items                   | notifications                      |

Platform: Tenants (`tenants`), Operations (`messaging`), AI (`ai`) and User settings (`account`,
no rail) — all menus, no roles. `areas.tsx` itself imports every panel component, so it is the
upward link at level 1.

Access today: `settingsRoute.beforeLoad: requireAdmin` plus `canSee: role === 'ADMIN'` on the
Settings area. TanStack Router is 1.170: `beforeLoad` receives `matches`, `linkOptions` exists,
`staticData` is already augmented in each `router.tsx`. Neither app has code splitting today.

## Terminology

| Level | UI                    | Code       | Declared by                    | What it is                                              |
| ----- | --------------------- | ---------- | ------------------------------ | ------------------------------------------------------- |
| 1     | `AppRail`             | `Area`     | the module owning the prefix   | a section: URL prefix, label, icon, order, panel        |
| 2     | `AreaSidebar`         | panel      | the area                       | either the area's **menu** or the area's own component  |
| 2     | menu entry            | `NavItem`  | any module depending on the area | a typed link into one area's menu                     |
| (3)   | heading inside a menu | `NavGroup` | the area — **not built now**   | for Playground-style sub-sections later                 |

"Menu / submenu" is avoided in code: the rail is a section switcher, not a link list, and "submenu"
would blur levels. In conversation: rail = main menu of areas, an area's menu = its submenu.

## Goals / Non-Goals

**Goals:**
- No module names another module's area or page from below; contributions point downward only.
- Adding or removing a feature's area or menu entries touches only that feature's folder.
- Route access is declared once and drives the guard, menu items and rail areas.
- One mechanism, shared by both frontends.

**Non-Goals:**
- Moving `slot-fills.ts` to discovery — same pattern, separate follow-up change.
- A per-app override layer (hide/reorder by id). Ids stay stable so it can be added later.
- RBAC permissions or tenant entitlements in `access`. The shape leaves room; only `roles` exists.
- `NavGroup`, and turning Playground's catalogue into a registry menu; Playground keeps its
  component panel.
- Changing `/` → `/workspace` redirect or the 404 `homeTo`; they stay in `app.routes.tsx`.

## Decisions

### 1. The area is the menu; both are declared by owners in `<module>.nav.ts`

```ts
// features/settings/settings.nav.ts — owner of /settings
export const settingsArea = defineArea({
  id: 'settings',
  prefix: linkOptions({ to: '/settings' }),
  label: 'layout:areas.settings',
  icon: Settings,
  order: 40,
  panel: 'menu',
});

export default defineNavigation({
  areas: [settingsArea],
  items: [
    { id: 'settings.general', area: settingsArea, order: 10, match: 'exact',
      link: linkOptions({ to: '/settings' }), label: 'settings:nav.general', icon: Building2 },
  ],
});

// features/calendar/calendar.nav.ts — owns an area AND contributes to another
export const calendarArea = defineArea({
  id: 'calendar', prefix: linkOptions({ to: '/calendar' }), label: 'layout:areas.calendar',
  icon: CalendarDays, order: 20, panel: CalendarSidebar,
});
export default defineNavigation({
  areas: [calendarArea],
  items: [{ id: 'calendar.settings', area: settingsArea, order: 20,
            link: linkOptions({ to: '/settings/calendar' }), label: 'settings:nav.calendar',
            icon: CalendarCog }],
});
```

- An item references its area by importing the area constant: the edge `calendar → settings` is a
  real import that `modules:check` sees and `dependsOn` must declare (all needed edges exist).
- `panel: 'menu'` → the shell renders `AreaNav` with the area's items. Otherwise `panel` is a
  component (eager, or `lazy(() => import('./chat-sidebar'))`) rendered in the second column.
- `rail: false` keeps an area out of the rail (User settings, entered from the avatar menu).
- Workspace is declared by the shell itself (`app-shell/workspace.nav.ts`); the platform's Tenants
  by `tenants`.
- Items are data, not components: the shell renders every menu identically and the same records can
  feed breadcrumbs or a command palette later. Existing i18n keys are reused (no copy change).

Initial orders reproduce today: tenant rail Workspace 10 / Calendar 20 / Chat 30 / Settings 40 /
Playground 50 / Guide 60 (User settings 90, `rail: false`); platform Tenants 10 / Operations 20 /
AI 30 (User settings 90). Items: workspace 10/20/30; settings 10…50; user-settings 10…50; platform
menus 10, 20, 30 in current order.

*Alternative — separate menu token (`defineMenu`)* (first draft of this change): a third concept
with nothing of its own; every menu belongs to exactly one area. Dropped.

*Alternative — string parent id* (Shopware `parent: 'sw-customer'`, Magento/Odoo `parent=`): lets
third-party plugins reference an area without a code dependency. One repo plus a module-graph
check makes the import strictly better: typo → compile error, edge → visible.

*Alternative — `staticData.nav` on routes* (menu = route tree): detail pages have no entry, an item
may target a filtered list, a route may sit in two menus. Routes contribute only `access`.

*Alternative — event/mutator* (Sylius `MenuBuilderEvent`, WordPress `admin_menu`): imperative,
order depends on listener order. Rejected.

*Alternative — keep the rail central* (first draft): justified by "rail order is a UX decision";
an explicit `order` plus the snapshot test keeps that decision reviewable without the shell
importing every feature's panel.

### 2. Discovery with an eager glob in one composition root per app

```ts
// apps/web/src/nav.ts
const modules = import.meta.glob<NavigationModule>(
  ['./features/*/*.nav.ts', './app-shell/*.nav.ts'],
  { eager: true, import: 'default' },
);
export const NAVIGATION = collectNavigation(modules, { defaultArea: workspaceArea });
```

Vite compiles this into static imports (named import → tree-shakable); there is no runtime scan.
`collectNavigation` sorts areas and per-area items by `(order, id)` and throws at module load on a
duplicate area/item id, a duplicate or nested area prefix, an item whose area is not registered,
or a non-finite order — so `pnpm web:dev` and the snapshot test fail loudly. The root also names
the **default area** (where a path outside every area falls back): app wiring, so it lives in the
root, not on an area. `main.tsx` passes `NAVIGATION` and the access predicate to `NavProvider`
(same shape as `SlotsProvider`); the shell reads `useAreas()`, `useActiveArea()`,
`useAreaItems(area)`, so `app-shell` never imports the root.

`eager: true`, not lazy: the files are small, the app has one chunk, and a lazy glob would make the
whole navigation asynchronous for no gain. Heavy panels opt into `lazy()` individually.

Precedent: Shopware 6 Administration loads every core module with
`import.meta.glob('./*/index!(*.spec).{j,t}s')`; each module registers `navigation` entries with
`position`, `parent` and `privilege`, top-level and child entries in the same call — the same
two-level shape as here. Filament (auto-registered resources, `$navigationSort`,
`$navigationGroup`), Medusa admin (`src/admin/routes/**/page.tsx` + `defineRouteConfig({ rank,
nested })`) and Magento (`menu.xml` per module, `sortOrder`, ACL `resource`) follow the same
"declare with the owner, collect automatically, gate by permission" scheme.

*Alternative — explicit list in the root*: rejected by the product owner; it is the current
central list moved to another file.

### 3. Access lives on the route; everything else derives from it

```ts
// router.tsx augmentation (per app)
interface StaticDataRouteOption { access?: RouteAccess }   // web: { roles?: readonly Role[] }

export const settingsRoute = createRoute({ path: '/settings', staticData: { access: { roles: ['ADMIN'] } } });
```

- **Guard.** `appRoute.beforeLoad` keeps `requireAuth`, then checks `staticData.access` of every
  entry in `matches`; the first denial redirects to the portal home. `requireAdmin` is deleted. A
  restriction on a layout therefore covers all its children.
- **Item.** For `item.link.to`, look the route up (`routesByPath`) and walk `parentRoute` to the
  root, collecting `access`; visible iff every one admits the user.
- **Area.** Visible in the rail iff `rail !== false`, its prefix route passes the same walk, and —
  for `panel: 'menu'` — at least one item survives. `AppArea.canSee` is removed.
- **Predicate.** `isAllowed(access, session)` is one pure function per app (web: role membership;
  platform: always true until operators get roles). Future permissions/entitlements extend this
  function and `RouteAccess`, nothing else.

*Alternative — `visible(ctx)` per entry*: two rules that can disagree, exactly the current
`canSee` / `requireAdmin` split. A narrower per-entry predicate can be added if a real case
appears.

### 4. Active area from the URL

`useActiveArea()` = the registered area whose prefix contains the pathname (`isUnder`, kept), else
`undefined` → rail highlights nothing, `AreaSidebar` shows the default area. Same doctrine as
today's `resolveArea`; only the source changes from `APP_AREAS` to the registry. Prefixes must not
nest (checked by `collectNavigation`), so "the first match" is unambiguous without ordering rules.

### 5. Mechanism lives in `libs/ui/src/navigation/`

`defineArea`, `defineNavigation`, `collectNavigation`, `NavProvider`, `useAreas`,
`useActiveArea`, `useAreaItems`, `AreaNav` — generic over the app's `RouteAccess` / session types;
`libs/ui` already depends on TanStack Router. Each app keeps its own `nav.ts`, `isAllowed`,
`*.nav.ts` files and `staticData` augmentation. Removed: both `areas.tsx`, both `paths.ts` unions
(`isUnder` moves to `libs/ui`), both `area-nav.tsx`, `areas/workspace-sidebar.tsx`, the settings and
account sidebars, the platform tenants/operations/AI/account sidebars.

### 6. Guard rails for the convention

- ESLint override for `**/*.nav.ts`: `no-restricted-imports` for `**/pages/**`; components are
  allowed only for `panel` and only from `*-sidebar.tsx` (the panel files that exist today), so a
  menu file cannot pull a page into the eager graph once code splitting arrives.
- `COMPOSITION_ROOTS`: replace `app-shell/areas.tsx` and `app-shell/paths.ts` with `nav.ts` in both
  apps. The glob is invisible to `modules:check`, but every edge it would carry is also a real
  import inside a `*.nav.ts` file.
- Snapshot test (`apps/web`, Vitest) prints the resolved rail and every menu for ADMIN and USER as
  `area(order): item(order), …`; a reorder or a lost entry shows up as a diff. `libs/ui` unit tests
  cover sorting, ties, duplicate/nested-prefix detection, empty-menu hiding and the access walk.

## Risks / Trade-offs

- [`matches` in the parent's `beforeLoad` might not include child matches] → **verified (task
  1.1, router-core 1.171):** `beforeLoad` receives the full `matches` array for the location, each
  with `staticData`, so one guard on `appRoute` is enough; the fallback was a tiny `guard` helper each restricted route sets as `beforeLoad`, still reading
  its own `staticData.access`, so the single source is preserved.
- [`routesByPath` keys index routes with a trailing slash (`/settings/`)] → lookup normalises; the
  walk from either the index or the layout reaches the same `access`. Unit-tested against a real
  router in `libs/ui/src/navigation/navigation.test.ts`.
- [Order lives in many files] → snapshot test makes the overall rail and menus reviewable; gaps
  of 10.
- [Panel components are eager imports of `*.nav.ts`] → no cost today (single chunk); `lazy()` is
  supported per panel when splitting arrives.
- [Glob is Vite-only] → both apps and Vitest are Vite; Jest is backend-only.
- [Platform-web has no Vitest] → covered by `libs/ui` tests and typecheck; no snapshot there.
- [Hidden ≠ secure] → unchanged: backend `@Roles` stays the enforcement.

## Migration Plan

Pure frontend refactor with no data. Order: mechanism in `libs/ui` → web access/guard → web areas
and menus → platform-web → docs. Each step keeps the app working; rollback is a revert.
Docs to promote before archive: `docs/modules.md` §4 (areas and items as extension points next to
slots), §5 (`nav.ts` as a root, `*.nav.ts` suffix), §7.5 (remove "areas.tsx / menus / paths.ts
central on purpose"), `docs/frontend/app-shell.md` (terminology table, adding an area or an item,
access on routes), `docs/frontend/layout-structure.md` (names).
