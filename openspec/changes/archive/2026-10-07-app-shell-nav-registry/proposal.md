## Why

Routes already live with their modules (docs/modules.md §7.4), but the navigation that leads to
them does not. `app-shell/areas.tsx` imports every area's panel (`ChatSidebar`, `CalendarSidebar`,
`SettingsSidebar`…), so a fork cannot drop chat without editing the shell. Inside the areas,
`workspace-sidebar.tsx` hard-codes Users and Customers, `settings-sidebar.tsx` hard-codes the pages
of calendar, numbering, AI and activities, and `user-settings-sidebar.tsx` hard-codes the
notifications page: a lower module knows the paths of the features above it — the same upward
link the route split removed. Role checks are also split: `canSee` hides a rail area,
`requireAdmin` blocks the route, and nothing keeps the two in step.

## What Changes

- **Two levels, one navigation model.** Level 1 is an **Area** (a rail entry that owns a URL
  prefix and a panel); level 2 is a **NavItem** (a link in an area's menu). The area *is* the
  menu: an item names the area it goes into. No separate menu token.
- **Both levels are declared by their owners.** A module that owns a URL prefix declares its area
  (`defineArea`) in `features/<module>/<module>.nav.ts`; any module contributes items to any area
  it depends on in the same file (`defineNavigation({ areas, items })`), importing the area — an
  ordinary downward edge.
- **An area's panel is either its menu or its own component.** `panel: 'menu'` (Workspace,
  Settings, User settings, all platform areas) or a component — eager or `lazy()` — for areas whose
  second column is not a link list (Chat conversations, Calendar mini-month, Guide contents,
  Playground's catalogue). An area may stay out of the rail (`rail: false`, User settings).
- **Discovery instead of lists.** Each frontend collects every `*.nav.ts` with one
  `import.meta.glob(…, { eager: true })` in a composition root. Adding a feature touches only its
  folder; deleting the folder removes its area and items. Order is a numeric `order` on areas and
  on items (ties by `id`); duplicate ids fail at startup in dev. `areas.tsx` (`APP_AREAS`) and the
  `AreaPrefix` / `NavPath` unions are removed; links are typed by TanStack Router's `linkOptions`.
- **One source of access.** A route declares who may enter it in `staticData.access`; one generic
  guard on the app layout enforces it. An item is visible exactly when its target route admits the
  user; an area when its prefix route does and, for a menu area, at least one item remains.
  `requireAdmin` and `AppArea.canSee` are removed.
- **Both frontends.** The mechanism (area and item definitions, collection, provider, `AreaNav`,
  access walk) moves to `libs/ui`, generic over each app's access context.
- A snapshot test prints the resolved rail and menus so an order change is visible in review.

Visible behaviour does not change for any existing user: same areas, same items, same order, same
redirects.

## Capabilities

### New Capabilities

- `app-shell/navigation`: which rail areas and menu items a user sees, in what order, how the
  active area is chosen, and how navigation stays consistent with the routes the user may open —
  for both portals.

### Modified Capabilities

None.

## Impact

- `apps/web/src/app-shell/`: `areas.tsx`, `paths.ts` (`AreaPrefix`, `NavPath`), `area-nav.tsx`,
  `areas/workspace-sidebar.tsx` removed; `app-rail.tsx`, `area-sidebar.tsx`, `app-shell.tsx` read the
  registry. Feature sidebars that were only menus (settings, account) are removed; container panels
  (chat, calendar, guide, playground) stay as components referenced from their `*.nav.ts`.
  `auth.guards.ts`, `*.routes.tsx` with access, a new `nav.ts` root.
- Same set in `apps/platform-web/src/` (tenants, operations, AI, user settings).
- `libs/ui`: new navigation module; both `area-nav.tsx` copies removed.
- `modules.config.ts`: `nav.ts` roots replace `areas.tsx` / `paths.ts` in `COMPOSITION_ROOTS`;
  `settings → numbering` re-checked.
- Docs: `docs/modules.md` §4, §5, §7.5, `docs/frontend/app-shell.md`,
  `docs/frontend/layout-structure.md`.
- No backend, API, contract or migration changes. Backend `@Roles` stays the real enforcement.
