# Tasks

## 0. Before implementing
- [x] 0.1 Owner confirms design.md D4 (count before the transaction, 50,000 cap), D5 (guarded claim instead of `runOnce`, retry re-claims by heartbeat), D7 (private result object, no `files` row) and D10 (succeeded export stays in the tray until downloaded or dismissed); record corrections in design.md.

## 1. Contracts
- [x] 1.1 `libs/contracts/src/user-operation/`: operation response/list query/status/step schemas, error codes, `defineUserOperationType`, socket event, notification types; composition root `user-operation-types.ts`; wire into `socket-events.ts` and `notification-types.ts`; move `StepStatus` here and re-export from `libs/ui`; verify `pnpm typecheck`.
- [x] 1.2 `customers.export` type + `ExportCustomersSchema` (list filters without pagination) + `CUSTOMER_EXPORT_MAX_ROWS` in customer contracts; verify `pnpm typecheck`.

## 2. Data
- [x] 2.1 Prisma model + migration `user_operations` (RLS template, composite FK to users with cascade, indexes per D1); verify `pnpm api:test:e2e -- rls.e2e-spec`.

## 3. Runtime (`libs/shared/src/user-operations/`)
- [x] 3.1 `UserOperationsService.start(tx, …)`, guarded transitions (D2), `assertOwnOperation`; verify by e2e of group 6.
- [x] 3.2 `runOperation` + `OperationContext` (claim/re-claim, throttled progress with heartbeat and cancel check, `checkpoint`, `step`, `succeed`, failure mapping, notification + socket emit after commit); verify with Vitest on the throttling/claim decision logic and by e2e of group 6.
- [x] 3.3 Register `user-operations` in `modules.config.ts` (tier `platform`, edges per D3); verify `pnpm lint`.

## 4. API (`apps/api/src/user-operations/`)
- [x] 4.1 `GET /user-operations` (`active`), `GET /:id`, `POST /:id/cancel`, `GET /:id/result-url`, owner-only; `pnpm openapi:generate && pnpm web:codegen`; verify by e2e 6.1–6.4.
- [x] 4.2 `POST /customers/export` (`@Idempotent()`, count + cap, start + publish in one tx, 202); verify by e2e 6.5–6.6.

## 5. Worker
- [x] 5.1 `customers.export` command + subscriber: page through matches in the same order as the list, CSV per D11, progress, checkpoint per page, `putObject`, `succeed`; verify by e2e 6.7 and a Vitest test of the CSV writer (BOM, quoting, formula guard, columns).
- [x] 5.2 Crons `user-operations.sweep-stalled` (5 min) and `user-operations.purge-finished` (daily) in the topology; verify by e2e 6.8–6.9.

## 6. E2E (`apps/api/test/user-operations.e2e-spec.ts`)
- [x] 6.1 Owner-only: colleague, admin and another tenant get 404 on get/cancel/result-url; list returns own only.
- [x] 6.2 Cancel: queued → CANCELED at once and the handler does nothing when the job runs; running → stops at checkpoint, CANCELED, no result; finished → unchanged.
- [x] 6.3 Final state is immutable: a late progress/succeed after cancel or STALLED changes nothing (direct runtime calls).
- [x] 6.4 Result link only for SUCCEEDED and not expired.
- [x] 6.5 Export start: 202 QUEUED, exactly one job; same Idempotency-Key → same operation, one job; concurrent `Promise.all` → one operation.
- [x] 6.6 Over the cap → 400, no operation (cap lowered through a test seam).
- [x] 6.7 Full run (subscriber invoked directly): file content matches the filtered list across pages, progress reached total, notification recorded once, other tenant's customers absent.
- [x] 6.8 Sweeper: RUNNING with an old heartbeat → FAILED/STALLED + notification; fresh one untouched; QUEUED untouched.
- [x] 6.9 Retention: operation finished 31 days ago is deleted with its object, 29 days kept; deleting a user deletes their operations.

## 7. Web
- [x] 7.1 `features/user-operations/`: active-operations query, socket revision sync, reconnect refetch, tray source with cancel/dismiss/download; `ActivityItem.action` + row button + linger rule; verify with Vitest (mapping per status, revision ordering, download items do not auto-disappear) and a render test of the action button.
- [x] 7.2 Export button in the customers grid toolbar + notification texts and click targets; strings in locales; verify `pnpm typecheck` and `pnpm bundle:check`.

## 8. Live check
- [x] 8.1 Dev stack up: export a filtered customer list of a demo tenant, watch progress in the tray, reload mid-run, cancel one export, download a finished one and open it (BOM, columns, formula guard), see the notification; screenshot the tray with a download action in both themes. Clean up test operations. Done 2026-11-18: real reload-and-cancel was checked with the worker stopped (an export of 32 rows finishes before anything can be clicked); progress-mid-run and running-cancel are covered by e2e. Found and fixed: the chip said "Done" when only a cancelled item remained.

## 9. Documentation
- [x] 9.1 Promote D1–D10 into `docs/user-operations.md` (built parts in present tense, §10 status), `docs/customers.md` (export), `docs/event-driven-architecture.md` (commands, crons, guarantees per §6 of the conventions), `docs/realtime.md` (event), `docs/frontend/app-shell.md` §5.7 (`action`), `AGENTS.md` map line, `docs/roadmap.md` §2.13.

## 10. Gate
- [x] 10.1 `pnpm lint && pnpm typecheck && pnpm build`, unit tests, `pnpm bundle:check`, `bash scripts/ci-verify.sh`; `openspec validate uo-2-user-operations-customer-export --strict`.
