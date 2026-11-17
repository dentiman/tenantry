# Design

## Context
See proposal.md for motivation. What shapes the approach:

- `useFileUpload` (`apps/web/src/features/files/components/file-upload/`) runs the two-phase
  flow (`POST /files` → presigned `PUT` → `POST /files/:id/complete`) and keeps
  `idle | uploading{progress} | processing | done | error` in `useState`. Two consumers, both
  avatar dialogs, `await upload(file)` and then attach the file.
- The shell (`apps/web/src/app-shell/`) belongs to module `app`; `files` is a platform module that
  `app` does not depend on. Features reach the shell through slots or through `infra` code
  (`docs/modules.md` §4). Existing header pattern: `NotificationBell` (ghost `icon-sm` button).
- Global client state is Zustand stores under `features/<module>/stores/`.
- The shadcn registry has no stepper; `libs/ui` has `Progress`, `Spinner`, `Collapsible`,
  `Popover`, `ScrollArea`.
- Tests are Vitest in `node` environment — logic must be testable without a DOM.
- `POST /files` creates a `PENDING` row; rows that never complete are removed by the existing
  `files.cleanup-orphans` cron. A `POST /files` now carries an `Idempotency-Key` automatically
  (`docs/idempotency.md` §7), but the endpoint has not opted in, so each call creates a row.

## Goals / Non-Goals

**Goals:**
- One activity surface that uploads use now and `UserOperation` (`uo-2`) plugs into without
  changing the shell or the component.
- The queue logic is a plain module with injected transport, covered by unit tests.
- No change for existing upload consumers.

**Non-Goals:**
- Surviving a page reload (a `File` cannot be persisted; the leave warning covers it).
- S3 multipart / resumable transfer.
- A multi-file attachment UI. The Playground exercises the queue with simulated uploads.

## Decisions

### D1. Two layers: a neutral activity registry and sources that feed it
`apps/web/src/lib/activity.ts` (module `infra`) holds a Zustand store of **activity items**:

```ts
interface ActivityItem {
  id: string;
  title: string;                      // already human-readable (file name)
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  progress?: { current: number; total: number };   // absent = indeterminate
  steps?: StepProgressItem[];         // optional stage view
  errorMessage?: string;
  startedAt: number;
  onCancel?(): void; onRetry?(): void; onDismiss(): void;
}
```

The tray reads only this store. The upload queue publishes its uploads into it; `uo-2` will
publish server operations the same way. Why data and not a component slot: every source renders
the same row, so a slot would make each feature re-implement the row and the summary chip could
not aggregate. Why in `infra`: `app` (tray) and `files` (source) both depend on it downward, and
no edge between them is needed.

### D2. The upload queue is a framework-free class; the store wraps it
`features/files/lib/upload-queue.ts` — `createUploadQueue({ transport, concurrency: 3, onChange })`
with `add(file) → { id, done: Promise<File | null> }`, `cancel(id)`, `retry(id)`, `remove(id)`.
`transport` is `{ create, put(url, file, { signal, onProgress }), complete }` — the real one calls
orval `filesCreate`/`filesComplete` and raw axios `PUT` exactly as today; tests and the Playground
pass a fake. `features/files/stores/upload.store.ts` owns the singleton queue, mirrors its state
for React, and maps each upload to an `ActivityItem`.

Upload phases map to steps `prepare → transfer → verify`; `transfer` carries `loaded/total`.

### D3. `useFileUpload` keeps its contract
`{ state, upload, reset }` and the same `FileUploadState` union. `upload(file)` adds to the queue
and awaits `done`; `state` is derived from that upload's entry in the store. `reset` detaches the
hook from the entry (the entry lives on in the tray). A queued upload reports `uploading` with
progress 0, so the dialogs need no new branch. The promise resolves even if the component has
unmounted, so the avatar is still attached after the dialog is closed mid-upload.

### D4. Cancel and retry
Cancel aborts through `AbortController` (axios `signal`) and marks the upload `canceled`;
`done` resolves `null` and the hook returns to `idle` — cancelling is not an error. Retry starts
from `prepare` with a new `POST /files`, because the presigned URL of the failed attempt may have
expired and its `PENDING` row is reclaimed by the orphan cron. A retried upload keeps its item
id and its place in the tray. Retry is offered in the tray only; the awaiting caller of the
first attempt has already received `null` — so a retried upload that succeeds is **not** attached
by the original screen. For the avatar dialogs this is acceptable (the dialog shows the error and
the dropzone again); the tray therefore offers retry only for uploads whose originator asked for
it (`add(file, { retryable })`, default `false` for `useFileUpload`). Queue-native consumers
(a future attachments list, the Playground) opt in.

### D5. Leave warning
One `beforeunload` listener, registered by the upload store while `queued + running > 0` and
removed otherwise (a permanently attached listener disables the browser's back/forward cache).

### D6. `StepProgress` in `libs/ui`
`libs/ui/src/components/step-progress.tsx`, hand-written on existing primitives (no registry
source — `docs/frontend/ui-registry.md`). Props: `steps: { key, label: ReactNode, status,
current?, total?, description? }[]`. Vertical list (`<ol>`); marker per status — check, spinner,
dot, cross, dash — from `lucide-react` in the icon token scale; a `Progress` bar under a running
step with `current/total`; `aria-current="step"` on the running one and a visually hidden status
text, so state is not colour-only. Labels are passed in already translated: the package does not
know app namespaces (`ui-stack.md` §2). The hidden status words come from the shared `common`
namespace of `libs/i18n`.

The step status union is declared here for now. When `uo-2` adds the server model it moves to
`libs/contracts` and this file imports it; the shape is already the one in
`docs/user-operations.md` §4.

### D7. The tray: header chip + popover
`apps/web/src/app-shell/activity-tray.tsx`, rendered in the header's right group before
`NotificationBell`; returns `null` with no items. Chip: ghost `sm` button — spinner, "N active ·
P%" while anything is active; a warning icon and "N failed" when only failures remain; a check
while only just-finished items remain. `P` = sum of `current` / sum of `total` over active items
that report progress. Popover (`align="end"`, `w-80`): `ScrollArea` list, newest first; a row
without steps shows a `Progress` bar, a row with steps is a `Collapsible` opening `StepProgress`;
row actions per spec. Succeeded items are removed after 4 s (timer owned by the registry so it
is not tied to the popover being open).

Why the header and not the footer bar: the footer is hidden when the sidebar is collapsed and on
mobile lives inside a sheet; an indicator of running work must stay visible. Why a popover and
not the context panel: the panel belongs to the page's record detail and is replaced on
navigation, while activity is session-wide.

### D8. Playground
`/playground/components/step-progress`: every step state side by side, and a "simulate uploads" control that
feeds the real queue with a fake transport (configurable duration and failure), so the tray,
concurrency, cancel and retry can be seen without touching storage.

## Risks / Trade-offs
- [Upload outlives the screen, attach step does not always] → the awaiting promise still resolves
  after unmount (D3); retry-after-failure is restricted to consumers that can handle it (D4).
- [Global store holds `File` objects] → entries are dropped on success after 4 s and on dismiss;
  cancelled/failed entries hold the file only until dismissed.
- [Tray duplicates the progress shown in the avatar dialog] → accepted: the dialog is the
  focused view, the tray is what remains when the dialog is closed.
- [A chip that appears and disappears shifts the header] → it sits left of the fixed icon group,
  so the icons do not move; the page-header slot shrinks instead.
- [`beforeunload` text cannot be customised] → browsers show their own wording; nothing to translate.

## Open Questions
- Whether succeeded items should also be kept in a "recent" list (history). Deferred until server
  operations exist, since their history comes from the API, not from client memory.
