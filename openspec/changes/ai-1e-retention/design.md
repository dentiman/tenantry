# Design

## Context

See `proposal.md` for motivation. Relevant existing shape (all read from the current
codebase, not assumed):

- `AiConversation` has `status: ACTIVE | RETIRED`, `createdAt`, `updatedAt`, `lastMessageAt`
  (nullable — set on `finalize()` and on `ask()`'s conversation-touch). `AiMessage` has an
  `onDelete: Cascade` FK to its conversation, so deleting a conversation row deletes its
  messages for free.
- The cron pattern to copy is `files.cleanup-orphans` →
  `CleanupOrphanFilesSubscriber`: a `defineCommand(..., { scope: 'system' })`, a
  `MESSAGE_TOPOLOGY` entry with a `cron` string, a subscriber constructed with
  `SystemPrismaService` (BYPASSRLS, cross-tenant — the whole point of a system-scope job),
  registered in `apps/worker/src/worker.module.ts`.
- `AiGenerateReplySubscriber.prepare()` already loads the reply with
  `include: { conversation: true }` in its very first query, so `reply.conversation.status` is
  already in hand at zero extra cost. `claim()` (in `AiMessageStateService`) is the fencing
  gate that turns `PENDING` or `STREAMING`-with-expired-lease into an owned `STREAMING` attempt;
  every other transition in that service (`cancelPending`, `requestCancel`, `closeAbandoned`) is
  a separate conditional `updateMany`, not a code path inside `claim()` itself.
- `AiService` already distinguishes the tenant boundary (RLS, via the tenant-scoped
  `PrismaService`/`TenantTransactions`) from the person boundary (an explicit `userId: actor.sub`
  filter in every query) — see its class-level comment. The new delete-all endpoint follows the
  same doctrine.
- The `AiPanel` header already has a destructor-adjacent affordance (`reset` = "new
  conversation") using a plain icon `Button`; `user-settings/security.tsx`'s "sign out of all
  devices" is the repo's established pattern for a personal destructive action gated by
  `AlertDialog` (not a second confirmation step, not a typed-confirmation input).

## Goals / Non-Goals

**Goals:**
- Bound how long AI conversation content is retained, per `docs/ai-assistant.md` §9.2.
- Let a user erase their own AI conversation history on demand.
- Stop the generation pipeline from paying for (and storing) a reply nobody can ever read
  because its conversation was retired before generation started.

**Non-Goals:**
- No per-tenant retention override. §9.2's sentence about a tenant being able to *shorten* (not
  lengthen) the installation retention window is a forward-looking remark, not part of the
  `ai-1e` bullet list in §10.1, and it would require the `settings.ai.enabled`-style per-tenant
  surface that is explicitly deferred to AI-2. Only the installation-wide `AI_RETENTION_DAYS`
  ships here.
- No change to `ai_usage_counters` or any `ai-1d-usage-quotas` code — that change is running in
  parallel on the same base branch; this change does not touch quota logic at all.
- No soft-delete column anywhere in this change (explicit constraint, both from the task and
  from `docs/ai-assistant.md` §9.2: "видалення жорстке").
- Does not handle a `STREAMING` reply whose owning attempt is still alive at the moment its
  conversation is retired (see Risks below) — only the documented case (a reply still queued,
  i.e. `PENDING`, or already abandoned) is in scope, matching the live-run finding.

## Decisions

### D1 — Where the early-cancel check lands, and how it composes with claim()

The check is a new statement in `prepare()`, immediately after the existing
`tx.aiMessage.findUnique({ where: { id: data.messageId }, include: { conversation: true } })`
read (the very first thing `prepare()` does), and **before** the `claim()` call and before any
of the history/knowledge/prompt work that currently happens between them:

```ts
if (reply.conversation.status === 'RETIRED') {
  await this.state.cancelRetired(tx, data.messageId);
  return null;
}
```

`prepare()` then returns `null` exactly as it already does for "nothing to do" cases (message
gone, question missing), so `handle()`'s existing `if (!prepared) return;` short-circuits before
`this.llm.generate()` is ever reached — no new branch is needed in `handle()`.

`cancelRetired()` is a **new** method on `AiMessageStateService`, not a change to `claim()`
itself: `claim()`'s job stays "turn a claimable row into an owned attempt", and the retired-
conversation case is not a claim at all — no attempt is taken, no lease is set, no prompt was
built. Reusing `claim()`'s own fencing WHERE would only add an unrelated third outcome (claimed
/ not-found / cancelled) to a method whose two-outcome contract (`{…} | null`) every existing
caller already relies on.

`cancelRetired()` mirrors exactly the set of rows `claim()` would otherwise have been willing to
take — `PENDING`, or `STREAMING` with a `null`/expired `leaseExpiresAt` — so it composes with
the existing ownership model instead of overriding it:

```ts
async cancelRetired(tx, messageId: string): Promise<boolean> {
  const now = new Date();
  const { count } = await tx.aiMessage.updateMany({
    where: {
      id: messageId,
      OR: [
        { status: 'PENDING' },
        { status: 'STREAMING', OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
      ],
    },
    data: { status: 'CANCELLED', completedAt: now },
  });
  return count > 0;
}
```

Two consequences worth being explicit about:

- **A reply already terminal (delivered twice) is a safe no-op.** If the message is already
  `COMPLETE`/`FAILED`/`CANCELLED` by the time this runs (redelivered job, or `claim()` would
  have found nothing anyway), the `updateMany` touches 0 rows and nothing changes — same
  "silently do nothing" contract every other transition in this service already has.
- **A currently-owned `STREAMING` attempt (fresh, unexpired lease) is intentionally left
  running by this check**, because `RETIRED` is a terminal, one-way status for a conversation
  (`reset()` only ever flips `ACTIVE → RETIRED`, never back), so there is no race to win against
  a future un-retire — but a *live* generation attempt on that same reply, running in a
  different delivery, is a genuinely different scenario than the one the live run found (a
  reply that never even started). Forcing that row to `CANCELLED` here would fight the owning
  attempt's own fenced `finalize()` (`WHERE status = 'STREAMING' AND attempt = ownedAttempt`)
  outside of `AiMessageStateService`'s existing "loser finds 0 rows and stops silently" pattern,
  and there is no evidence from the live run that this actually happens (the found case was a
  `PENDING` reply queued while the worker was down). Documented as a Non-Goal / Risk rather than
  silently handled.

### D2 — Age basis for the purge: `lastMessageAt`, not `createdAt`

The purge cutoff is `lastMessageAt ?? createdAt < now - AI_RETENTION_DAYS`, applied to every
conversation regardless of `ACTIVE`/`RETIRED` status, in one `deleteMany` (cascade removes the
messages — no separate `aiMessage.deleteMany` needed, no per-row loop, unlike
`cleanup-orphan-files` there is no external resource (S3 object) to clean up per row first).

Alternative considered: base the cutoff on `createdAt`, or exempt `ACTIVE` conversations
entirely. Rejected: one conversation can be a user's *only* conversation for a very long time
(there is no forced reset), and `createdAt` would purge a conversation still being used daily
the moment it turns 90 days old — a much worse surprise than "a conversation nobody has touched
in 90 days quietly disappears, and the next question starts a fresh one exactly the way a
first-time user's does" (the existing lazy-create path in `AiService.ask`/`currentConversation`
already handles "no active conversation exists" — deleting a stale `ACTIVE` row is not a new
code path, just a new reason that row can be absent).

### D3 — New command, topology entry, and schedule

```ts
// libs/shared/src/messaging/definitions/ai.messages.ts
export const purgeAiConversationsCommand = defineCommand('ai.purge-conversations', z.object({}), {
  scope: 'system',
});
```

Topology entry, cron `'45 3 * * *'` (the three existing nightly cleanup crons run at `:00`,
`:15`, `:30` past 03:00; `:45` keeps this one clear of them without any special reason to
collide):

```ts
{
  definition: purgeAiConversationsCommand,
  consumers: [{ id: 'ai-conversation-purger', retryLimit: 1 }],
  cron: '45 3 * * *',
},
```

New subscriber `apps/worker/src/subscribers/ai-purge-conversations.subscriber.ts`, same shape as
`CleanupOrphanFilesSubscriber` (constructor takes only `SystemPrismaService`, logs the removed
count), registered in `apps/worker/src/worker.module.ts`.

### D4 — `AI_RETENTION_DAYS` lives in the existing shared `AiConfig`

Added to `libs/shared/src/ai/ai.config.ts`'s `AiEnvSchema`/`AiConfig`/`loadAiConfig()`
(`intFromEnv(90)`), even though only the worker's new subscriber reads it — it is still AI
config, both `apps/api` and `apps/worker` already load the same `AiConfig` via the global
`AiModule`, and a second config object for one field would be pure duplication.

### D5 — Delete-my-conversations: route, service, and UI

- Route: `DELETE /ai/conversations` (plural — the existing `GET/POST /ai/conversation`
  singular routes all address "the current conversation"; this one addresses the whole
  collection, still with no id in the path, same doctrine as `/account`). 204, no request or
  response body — same shape as `POST .../cancel`.
- `AiService.deleteAllConversations(actor)`:
  ```ts
  await this.transactions.withTenantTx((tx) =>
    tx.aiConversation.deleteMany({ where: { userId: actor.sub } }),
  );
  ```
  RLS (tenant scope) plus the explicit `userId` filter (person scope) — the same two-boundary
  doctrine the class comment already states and `cancel()` already follows. Cascade removes the
  messages.
- Emits `ai.conversation-changed.v1` after commit so a second open tab of the same user
  refreshes, same as `reset()`. Needs one new `reason` value, `'deleted'`, added to
  `AiConversationChangedSchema`'s enum in `libs/contracts/src/realtime/realtime.schema.ts` —
  the frontend's `ai-sync.ts` handler ignores the `reason` payload entirely today
  (`socket.on(REALTIME_EVENTS.aiConversationChanged, () => invalidate())`), so this is a pure
  additive schema change with no client logic to update.
- No new active conversation is created by the delete itself — the next
  `GET /ai/conversation` (or `ask()`) lazily creates one, exactly like a first-time user; this
  keeps the delete a single unconditional `deleteMany` instead of a delete-then-recreate
  transaction.
- UI: a new icon button in `AiPanel`'s header (next to "new conversation"/reset and "close"),
  gated behind an `AlertDialog` confirmation copied from `user-settings/security.tsx`'s
  "sign out of all devices" — same component, same one-step confirm, no typed-confirmation
  input. New keys under `apps/web/src/locales/en/ai.json` only (English-only per the fixed
  i18n decision).

## Risks / Trade-offs

- **A `STREAMING` reply with a live lease, in a conversation retired mid-generation, is not
  cancelled by this change** (see D1). Mitigation: none needed yet — this is not the defect the
  live run found (that reply was still `PENDING`), and the existing timeout/abandon machinery
  (`AI_REQUEST_TIMEOUT_MS`, `closeAbandoned`) already bounds how much it can cost even if this
  happens. Worth another look only if a live run ever shows it happening.
- **Deleting an `ACTIVE` conversation that is mid-generation is not specially guarded.** A
  worker holding a fenced `STREAMING` attempt on a reply whose conversation the user just
  deleted will simply find 0 rows on its next `persistPartial`/`finalize()` `updateMany` (the
  row is gone) and take the same "lost ownership" silent-stop path it already takes for a
  superseded attempt. No new failure mode, no orphaned data (FK cascade already removed the
  row), and the conversation being deleted mid-generation implies the user does not want to see
  the answer anyway.
- **Purge cutoff choice (`lastMessageAt`) is a judgment call**, not dictated verbatim by
  `docs/ai-assistant.md` §9.2, which only says "older than `AI_RETENTION_DAYS`" without naming
  the field. Flagged for the coordinator to confirm before implementation (see the design ask).

## Migration Plan

Additive only: one new nullable-free env var with a default (no `.env` changes required to
keep existing deployments working), one new command/cron/subscriber, one new nullable-free
enum value in a realtime schema, one new HTTP route, one new `AiMessageStateService` method.
No Prisma migration is needed — no schema change, only new queries against existing columns.
No rollback concerns beyond reverting the commit; the purge job is idempotent (a second run
finds nothing left to delete).
