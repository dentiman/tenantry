# Tasks

## 0. Before implementing
- [x] 0.1 Owner confirms design.md D4 (retry only for queue-native consumers), D7 (tray as a header chip with a popover, successes disappear after 4 s) and the scope without a new multi-file screen; record any correction in design.md.

## 1. `StepProgress` (`libs/ui`)
- [x] 1.1 `libs/ui/src/components/step-progress.tsx` + `exports` entry + status words in `libs/i18n` `common.json`; verify with a Vitest render test (`renderToStaticMarkup`): each status renders its marker and hidden text, the running step has `aria-current="step"` and a bar only when `current/total` is given.

## 2. Activity registry (`apps/web/src/lib/activity.ts`)
- [x] 2.1 Store with `upsert`, `remove`, auto-removal of succeeded items after 4 s, and selectors for the chip summary (active count, combined percentage, failed count); register the path under `infra` in `modules.config.ts`; verify with Vitest (fake timers): summary maths with and without measurable progress, auto-removal only of succeeded items.

## 3. Upload queue (`apps/web/src/features/files/`)
- [x] 3.1 `lib/upload-queue.ts` with injected transport: concurrency 3, FIFO start, phases, progress, cancel via `AbortSignal`, retry from the beginning, `done` promise; verify with Vitest and a fake transport: five uploads → three running; cancel a running and a waiting one; failure then retry succeeds; cancel resolves `null` without an error state.
- [x] 3.2 `stores/upload.store.ts`: singleton queue on the real transport, mapping to activity items with three steps, `beforeunload` listener only while uploads are active; verify with Vitest: item mapping per phase and listener added/removed as the active count crosses zero.
- [x] 3.3 `useFileUpload` rewritten over the store with the same API and `FileUploadState`; verify `pnpm typecheck` with the two avatar consumers untouched and a Vitest test of the state derivation (queued → uploading 0, cancel → idle, failure → error message).

## 4. Tray (`apps/web/src/app-shell/`)
- [x] 4.1 `activity-tray.tsx` (chip, popover list, row with bar or collapsible `StepProgress`, actions) mounted in `app-shell.tsx` before `NotificationBell`; strings in `layout.json`; verify with a Vitest render test of the chip in its three modes and of a row per item status.

## 5. Playground
- [x] 5.1 `/playground/components/step-progress` page (in the Components catalogue, where the other primitives live) (states gallery + simulated uploads on the real queue with a fake transport), nav entry, `playground.json` strings; verify `pnpm bundle:check` (page stays out of the start chunk).

## 6. Verification in the browser
- [x] 6.1 With the dev stack up: simulate five uploads in the Playground and check the chip count and percentage, three-at-a-time start, cancel, a forced failure with retry, auto-removal of successes, navigation to another page mid-upload, and the leave-page prompt; then change a real avatar and confirm the dialog behaves as before. Screenshot the tray in the light and dark `default` theme. Done 2026-11-17 in the Orca browser (Playground stand, both themes, real avatar on `/user-settings`); the embedded browser does not show the native leave prompt, so the listener was verified by dispatching `beforeunload` (prevented only while uploads are active). The stand's fake transport now fails only the first attempt, so a retry visibly succeeds.

## 7. Documentation
- [x] 7.1 `docs/frontend/ui-stack.md` (`StepProgress` in the package list and its conventions), `docs/frontend/app-shell.md` (activity tray and the activity registry as the way a feature reports work), `docs/file-storage.md` (frontend section: queue, cancel, retry rule from D4), `docs/user-operations.md` §6 and §10 and `docs/roadmap.md` §2.13 (status); verify every statement against the shipped code.

## 8. Gate
- [x] 8.1 `pnpm lint && pnpm typecheck && pnpm build`, unit tests of `libs/ui` and `apps/web`, `pnpm bundle:check`; `openspec validate uo-1-upload-manager-activity-tray --strict` passes.
