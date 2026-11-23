# Tasks

## 1. Shared UI (libs/ui)

- [x] 1.1 `BrandBackdrop` gets `variant?: 'shell' | 'auth'`; `auth` adds `brand-backdrop--auth` and omits the dots layer
- [x] 1.2 `brand-backdrop.css`: `--auth-glow-*` tokens (light/dark) and `.brand-backdrop--auth` glow geometry centred on the viewport; existing rules unchanged
- [x] 1.3 `brand-backdrop.css`: `[data-slot='auth-card']` glass — gradient hairline border, blur, inset highlight, tinted outer glow
- [x] 1.4 `AuthShell` component (`components/auth-shell.tsx`) + `exports` entry in `libs/ui/package.json`

## 2. Tenant web (apps/web)

- [x] 2.1 `AuthLayout` wrapper (logo + product name) and move login, reset-password, reset-password confirm, confirm-email onto it
- [x] 2.2 Login field order Email → Password → Organization (reset-password form follows the same order)
- [x] 2.3 Demo accounts block + prefill + `VITE_DEMO_LOGINS` switch; strings in `auth.json`

## 3. Platform web (apps/platform-web)

- [x] 3.1 `AuthLayout` wrapper and login onto it
- [x] 3.2 Demo operator chip + prefill + switch; strings in `auth.json`

## 4. Docs and verification

- [x] 4.1 `docs/frontend/brand-backdrop.md`: auth variant section
- [x] 4.2 `pnpm lint && pnpm typecheck && pnpm build`, `pnpm web:test`, `openspec validate demo-2-auth-shell --strict`
- [x] 4.3 Slot 1 stack; Orca-browser screenshots (light/dark, 1440×900 and 390 wide) of both logins; Default Tenant chip signs in; `VITE_DEMO_LOGINS=false` hides block and prefill
