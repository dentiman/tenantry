# Tasks

## 1. Dock
- [x] 1.1 `lib/activity.ts`: drop the auto-removal timer, add `collapsed` (persisted), `reveal`, `closeAll`, `kind`, `activityHeadline`; verify with Vitest (finished items stay, close cancels active and removes all, headline priorities).
- [x] 1.2 `app-shell/activity-dock.tsx` replaces `activity-tray.tsx`, mounted inside `SidebarInset`; sources set `kind` and call `reveal()`; verify with Vitest render tests (expanded, collapsed, headline, row actions).
- [x] 1.3 Verify in the browser, both themes: batch with a failure, steps, hover actions, collapse + reload memory, auto-expand, close confirmation, position with the assistant open, a real export with Download.

## 2. Documentation
- [x] 2.1 `docs/frontend/app-shell.md` §5.7, `docs/user-operations.md` §6.3 and §10, `docs/roadmap.md` §2.13, wording in `ui-stack.md` and `file-storage.md`.

## 3. Gate
- [x] 3.1 `pnpm lint && pnpm typecheck && pnpm build`, web unit tests, `pnpm bundle:check`; `openspec validate uo-4-activity-dock --strict`.
