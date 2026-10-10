# Design

## Context

See proposal.md — Why. Today every unauthenticated page renders `min-h-screen bg-background` +
`Card` itself (four tenant pages, one platform page). The brand backdrop
(`libs/ui/src/brand-backdrop.css`, `docs/frontend/brand-backdrop.md`) already exists for `/guide`:
three blurred glows spread across the shell, a dot pattern masked to the glows, and glass tokens
declared on `:root` and substituted under `[data-backdrop='brand']`.

## Goals / Non-Goals

**Goals:** one shell for every auth page of both planes; an auth backdrop variant that adds rules
without touching any existing `.brand-backdrop` / `[data-backdrop='brand']` rule; demo sign-in that
reuses the existing submit path.

**Non-Goals:** no change to auth logic (guards, stores, mutations, `applyServerError`); no theme
switcher on the auth pages; no new dependency; no new demo credentials.

## Decisions

1. **`AuthShell` in `libs/ui/src/components/auth-shell.tsx`, props-only.** It knows neither router
   nor i18n: the app passes `logo` (the same lucide mark its rail uses: `Layers` / `ShieldCheck`),
   `productName` (`layout:brand`), `title`, optional `description`, `footer` and children. The
   alternative — each app keeping its own wrapper — is exactly the duplication being removed.
   Each app wraps it once in `features/auth/components/auth-layout.tsx` so the four tenant pages
   don't repeat the logo/name wiring.
2. **Backdrop variant via a modifier, not a fork.** `BrandBackdrop` takes `variant?: 'shell' |
   'auth'`; `auth` renders the root with `brand-backdrop brand-backdrop--auth` and omits
   `__dots`. New CSS lives only under `.brand-backdrop--auth …` selectors, which re-position the
   three glows around the viewport centre (a large primary aura, two smaller adjacent hues offset
   up-left and down-right) and set their own colours via `--auth-glow-*` tokens derived from
   `--primary` in `:root` / `.dark`. `/guide` rules are untouched (verified by diff).
3. **Glass card through the existing token pattern.** The shell root carries
   `data-backdrop="brand"`, so `--card` already becomes `--card-glass`. Auth-specific emphasis
   (gradient hairline border, stronger blur, tinted outer glow, a slightly denser light fill
   `--auth-card-fill`, one-step darker `--muted-foreground` in light theme for AA contrast) is
   scoped to `[data-slot='auth-card']`, which the shell sets on its `Card` instead of `card` —
   so the generic `[data-backdrop='brand'] [data-slot='card']` rule neither applies nor is
   edited. The gradient border is a `::before` ring cut by `mask-composite: exclude`: the
   two-layer `padding-box`/`border-box` background was rejected because the border-box
   gradient shows through the semi-transparent fill, and `border-image` drops the radius.
4. **Demo accounts as a small app-local component** (`demo-accounts.tsx` in each app's auth
   feature): reads `DEMO_ACCOUNTS` / `DEMO_PLATFORM_ACCOUNT`, groups by `tenantName` preserving
   order, renders `Button variant="outline" size="xs"` chips (two per row in a 448px card). Click → `form.reset(values)` then
   the page's `onSubmit()` (the same `handleSubmit` wrapper). The flag
   `DEMO_LOGINS_ENABLED = import.meta.env.VITE_DEMO_LOGINS !== 'false'` lives next to it.
   The block sits below the form, separated by a labelled divider, so the real form stays first.
5. **Env var location.** Vite reads `VITE_*` from the app dir or the process env; neither app has
   an `.env.example` and the root `.env.example` has no `VITE_*` section, so the switch is
   documented in `docs/frontend/brand-backdrop.md` §auth and used as a process env at build time.

## Risks / Trade-offs

- [Glass over glows lowers text contrast] → card opacity ~62% of `--card` plus blur; contrast
  of foreground/muted text checked with computed styles in both themes.
- [Demo credentials visible in the bundle] → owner decision; switch off with `VITE_DEMO_LOGINS=false`.
- [Prefill of non-seeded tenant before the demo seed lands] → the click/submit just returns the
  normal 401; acceptance uses the `Default Tenant` chip.

## Migration Plan

Frontend-only; deploys with the normal pipeline. Rollback = revert the commit.
