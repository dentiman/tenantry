## Why
"What is running for me right now" has no shared answer in the tenant web app. A file upload
keeps its progress in the `useState` of the component that started it: leave the page and the
upload is lost, there is no queue, no cancel, no retry. Later phases (`UserOperation`: export,
import) need the same surface to show server-side work, so the client half comes first — it needs
no backend change (`docs/user-operations.md` §6, §10).

## What Changes
- **Upload queue.** Uploads move out of the component into an application-level queue: they
  continue across navigation, at most three transfer at once, each can be cancelled, a failed one
  can be retried, and the browser warns before the tab is closed while any is active.
  `useFileUpload` keeps its current API and becomes a view of one queued upload.
- **`StepProgress`.** A shared presentational component in `libs/ui`: an ordered list of steps
  (pending / running / done / failed / skipped), with a bar on a running step that reports
  measurable progress. An upload is shown with it as three steps (prepare → transfer → verify);
  server operations will use the same component later.
- **Activity tray.** One element in the shell header for everything in progress: a chip with the
  number of active items and their overall percentage, opening a list where each item shows a bar
  or its steps and offers cancel / retry / dismiss. Hidden when there is nothing to show.
- A Playground page demonstrating `StepProgress` states and the tray on a simulated queue.

Out of scope: `UserOperation` and any backend change (`uo-2`), S3 multipart, resuming an upload
after a page reload, a new multi-file attachment screen (the queue supports many files; the only
real consumer today is the avatar upload).

## Capabilities
### New Capabilities
- `files/upload-queue`: how uploads behave once started — persistence across navigation,
  concurrency, cancel, retry, the leave-page warning.
- `app-shell/activity-tray`: the shell element that lists work in progress and its step view.

### Modified Capabilities
None.

## Impact
Frontend only: `apps/web` (files feature, app shell, playground, locales) and `libs/ui` (one new
component). No API, contract or database change; `apps/platform-web` untouched. Docs:
`docs/frontend/ui-stack.md`, `docs/frontend/app-shell.md`, `docs/file-storage.md`,
`docs/user-operations.md`, `docs/roadmap.md`.
