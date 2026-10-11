# Tasks

## 1. Share the guide body between two frames (apps/web)

- [x] 1.1 `git mv features/guide/pages/guide.tsx features/guide/pages/guide-content.tsx`; export `GuideContent` (the five sections + `useGuideScrollSpy`, no `PageHeader`); verify `pnpm --filter @saas-skeleton/web typecheck` and eslint are green and the body is no longer in `guide.tsx` (history: see design.md decision 2)
- [x] 1.2 New `pages/guide.tsx`: `GuidePage` = `PageHeader` + `GuideContent` only; verify `/guide` renders exactly as before (screenshot before/after in the Orca browser, section list still follows scrolling)

## 2. Public route and frame (apps/web)

- [x] 2.1 `app-shell/app-rail.tsx`: export `RAIL_NAV_BUTTON` and `RAIL_ANCHOR_BUTTON` (no behaviour change); verify typecheck is green and the real rail at `/workspace` looks the same
- [x] 2.2 `components/public-guide-rail.tsx`: static rail — product mark (links to `/workspace`), then Workspace, Calendar, Chat, Assistant, Settings, Playground as `Link`s to their real paths and Guide as the current entry that toggles the column; tooltips and aria-labels from `layout:areas.*`; verify order and labels in the browser, and that a guest following "Calendar" ends on `/login`
- [x] 2.3 `components/public-guide-shell.tsx`: `SidebarProvider` (`data-backdrop="brand"`) + `BrandBackdrop` + `Sidebar collapsible="icon"` (rail, second column = `GuideSidebar` under a two-line header, footer bar) + `SidebarInset` (`h-14` content header with trigger, "Guide" crumb, `ThemeSwitcher`; `ScrollArea` with the content); delete the superseded `components/public-guide-layout.tsx`; verify screenshots at ~1440 and ~390 px (on the phone the trigger opens rail + column as a sheet) and that the header has no bell, assistant button or user menu
- [x] 2.4 Footer bar entry button reads `useAuthStore((s) => s.user)`: "Sign in" → `/login`, "Open the app" → `/workspace`; verify both states in the browser (signed out, signed in)
- [x] 2.5 `pages/about.tsx` (`AboutPage` = shell + `GuideContent`) and `aboutRoute` in `guide.routes.tsx` under `rootRoute`, no `beforeLoad`; add it to the tree in `router.tsx`; verify `/about` opens with no session and without redirect, and `nav.test.ts` still passes (the route adds no navigation entry)
- [x] 2.6 Verify `/about#architecture` scrolls to and marks Architecture, `/about#nope` opens at the top without error, the status filter and the status/audience badges work for a guest, and the section list in the second column follows scrolling and clicks
- [x] 2.7 `components/demo-login-cta.tsx`: large centred session-aware button ("Login to CRM Demo" → `/login`, "Open the CRM demo" → `/workspace`), rendered by `AboutPage` after `<GuideContent />` and NOT inside it, using a new `xl` size of `ui/button.tsx` (documented in `docs/frontend/ui-stack.md`); strings in `guide.json`; verify at the end of `/about` for a guest and a signed-in user, and that `/guide` ends with Key subsystems with no button

## 3. Entry points and texts

- [x] 3.1 `AuthLayout` gets an optional `footerLink`; `LoginPage` passes `<Link to="/about">`; platform login unchanged; verify the link shows on the tenant login only and opens `/about`
- [x] 3.2 Strings in English in `locales/en/guide.json` (`about.*`: sign in, open the app, sections aria-label) and `locales/en/auth.json` (`shell.about`); verify `pnpm web:test` (i18n/registry-text tests) and typecheck pass

## 4. Graph, docs and the status decision

- [x] 4.1 `docs/demo.md`: new section "Public guide `/about`" — what it is, that module statuses (`done` / `partial` / `designed` / `planned`) and audience tags are shown to guests **by owner decision of 2026-10-11** and why, where to change it (`guide.content.ts`), how to remove the exposure (delete `aboutRoute` + the login link); verify the section reads standalone, because this is what survives archiving
- [x] 4.2 `docs/frontend/brand-backdrop.md` and `docs/frontend/layout-structure.md`: list the shell-less public guide as a consumer of the default backdrop; verify no other doc still says "only `/guide`" where that is now wrong (`grep`)
- [x] 4.3 `modules.config.ts`: `guide` gains `auth` in `dependsOn`; verify `pnpm modules:check --strict` is clean

## 5. Dashboard tour tile (built before this change was opened — already done)

- [x] 5.1 `GuideTourWidget` + `guide-tour.store.ts` (guarded `localStorage`), filled into `dashboardWidgets` from `slot-fills.ts`; `/guide#<section>` hash scroll in the scroll-spy; verified in the Orca browser: tile renders, "Architecture" opens `/guide#architecture` with the section current; dismissal handler verified by a programmatic click (a pointer click was not deliverable in that pane at the time — re-check by hand)
- [x] 5.2 `guideSectionFromHash` + `guide.content.test.ts` (3 tests); `pnpm --filter @saas-skeleton/web test` 240 passed
- [x] 5.3 Graph and docs: `guide → dashboard` edge in `modules.config.ts`, slot row in `docs/modules.md`, a sentence in `docs/ai-knowledge/00-getting-started.md` with `pnpm ai:knowledge` regenerated and `ai:knowledge:check` green

## 6. Verification

- [x] 6.1 `pnpm lint && pnpm typecheck && pnpm build`, `pnpm web:test`, `openspec validate demo-3-public-guide --strict`
- [x] 6.2 Orca browser on the local stack: `/about` signed out (dark) and signed in (light), `/about#architecture`, `/about#nope`, the status filter, the login link, the collapsed column, the phone sheet at 390 px (opens, closes on choosing a section), the rail's Calendar entry (guest → `/login`, signed in → `/calendar/week`), and `/guide` unchanged after the refactor
- [ ] 6.3 After deploy to the stand: `https://<web host>/about` opens without a session (nginx SPA fallback)
- [ ] 6.4 By hand in a real browser: click the dashboard tile's "Hide the product tour" with a mouse and confirm it stays hidden after a reload (the automation pane did not deliver pointer events; only a programmatic click was verified)
