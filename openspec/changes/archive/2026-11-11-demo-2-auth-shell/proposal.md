# Proposal

## Why

The stand is about to be shown to prospective clients. The sign-in pages are the first screen
they see, and today each one draws its own plain `Card` on a flat canvas, and the presenter has
to type a tenant, an email and a password from memory. The demo dataset (seeded in parallel)
introduces several tenants and accounts whose credentials are static and intentionally public.

## What Changes

- A single shared `AuthShell` in `libs/ui` used by every unauthenticated page of both frontends
  (tenant: login, reset-password, reset-password confirm, confirm-email; platform: login): full
  window brand backdrop, a centered glass card, a header with the product mark and name, a
  content slot and a quiet footer.
- A new `auth` variant of the existing `BrandBackdrop`: soft blurred colour glows gathered into a
  single aura behind the card, **no dot pattern**. `/guide` and the rest of the shell are unchanged.
- A glass card treatment (semi-transparent `--card` + blur, gradient hairline border, top inset
  highlight, faint brand-tinted outer glow), restricted to the auth shell.
- Tenant login field order: Email → Password → Organization (optional), the latter moved from
  first to last. Label and semantics unchanged.
- Demo sign-in on both login pages, driven by the shared demo-account list in
  `@saas-skeleton/contracts/demo`: the form is prefilled with the flagship account, and a
  "Demo accounts" block of chips (grouped by tenant) signs in with one click through the same
  submit path as manual sign-in. A build-time switch `VITE_DEMO_LOGINS=false` turns both off.

## Capabilities

### New Capabilities
- `auth/sign-in-page`: what an unauthenticated visitor sees and can do on the sign-in pages of
  both planes — field order, demo prefill and one-click demo sign-in, and the switch that hides them.

### Modified Capabilities
<!-- none: no existing spec covers the sign-in pages -->

## Impact

- `libs/ui`: new `components/auth-shell.tsx` (+ `exports` entry), `brand-backdrop.tsx` gains a
  `variant` prop, `brand-backdrop.css` gains `--auth` modifier rules and auth-card glass rules.
- `apps/web/src/features/auth/pages/*` (all four pages move onto the shell).
- `apps/platform-web/src/features/auth/pages/login.tsx`.
- Locale files `auth.json` in both frontends (English only).
- `docs/frontend/brand-backdrop.md` documents the variant.
- No backend, contract, dependency or auth-logic change. Demo credentials are read, not copied.
