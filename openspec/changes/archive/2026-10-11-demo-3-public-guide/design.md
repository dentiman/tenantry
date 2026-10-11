# Design

## Context

See proposal.md — Why. Current state:

- `/guide` is a child of `appRoute`, whose `beforeLoad` runs `requireAuth` and whose component is
  `AppShell` (rail, area sidebar, header with notification bell / theme switch / assistant, context
  panel, realtime). The guide's second column (section list with scroll-spy) is the shell's area
  sidebar, fed through `useGuideSectionStore`.
- The page body (`features/guide/pages/guide.tsx`) is shell-agnostic except for two things: the
  `PageHeader` portal into the shell header, and `useGuideScrollSpy`, which listens for `scroll`
  events in capture mode and treats `event.target` as the scroller — it works for any scrollable
  element, not only the shell's `ScrollArea`.
- Pages without a session already live directly under `rootRoute` (`/login`, `/reset-password`,
  `/confirm-email`), outside the shell and outside the `requireAuth` gate; `AuthShell` draws them on
  `BrandBackdrop`. nginx serves the SPA with `try_files … /index.html`, so a new top-level path
  needs no proxy change; `/about` is unused by routes and by nginx.
- Text lives in the `guide` i18n namespace (English only); structure, icons and **statuses** live in
  `guide.content.ts` (`MODULE_GROUPS`, `status: 'done' | 'partial' | 'designed' | 'planned'`,
  `audience`). The diagram `/diagrams/architecture.html` is a static file under `public/` and is
  already served without a session.

## Goals / Non-Goals

**Goals:** one source of guide content shown in two frames; a public frame that looks like the
application (rail, section column, content header) without its live parts; `/about#section`
links; no change to `/guide` behaviour.

**Non-Goals:** no per-route SEO, meta tags or social cards; no localisation beyond the existing
English; no editing of guide content; no change to the demo seed, auth logic, backend or contracts;
no second statuses dataset for the public page; the public rail is not driven by the navigation
registry and does not try to track it.

## Decisions

1. **A separate shell-less route `/about`, same content.** `aboutRoute` is declared in
   `guide.routes.tsx` with `getParentRoute: () => rootRoute` and no `beforeLoad`, and is added to
   the tree in `router.tsx` next to the other public routes. *Alternatives:* (a) make `/guide`
   itself public — rejected: it sits under the `requireAuth` gate and the shell, so it would mean
   special-casing the gate and the shell for one path, and a guest would still be handed rail,
   notifications and assistant they cannot use; (b) copy the content into a static page —
   rejected: two sources of truth that drift, and the status filter is interactive.
2. **`GuideContent` is extracted; two thin wrappers mount it.** `git mv pages/guide.tsx
   pages/guide-content.tsx`, exporting `GuideContent` — the five
   sections plus `useGuideScrollSpy`. New `pages/guide.tsx` keeps only `GuidePage` =
   `PageHeader` + `GuideContent` (in-shell, unchanged output). Because `guide.tsx` is re-created at the old
   path, git records "modified + new file", not a rename: `git log --follow` will not reach the old
   history from `guide-content.tsx`; `git blame -C` does, and committing the bare `git mv` first
   would keep it as a true rename. New `pages/about.tsx` =
   `PublicGuideShell` + `GuideContent`. The scroll-spy is untouched: it already accepts any
   scrolling element, and the hash handling added with the dashboard tour (`/guide#architecture`)
   reads `window.location.hash`, so `/about#architecture` works with no extra code.
3. **`PublicGuideShell`: a simplified static copy of the application shell.** An earlier cut used a
   slim top bar with the section links; it read as a separate site, and the owner asked for the
   same look as the in-app guide: the sidebars. So the public frame is `SidebarProvider` (root
   `data-backdrop="brand"`, so the glass tokens apply as in `/guide`) + `BrandBackdrop` in its
   default variant + a `Sidebar collapsible="icon"` holding the static rail and the second column,
   with a footer bar under both, and a `SidebarInset` with a content header and the repository
   `ScrollArea` (the rule "scrolling a human sees goes through `ScrollArea`"; it also gives the spy
   a scroller element, as in the shell). The second column is the existing `GuideSidebar` (its
   section list reads `useGuideSectionStore` and needs no session) under a two-line header —
   `layout:brand` and the area "Guide" — in place of the real header's tenant name, which comes from
   an authenticated bootstrap request. The content header has the sidebar trigger (which on a phone
   opens rail and column together as a sheet, as in the shell), a static "Guide" crumb and
   `ThemeSwitcher`; bell, assistant button and user menu are deliberately absent. The footer bar
   carries the session-aware entry button (decision 6) where the app has the account menu.
   Rail buttons reuse the shell's metrics by exporting `RAIL_NAV_BUTTON` / `RAIL_ANCHOR_BUTTON`
   from `app-shell/app-rail.tsx` (no behaviour change there), so the two rails stay the same size
   and shape. Not reused: `AppRail`, `AreaSidebar`, `AppFooterBar` — they read the navigation
   registry, the settings bootstrap and the auth session. *Alternatives:* (a) the top-bar frame
   (above) — rejected by the owner; (b) mounting the real `AppShell` for guests — rejected: it needs
   a user for the registry, the account menu and the tenant name, and would load sockets and
   notifications; (c) `ResizeHandle` on the second column — dropped, the width is fixed at 14rem
   (a public reading page does not need it).
3a. **The rail is a static snapshot, with real destinations.** `public-guide-rail.tsx` holds a
   hand-written list — Workspace (`LayoutGrid`), Calendar (`CalendarDays`), Chat
   (`MessagesSquare`), Assistant (`SparklesIcon`), Settings (`Settings`), Playground (`Blocks`),
   Guide (`BookOpenText`, current) — with the labels of `layout:areas.*`, and the product mark
   on top linking to `/workspace`. It does not read the navigation registry: the owner expects the
   CRM's menu to grow, and the public page only needs to look "about like now". Each non-current
   entry is a `Link` to the area's real address (`/workspace`, `/calendar`, `/chat`, `/assistant`,
   `/settings`, `/playground`); a guest hits the existing `requireAuth` gate and is redirected to
   `/login` with no code of our own, a signed-in visitor lands in the area. Typed `to` values make
   removing one of those areas from a fork a compile error here, not a dead link. The current
   entry is a `button` that toggles the column, as in the real rail. *Alternative:* derive the rail
   from `useRailAreas()` — rejected: with no user the registry filters everything out, and making
   it return the full list for guests would be a second access mode in shared navigation code for
   a demo page.
4. **Statuses (and audience tags) stay visible to guests — owner decision, 2026-10-11.** The page
   renders `MODULE_GROUPS` as is: `done`, `partial`, `designed` and `planned` badges with their
   hints, the audience tags, and the status filter defaulting to "All". Rationale: the modules
   section is explicitly "what the product already has and what comes next — from done to
   planned" (`modules.description`), and the people reaching the public page — portfolio visitors
   and prospective clients — are better served by an honest picture than by a guide that shows only
   finished modules; a second, filtered dataset for guests would be two truths to keep in step.
   The statuses come from `docs/roadmap.md` and the phase plans, so the public page can only state
   what the roadmap already states. *Alternatives considered and rejected:* hiding `planned` /
   `designed` modules from guests; defaulting the public filter to "Done"; a `public` flag per
   module. If the owner later wants a gentler public view, the single place to change is
   `guide.content.ts` (statuses) or the filter default in `GuideContent` — there is deliberately no
   switch for it today. Keep this decision in `docs/demo.md` (task 4.1) so it survives archiving.
5. **Content review before exposing it.** Everything the public page shows was already reachable
   by any signed-in demo user (the demo logins are public by decision, `docs/demo.md` §6) and the
   diagram file is already served without a session. A pattern scan of `locales/en/guide.json` and
   `public/diagrams/architecture.html` for IPv4 addresses, hostnames, internal domains, API-key and
   JWT shapes found none: the guide mentions ports (`:3001`, `:3002`, `:5173`, `:5174`, `:1025`)
   and role names only as architecture labels, and the one JWT-looking match was a fragment of
   base64 font data inside the diagram. This scan is not a substitute for reading the text before
   adding sensitive wording later; guide text is product description, not an operations manual.
6. **Session-aware entry button.** The footer bar of the sidebar reads `useAuthStore((s) => s.user)`:
   no user → "Sign in" linking to `/login`; user → "Open the app" linking to `/workspace`. This
   adds the edge `guide → auth` in `modules.config.ts`. *Alternative:* a constant "Sign in" relying
   on `requireGuest` to bounce signed-in users — rejected: wrong label for them, and the edge is
   cheap and downward.
7. **Sign-in link on the tenant login page only.** `AuthLayout` gets an optional `footerLink`
   rendered after the copyright in the shell footer; only `LoginPage` passes it
   (`<Link to="/about">`). The typed `to` makes removing the guide module a compile error until the
   link is removed too — the string-link blind spot of `docs/modules.md` §6 does not apply.
   *Alternatives:* all four auth pages (reset/confirm pages are task pages opened from an email, a
   marketing link there is noise); the platform login (operators do not need the product guide).
8. **Toasts and sockets are left alone.** `ToastHost`'s guest list stays `['/login']`: a guest on
   `/about` has no socket, so the notification region never fires, and a signed-in visitor still
   gets notifications in the same top-right place — the content header is `h-14`, matching the header the
   region is already offset for.
9. **Already built outside this change: the dashboard tour tile.** `GuideTourWidget` fills the
   `dashboardWidgets` slot from the `guide` module (`slot-fills.ts`, edge `guide → dashboard`), its
   dismissal is a per-browser `localStorage` flag with guarded access, and its layout is a column
   regardless of window width because the board's column, not the window, is what narrows when side
   panels are open. Specified in `specs/guide/dashboard-tour`; tasks §5 are pre-checked.

10. **The closing call to action belongs to the public page, not to the shared content.**
   `AboutPage` renders a `DemoLoginCta` after `<GuideContent />`; `GuideContent` stays untouched, so
   `/guide` and `/about` still share every line of content (the owner asked for the button *and*
   for the reuse). Like the footer button (decision 6) it is session-aware: no user → "Login to
   CRM Demo" → `/login`; user → "Open the CRM demo" → `/workspace`. It is a plain link, not a
   one-click sign-in: `/login` already opens prefilled with the flagship demo account, so the visitor
   is one press of "Sign in" away, and signing in directly from here would couple the guide to the
   login form, its mutation and the build-time `VITE_DEMO_LOGINS` switch. *Alternatives:* a
   `footer` / `cta` prop on `GuideContent` — rejected, it puts the frame's concern into the shared
   body; a route check inside `GuideContent` — rejected for the same reason. A direct demo sign-in
   remains a possible follow-up. "Large" is a new primitive size, `xl` (48px, `text-base`, 20px icon) added to `ui/button.tsx` as a
   tagged local edit and listed in `docs/frontend/ui-stack.md`; the largest existing size, `lg` (40px),
   read as an ordinary button at the end of a long page, and a call-site `h-*` would break the rule
   that control sizes come from the primitive. `xl` is not used in forms or tables.

## Risks / Trade-offs

- [The static rail drifts from the real one when areas are added or renamed] → accepted and
  intended (Decision 3a): it is a picture for a demo page; the typed `to` values catch removals, and
  `docs/demo.md` says to refresh the list when the rail changes.
- [Visitors read "Planned"/"Designed" as gaps] → the status hints say what each means; the
  decision is the owner's and recorded above; the filter lets a reader see only "Done".
- [Public architecture details] → already public via the diagram; scan in Decision 5; removing
  exposure is deleting `aboutRoute` from `router.tsx` plus the login link (compile-checked).
- [Spy behaves differently in the public frame] → both frames give the spy a `ScrollArea`
  viewport; verified in the browser (tasks §6), including `/about#architecture` and the phone
  sheet at ~390 px.
- [A fork inherits a public marketing-ish page] → `guide` is an optional demo module (not a
  product module); dropping the module drops the route, tile and — via the compiler — the link.
- [The guest still downloads the whole SPA bundle] → accepted; no code-splitting exists for any
  route today and the page needs the same libraries.

## Migration Plan

Frontend-only; ships with the normal pipeline. After deploy, `https://<web host>/about` must open
without a session. Rollback = revert the commit; no data, contract or config changes.

## Open Questions

- Should `/about` be kept out of search engines (`noindex`)? The SPA has a single `index.html`
  and no per-route head handling, so it is a deployment-level choice (a response header on that
  path in the proxy) that can be made after the page exists without touching the specs.
