# Proposal

## Why

The stand is shown to prospective clients, and the product guide (`/guide`) is the page that
explains what the system is: modules, architecture, key subsystems. Today it sits behind sign-in
and inside the application shell, so a visitor who has not signed in — a link in a portfolio, a
recruiter, a client before a call — cannot read it at all, and the shell (rail, notifications,
assistant, sockets) is not something a guest should be given just to read a page.

## What Changes

- A public page at `/about` that renders **the same guide content** as `/guide` (overview, modules
  and services, development and delivery, architecture, key subsystems), readable without a
  session. `/guide` stays as it is for signed-in users.
- The public page is framed like the application, not like a separate site: a simplified static
  copy of the shell — a rail of the app's areas (links that send a guest to the sign-in page), the
  guide's section list as the second column, a content header with the theme switch, and a footer
  bar with a sign-in / open-app button. It has none of the shell's live parts (bell, assistant,
  user menu, tenant name).
- The guide body becomes one shared component mounted by two thin wrappers: the in-shell
  `GuidePage` and the new public `AboutPage`. No content is duplicated; there is one source of
  text and structure.
- Module **statuses stay visible to guests**: the `done` / `partial` / `designed` / `planned`
  badges and the audience tags (`admin`, `operator`, `developer`) render on the public page
  exactly as inside the app. This is an owner decision, recorded in `design.md` — the guide is
  meant to show honestly what is built and what is only designed.
- The tenant sign-in page gets a quiet "About the system" link to `/about`.
- A dashboard "Product tour" tile that links signed-in users into `/guide` sections was built
  just before this change is opened; it is captured here as its own capability so its behaviour
  has a spec (see tasks §5, already done).

## Capabilities

### New Capabilities
- `guide/public-page`: what a visitor without a session sees at `/about` — shared content, status
  badges, section navigation, sign-in entry point, hash anchors, the link from the sign-in page.
- `guide/dashboard-tour`: the dismissible "Product tour" tile on the dashboard and how its links
  open the in-app guide at a section.

### Modified Capabilities
<!-- none: no existing spec covers the guide or the dashboard -->

## Impact

- `apps/web/src/features/guide/`: the page body moves into `pages/guide-content.tsx`; `guide.tsx`
  keeps only the in-shell wrapper; new `pages/about.tsx`, `components/public-guide-shell.tsx` and
  `components/public-guide-rail.tsx`; `guide.routes.tsx` gains `aboutRoute`, mounted under
  `rootRoute` in `router.tsx`.
- `apps/web/src/app-shell/app-rail.tsx`: two existing size constants become exported (no behaviour
  change) so the public rail matches the real one.
- `apps/web/src/features/auth/` (login page footer link), `locales/en/guide.json` and `auth.json`.
- `modules.config.ts`: `guide` gains the `auth` edge (the footer bar reads the session to choose
  "Sign in" vs "Open the app").
- `docs/demo.md` documents the public page and the status decision; `docs/frontend/brand-backdrop.md`
  lists the new frame as a consumer of the backdrop.
- No backend, contract, dependency, migration or auth-logic change. `/diagrams/architecture.html`
  is already served without a session; it is not changed.
