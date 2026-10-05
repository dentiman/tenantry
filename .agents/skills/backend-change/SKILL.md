---
name: backend-change
description: Checklist for changing this repo's NestJS backend (apps/api, apps/platform-api, apps/worker, libs/shared, libs/database). Use before adding or changing a domain module, service method, transaction, subscriber/command, cron, migration or cross-module dependency — covers data ownership, transaction ownership, concurrency, idempotency, access checks, tests and docs. Not for frontend-only work.
---

# Backend change

Rationale and code references for every point: `docs/backend-conventions.md` (§ numbers below).
Read the feature doc of the module you touch first (`docs/<feature>.md`, see the map in AGENTS.md).

## Before writing code

1. **Owner.** Which module owns each table you write? Writing another module's table goes
   through its exported service, or through a shared recorder in `libs/shared` with `tx`
   (§1). Importing another module's controller/access/subscriber/gateway is a lint error.
2. **New dependency between modules.** Would it create a cycle? `pnpm deps:check` will tell
   you. Do not reach for `forwardRef` — move the shared part down or publish an event (§2).
3. **Transaction owner.** Name the one top-level method that opens `withTenantTx`. Every
   helper that must be atomic with it takes `tx` as its first argument (§3).

## While writing

4. **Read-modify-write?** If a decision depends on state you read (diffs, "has it changed",
   "is it still valid"), read inside the same `withTenantTx` and pick a guard: conditional
   `updateMany` + `count`, atomic increment, unique index → 409, or `SELECT … FOR UPDATE`
   via `$queryRaw` inside the tx (§4). Never compute the diff on a `findOne` done before the tx.
5. **External calls** (LLM, embeddings, S3, SMTP) stay outside the transaction (§5).
6. **After commit.** Lossy accelerator (socket emit, metric) → `onCommit(tx, …)`. Must happen
   (mail, generation, recompute) → `publish(tx, …)` + topology entry (§5).
7. **Async work.** State the idempotency key, retry vs `NonRetryableMessageError`, and what the
   user sees if the job lands in `dlq` (§6).
8. **Access.** RLS covers the tenant boundary only. Record-level access goes through the
   module's single access function, used by reads and writes alike (§7).
9. **Abstraction.** Only for a swappable implementation, a shared rule, or a needed dependency
   boundary (§8). No generic repositories.

## Before committing

10. **Test the invariant**: an e2e that would fail without the change — negative (other tenant /
    other user's record), concurrent (`Promise.all` of two identical requests) or retry (§10).
11. **Contracts changed?** `pnpm openapi:generate && pnpm web:codegen` (or the platform pair);
    commit generated files together.
12. **Docs** of the changed behaviour updated in the same commit; phase status only in
    `docs/roadmap.md` / the feature doc (§11).
13. **Run**: `pnpm lint && pnpm typecheck` and the affected e2e suite
    (`pnpm api:test:e2e -- <file>`; needs `pnpm ws:init` in a worktree). The full gate is
    `bash scripts/ci-verify.sh` — the same run GitLab's `verify` job does before any image build.
