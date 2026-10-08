# Tasks

## 1. Spike and shared mechanism (`libs/ui`)

- [x] 1.1 Confirm in TanStack Router 1.170 that `appRoute.beforeLoad`'s `matches` contains child
      matches with their `staticData`, and how `routesByPath` keys index routes; record the result
      in design.md (choose the fallback guard from Risks if `matches` is insufficient).
- [x] 1.2 Add `libs/ui/src/navigation/`: `defineArea`, `defineNavigation`, `Area` / `NavItem`
      types, `isUnder`, `collectNavigation` (sort areas and items by order then id; throw on
      duplicate ids, duplicate or nested prefixes, unregistered area, non-finite order) — verify
      with Vitest unit tests in `libs/ui`.
- [x] 1.3 Add `NavProvider`, `useAreas`, `useActiveArea`, `useAreaItems` (route lookup +
      `parentRoute` walk + `isAllowed`; menu area hidden when empty; `rail: false` honoured) and the
      generic `AreaNav` renderer (exact/prefix highlight, mobile close) — verify with unit tests
      for the access walk, an index route under a restricted layout, and empty-menu hiding.

## 2. Tenant web: access on routes

- [x] 2.1 Augment `StaticDataRouteOption` with `access` in `apps/web/src/router.tsx`; add
      `isAllowed` for the tenant session; move `settingsRoute` from `requireAdmin` to
      `staticData.access`; add the generic check to `appRoute.beforeLoad`; delete `requireAdmin`
      — verify a USER opening `/settings/numbering` lands on `/workspace` and ADMIN opens it.

## 3. Tenant web: areas and items by discovery

- [x] 3.1 Add `*.nav.ts` declaring areas: `app-shell/workspace.nav.ts` (menu), calendar, chat,
      guide, playground (component panels), settings and account (menu, account `rail: false`),
      with today's labels, icons and orders — verify `pnpm --filter @saas-skeleton/web typecheck`.
- [x] 3.2 Add items in `*.nav.ts` of dashboard, users, customers, settings, calendar, numbering,
      ai, activities, account, notifications — verify typecheck.
- [x] 3.3 Add `apps/web/src/nav.ts` (eager glob + `collectNavigation`, default area Workspace),
      wire `NavProvider` in `main.tsx`; in `COMPOSITION_ROOTS` replace `areas.tsx` / `paths.ts`
      with `nav.ts` — verify `pnpm modules:check --strict`.
- [x] 3.4 Switch `app-rail.tsx`, `area-sidebar.tsx` and `app-shell.tsx` to the registry; delete
      `areas.tsx`, `paths.ts` unions, `area-nav.tsx`, `areas/workspace-sidebar.tsx`,
      `settings-sidebar.tsx`, `user-settings-sidebar.tsx` — verify in the browser as ADMIN and
      USER that rail, all menus, active highlighting, the avatar entry to User settings and the
      404 fallback behave as before.
- [x] 3.5 Re-check `settings → numbering` in `modules.config.ts` now that settings no longer names
      numbering's page; drop the edge if nothing else uses it — verify `pnpm modules:check --strict`.
      (Result: edge kept — the backend `apps/api/src/settings/numbering.controller.ts` still imports
      numbering contracts/service; the nav files no longer need it.)
- [x] 3.6 Snapshot test in `apps/web` printing the rail and every resolved menu for ADMIN and USER
      — verify `pnpm web:test` passes and the snapshot matches the spec's orders.
- [x] 3.7 ESLint override for `**/*.nav.ts` (no `**/pages/**`; components only `*-sidebar.tsx`
      for panels) — verify by a temporary violating import that `pnpm lint` fails.

## 4. Platform web

- [x] 4.1 Same `access` augmentation and `isAllowed` (always true); `*.nav.ts` with areas and items
      for tenants, messaging (Operations), ai, account (`rail: false`); `nav.ts` root (default area
      Tenants) + provider; rail and sidebar on the registry; delete `areas.tsx`, `paths.ts`
      unions, `area-nav.tsx` and the four sidebars; update `COMPOSITION_ROOTS` — verify typecheck
      and that the rail and every menu are unchanged in the browser.

## 5. Docs and verification

- [x] 5.1 Update `docs/modules.md` §4, §5, §7.5, `docs/frontend/app-shell.md` (terminology,
      adding an area or an item, access on routes, precedents) and
      `docs/frontend/layout-structure.md` — verify no remaining mention of `APP_AREAS`, `canSee`,
      `requireAdmin`, `AreaPrefix` or `NavPath` via grep.
- [x] 5.2 Full gate: `pnpm lint && pnpm typecheck && pnpm build && pnpm web:test`, then a live check
      in both portals as ADMIN and USER against every scenario in
      `specs/app-shell/navigation/spec.md`.
