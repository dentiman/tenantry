## Why
Work that outlives one request — export, import, report generation — is invisible to the user
today: after `202` nothing shows that it is running, how far it got, or whether it failed, until
(maybe) a notification arrives. The client half (activity tray, `StepProgress`) and the
`Idempotency-Key` it relies on are built (`uo-0`, `uo-1`); this phase adds the server resource
behind them and proves the whole path on the simplest real consumer, a customer export
(`docs/user-operations.md` §5, §7, §10).

## What Changes
- **`UserOperation`** — a tenant-scoped resource owned by the user who started it: status
  (`QUEUED → RUNNING → SUCCEEDED / FAILED / CANCELED`), optional measurable progress, optional
  steps, a result, a machine error code, cooperative cancellation. Read, list (own only) and
  cancel through `/user-operations`; a short-lived download link for a result file.
- Live updates over the existing socket (`user-operation.changed.v1` with a monotonic
  `revision`, REST stays the source of truth); a stalled operation is failed by a sweeper instead
  of hanging; finished operations and their result files are removed after 30 days; deleting a
  user deletes their operations.
- An in-app notification when an operation finishes or fails.
- **Customer export to CSV** — the first consumer: started from the customers grid with its
  current filters, runs in the worker, reports progress, ends with a downloadable file.
- The activity tray shows the user's operations next to uploads and offers "Download" on a
  finished export; the step status type moves from `libs/ui` to `libs/contracts`.

Out of scope: steps in a real consumer and resumable batches (`uo-3`, customer import), XLSX,
operations on the platform plane (owner decision 2026-11-17), an admin view of other users'
operations, a history page beyond the tray.

## Capabilities
### New Capabilities
- `user-operations/operation`: the operation resource — ownership, lifecycle, progress, cancel,
  live updates, stall handling, retention, result download, completion notification, tray.
- `customers/export`: exporting the customer list with the grid's filters to a CSV file.

### Modified Capabilities
None.

## Impact
New migration (`user_operations`, RLS); new platform module `user-operations` across
`libs/contracts`, `libs/shared`, `apps/api`, `apps/worker`, `apps/web`; one new endpoint in
`customers`; two notification types; one socket event; two crons (stall sweeper, retention) on
the existing topology; OpenAPI + orval regeneration. Docs: `docs/user-operations.md` (promoted
from design.md), `docs/customers.md`, `docs/event-driven-architecture.md` (new commands),
`docs/realtime.md` (new event), `docs/frontend/app-shell.md` §5.7, `AGENTS.md` map, roadmap.
