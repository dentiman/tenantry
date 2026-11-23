## Why
A repeated `POST` (network retry, lost response, double click) creates a second customer or
calendar event today; only chat is protected, by its own `clientMessageId`. Every later piece of
`docs/user-operations.md` starts work with a `POST` that must not run twice (import, export, and
eventually billing), so the shared guard has to exist before the first of them (§5.1, §9.8).

## What Changes
- A shared `Idempotency-Key` request header for REST mutations in the tenant API, opt-in per
  endpoint. A repeat of a completed request returns the original response and repeats no effect.
- The key is recorded in the same database transaction as the effect, so "effect happened" and
  "key is known" can never disagree — after a crash as well. This settles open question §9.7.
- Defined answers for the edge cases: same key with a different request → `422`; malformed key →
  `400`; result not available yet → `409` with `Retry-After`. Two new `ApiError` codes.
- A failed request does not consume its key: nothing was committed, so the retry simply runs.
  This replaces the "deterministic errors are cached" line of the design doc (see design.md D2).
- Keys are remembered for at least 24 hours and removed by the existing nightly cleanup.
- The tenant web client sends the key by itself for create requests and reuses it when the same
  request is repeated while its outcome is unknown. No per-form code.
- First adopters: creating a customer and creating a calendar event.

Out of scope: the platform plane (no tenant/user to scope a key to — same open question as
`docs/user-operations.md` §9.4), chat (keeps `clientMessageId`), `UserOperation` itself.

## Capabilities
### New Capabilities
- `api/idempotency`: safe repetition of REST mutations through the `Idempotency-Key` header —
  replay, concurrency, conflict answers, key scope and lifetime, client behaviour.

### Modified Capabilities
None.

## Impact
One migration (`idempotency_keys`, tenant-scoped under RLS); a new infra module in `libs/shared`;
two error codes in `libs/contracts` plus their texts in `libs/i18n`; one line in
`CustomersService.create` and `CalendarService.create` and a decorator on their endpoints; the
nightly marker cleanup in the worker; the tenant web HTTP client; docs (`docs/idempotency.md` new,
`docs/user-operations.md`, `docs/backend-conventions.md`, `docs/error-handling.md`, `AGENTS.md`,
`docs/roadmap.md`). No response shape changes; requests without the header behave exactly as before.
