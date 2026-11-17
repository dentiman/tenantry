# Tasks

## 0. Before implementing
- [x] 0.1 Owner confirms design.md decisions D1 (claim inside the service transaction), D2 (errors are not cached), D9 (client derives the key from the request) and the two first adopters; record any correction in design.md.

## 1. Contracts and data
- [x] 1.1 Add `IDEMPOTENCY_KEY_REUSED` (422) and `IDEMPOTENCY_IN_PROGRESS` (409) to `ApiErrorCodeSchema` and their texts to `libs/i18n` `errors.json`; verify `pnpm typecheck` passes (the toast/description code is exhaustive over the enum).
- [x] 1.2 Prisma model `IdempotencyKey` in `prisma/schema/idempotency.prisma` and a migration with `ENABLE` + `FORCE` RLS and the `tenant_isolation` policy (design D7); verify with `pnpm db:generate` and `pnpm api:test:e2e -- rls.e2e-spec` (catalog check picks the table up by itself).

## 2. Backend layer (`libs/shared/src/idempotency/`)
- [x] 2.1 Pure helpers: key format check, canonical JSON, request fingerprint; verify with Vitest unit tests in `libs/shared` (key order independence, nested objects, arrays keep order, format boundaries 0/1/255/256 and non-ASCII).
- [x] 2.2 `IdempotencyService`: CLS context, `claim(tx)` (no-op without a key, insert with `skipDuplicates`, signal error on conflict), lookup, save response; `IdempotencyModule` (global) exported from `libs/shared`; verify by the e2e of group 4.
- [x] 2.3 `IdempotencyInterceptor` + `@Idempotent()` (interceptor, `x-idempotency-key` OpenAPI extension): pre-handler lookup, replay with `Idempotent-Replayed`, `422` on fingerprint mismatch, bounded wait then `409` + `Retry-After`, catch of the claim signal, save after success, error when a successful handler did not claim (D6); verify by the e2e of group 4.
- [x] 2.4 Register `libs/shared/src/idempotency/` under `infra` in `modules.config.ts` and import `IdempotencyModule` in `apps/api` `AppModule`; verify `pnpm lint` (includes `modules:check --strict` and `deps:check`).

## 3. Adopters and cleanup
- [x] 3.1 `POST /customers`: `@Idempotent()` on the endpoint, `claim(tx)` first in `CustomersService.create` (before `numbering.allocate`); verify by e2e 4.1–4.6.
- [x] 3.2 `POST /calendar/events`: `@Idempotent()` and `claim(tx)` first in `CalendarService.create`; verify by e2e 4.7.
- [x] 3.3 `CleanupProcessedJobsSubscriber` also deletes `idempotency_keys` older than 24 h; verify by e2e 4.9.
- [x] 3.4 `pnpm openapi:generate && pnpm web:codegen`; verify `pnpm codegen:check` is clean and no generated call signature changed (only the extension appears in `openapi.json`).

## 4. E2E (`apps/api/test/idempotency.e2e-spec.ts`) — each maps to a spec scenario
- [x] 4.1 Sequential replay: same key twice → same body, one customer, one activity, `Idempotent-Replayed: true` on the second; without the header → two customers.
- [x] 4.2 Concurrent `Promise.all` of two identical requests with one key → both `201` with the same id, one customer, one number consumed.
- [x] 4.3 Same key with another body → `422 IDEMPOTENCY_KEY_REUSED`, no second customer.
- [x] 4.4 Failure does not consume the key: a request rejected before the transaction (`externalId` already used → `400`) stores nothing, and after the blocker is deleted the same key and body → `201`; a failure after `claim` inside the transaction (test-only endpoint) rolls the key back. Validation error with a key stores no row.
- [x] 4.5 Scope: another user of the tenant and a user of another tenant reuse the key value → independent records, no replay.
- [x] 4.6 Malformed key (256 characters, non-ASCII) → `400`; applied key with no stored response (row inserted directly) → `409 IDEMPOTENCY_IN_PROGRESS` with `Retry-After`, no second customer.
- [x] 4.7 Calendar event create replay → one event, attendee notified once.
- [x] 4.8 Wiring guard (D6): a test-only controller under `@Idempotent()` whose handler never claims → `500` when the header is present, `201` without it.
- [x] 4.9 Cleanup: rows older than 24 h are deleted, newer rows stay (subscriber invoked directly against the test database).

## 5. Web client
- [x] 5.1 `libs/ui/src/api/idempotency.ts`: key registry (acquire by request fingerprint, settle by outcome, 15-minute expiry, explicit header wins); verify with Vitest in `libs/ui` covering the four client scenarios of the spec plus `401`/`5xx`/`IDEMPOTENCY_IN_PROGRESS` keeping the key.
- [x] 5.2 Wire the registry into the request/response interceptors of `apps/web/src/api/http-client.ts`; verify with `apps/web/src/api/http-client.test.ts` (the real axios instance behind a stub adapter: double submit, lost response, corrected form, non-JSON requests) and a keyed request repeated against the running API (`Idempotent-Replayed: true`, one customer). The in-browser check was not possible on the dev machine: port 5173 was held by another project.

## 6. Documentation (same commit as the behaviour)
- [x] 6.1 New `docs/idempotency.md` — the reference: contract, D1–D9 in present tense, the adopter checklist (decorator + `claim`, no secrets in the response, an e2e per endpoint), relation to `runOnce` and business keys; verify every statement against the shipped code.
- [x] 6.2 `docs/user-operations.md`: §5.1 reduced to a pointer plus what operation start relies on, §9.7–9.8 closed, §10 order gains step 0 with the `uo-N` change names; `docs/roadmap.md` §2.13 status.
- [x] 6.3 `docs/backend-conventions.md` §4/§6 and the `backend-change` skill gain the "non-idempotent `POST` → `@Idempotent()` + `claim(tx)`" line; `docs/error-handling.md` lists the two codes; `AGENTS.md` documentation map entry. The two new codes also get their rows in `docs/ai-knowledge/10-troubleshooting.md` (+ `pnpm ai:knowledge`): a corpus test requires every `ApiError.code` there.

## 7. Gate
- [x] 7.1 `pnpm lint && pnpm typecheck && pnpm build`, unit tests of `libs/shared`, `libs/ui`, `apps/web`, then `bash scripts/ci-verify.sh` (full e2e of both planes); `openspec validate uo-0-idempotency-key --strict` passes.
