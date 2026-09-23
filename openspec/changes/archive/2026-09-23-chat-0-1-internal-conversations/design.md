# Design

## Context

See `proposal.md` — Why. The target model, the industry survey behind it and the fixed
decisions are in `docs/chat.md` §4 and §6; the phase split and the twelve invariants this
slice must establish are §7.3–§7.6. This document covers only what is decided *here*: the
concrete schema cut, the transaction that allocates order, the idempotency mechanics, and the
client-side data layer that replaces a socket in this slice.

Constraints that shape everything below:

- **RLS is the tenant boundary, not the participant boundary.** The same rule already governs
  private calendar events and AI conversations (`20260920125729_ai_assistant_conversations`
  spells it out in a comment). Participant-level privacy must live in the service, in one
  place.
- **Domain code never mentions `tenantId`** — the tenant Prisma extension does `set_config`,
  and `$executeRaw` bypasses it (CLAUDE.md rule 16). Every write here therefore runs inside
  `TenantTransactions.withTenantTx`.
- **Nothing asynchronous participates.** No messaging topology entry, no worker subscriber, no
  socket emission. Two call sites in the message service are reserved for `0.2` by comment.
- Contract types come from `libs/contracts` only; `openapi.json` and the orval output are
  committed together (CLAUDE.md, Type pipeline).

## Goals / Non-Goals

**Goals:**

- A Chat area that can be demonstrated end to end without a live connection.
- Fix `seq`, the keyset cursor and `clientMessageId` as contract before `0.2` builds on them.
- Keep every later slice additive: `0.2` adds emission and a sync file, `0.3` adds columns and
  endpoints — neither reshapes what this slice writes.

**Non-Goals:**

- Any behaviour listed as out of scope in `proposal.md` — most of it is a later slice in
  `docs/chat.md` §7.3.
- Performance work beyond correct indexes. `chat_messages` will eventually be the largest
  table in the system (`docs/chat.md` §5, item 5); partitioning stays in the backlog.
- Reworking the AI assistant's own conversation model — see `proposal.md`, last paragraph of
  *What Changes*.

## Decisions

### D1. `seq` is allocated by an increment-and-return on the conversation row

The insert transaction runs `UPDATE conversations SET last_seq = last_seq + 1, last_message_at
= now() … RETURNING last_seq` and uses the returned value for the message. This is ordinary
Prisma (`update … { increment: 1 }` with `select`), not raw SQL, so the tenant extension stays
in force.

The row lock this takes is the point, not a side effect: it serialises inserts **within one
conversation** and leaves different conversations fully parallel, which is exactly the
concurrency shape a chat wants. It also updates the denormalised list fields in the statement
that is already locking the row, so the conversation list never needs a lateral join.

*Alternatives rejected:* a Postgres `SEQUENCE` (lives outside RLS and is gapful), `MAX(seq)+1`
(loses the race without a lock anyway), and ordering by `created_at` with an id tie-breaker
(gives neither a stable cursor nor a gap detector — `docs/chat.md` §4.3).

### D2. Idempotency is pre-checked, DB-arbitrated, and retried once

A unique violation aborts the surrounding Postgres transaction, so "insert, catch P2002,
select the existing row" cannot work inside one `withTenantTx`. The flow is therefore:

1. read by `(conversation_id, client_message_id)` before opening the transaction; a hit
   returns that message and stops;
2. otherwise run the insert transaction;
3. if it fails with P2002 on the partial unique index, **retry the whole operation once** — the
   second attempt's step 1 finds the row the concurrent request wrote.

The index is the arbiter; the pre-check is only an optimisation that makes the common replay
cheap. A replay answers `201` with the original message, as the spec requires: distinguishing
`200` from `201` would expose a race the client cannot act on. The index is partial
(`WHERE client_message_id IS NOT NULL`) and written as raw SQL in the migration, the same way
`ai_conversations_active_per_user_key` is — Prisma cannot express partial indexes.

### D3. The default channel is marked by a column, not found by its title

`conversations.is_default boolean default false`, plus a partial unique index
`(tenant_id) WHERE is_default` — the same idiom as "one active AI conversation per user".
Looking the channel up by `title = 'General'` would break the moment somebody renames it, and
a deterministic derived UUID would hide the relationship from anyone reading the schema.

**This column is an addition to the list in `docs/chat.md` §7.4 and must be promoted there
before this change is archived.**

Three creation sites, all inside the transaction that creates their subject, so a failure
leaves no tenant or user without membership:

| Site | What it does |
| --- | --- |
| `libs/database/prisma/seed.ts` | idempotent upsert of the channel + membership for seeded users |
| `apps/platform-api/src/tenants/tenants.service.ts` | a tenant created by an operator gets its channel and its first admin's membership in the same `$transaction` |
| `apps/api/src/users/users.service.ts` | a new user joins the channel inside the existing `withTenantTx`, which also writes the `member.added` row |

The control-plane site runs under `SystemPrismaService` (BYPASSRLS) and therefore passes
`tenant_id` explicitly — legitimate there, and nowhere else.

### D4. Participant privacy is one service, and its refusal is `404`

`ConversationAccessService.assertParticipant(conversationId, userId)` is the only place that
decides visibility. It takes the conversation's `access` value and the membership row from the
start; in this slice only `private` resolves and the `tenant` branch is not written
(`docs/chat.md` §6). A non-participant — administrator included — gets `404`, not `403`:
`403` would confirm that the conversation exists.

Every read and write path calls it first. This is the item most likely to be quietly violated
later by a copied `EXISTS (participant)` condition (`docs/chat.md` §5, item 6), so it is worth
naming in review.

### D5. System entries advance the feed but do not touch unread or the preview

A `SYSTEM` row takes a `seq` like any other entry, so a fresh conversation opens with content
and the one-feed decision is exercised from day one. It does **not** increment
`unread_count` — an unread badge that fires on "X added Y" stops meaning anything by the second
day.

It also does not write `last_message_preview`. The preview is a denormalised **text** column,
and a system entry has no text — its wording is rendered from `{ type, params }` in the
reader's language (the activities/notifications doctrine). Storing a rendered string would
break that; adding a second "preview kind" column would be a column in service of a placeholder.
So the preview stays `NULL` until the first real message, and the list renders "no messages
yet" for that state — which is what a brand-new conversation should show anyway. `last_seq`
and `last_message_at` are updated, so the new conversation still sorts to the top.

### D6. Unread counters are one statement over the participants

In the same transaction: `UPDATE conversation_participants SET unread_count = unread_count + 1
WHERE conversation_id = $1 AND user_id <> $sender AND left_at IS NULL`. One statement over a
handful of rows. Moving the cursor sets `last_read_seq = GREATEST(last_read_seq, $seq)` and
`unread_count = 0` in one update, so a stale cursor request is a no-op rather than an error.

The scale boundary is known and named in `docs/chat.md` §4.4 (a channel of hundreds of people
turns this into hundreds of row updates per reply). The default channel is that shape in
principle; in a skeleton it is not, and the fallback — computing `last_seq - last_read_seq`
without writing — is a later change that needs no migration.

### D7. Columns land now only when adding them later would cost a backfill

The rule and the full split are in `docs/chat.md` §7.4. Applied here it means `status`,
`visibility`, `kind`, `payload`, `sender_label` and `client_message_id` exist from this
migration although nothing in this slice varies them, while `channel_id`, `direction`,
`customer_id`, `assignee_id`, `reply_to_id`, `delivered_at` and friends wait for the slice
that reads them. Enums are created with the values this slice uses plus the ones already
fixed in `docs/chat.md` §4.2 — extending a Postgres enum is cheap, rewriting rows is not.

### D8. The client keeps server data in the query cache and unsent data beside it

- The transcript is an infinite query keyed by conversation, paging with the opaque cursor;
  pages arrive newest-first and are reversed for rendering.
- **Pending and failed sends do not live in the query cache.** They live in a small Zustand
  map keyed by `conversationId → clientMessageId → { body, state }`, rendered after the last
  server page. A refetch therefore cannot drop an unsent message, and a successful send simply
  removes its entry once the server row arrives — no manual cache surgery, no flicker, and
  nothing to reconcile when `0.2` starts patching the same cache from a socket.
- Chat queries override the global `staleTime: 30_000` (`apps/web/src/main.tsx`) with a short
  one, so that `refetchOnWindowFocus` actually refetches. No `refetchInterval` anywhere.

### D9. Registry primitives are vendored into `libs/ui`, composition stays in `apps/web`

`pnpm dlx shadcn@4.19.0 add message-scroller message bubble marker`, `--dry-run` first, per
`docs/chat.md` §4.14.2–§4.14.3. `message-scroller` pulls `@shadcn/react` into the package's own
`dependencies` (first headless npm dependency of `libs/ui`). Its `sr-only` strings are
hard-coded English and are lifted into i18next while vendoring; any local edit is tagged
`ЛОКАЛЬНА ПРАВКА реєстру` (CLAUDE.md rule 12). `attachment` is deliberately not installed.

## Risks / Trade-offs

- **A copied access check bypasses D4** → the one-function rule is stated in the spec, in this
  document and in the module's entry point; e2e covers non-participant and administrator
  access on every route.
- **The retry in D2 could mask a different unique violation** → the retry is conditioned on the
  specific index name, and a second failure propagates.
- **The row lock in D1 serialises a very busy conversation** → intended, and the cost is
  bounded to one conversation. Nothing else in the system contends on it.
- **Two similar conversation models now coexist** (`ai_*` and `chat_*`) → accepted with open
  eyes in `proposal.md`; the duplication is of a pattern, not of code, and merging them would
  produce a table half of whose columns are NULL for either kind.
- **Demonstration without realtime reads as a bug** → the screen states its own freshness: it
  refreshes on focus and after sending, and offers a deliberate refresh. `0.2` removes the need
  without changing a single component (`docs/chat.md` §7.5).
- **`chat_messages` is the first table that grows from message traffic** → correct indexes and
  keyset paging from day one; partitioning stays in the backlog (`docs/chat.md` §5, item 5).

## Migration Plan

One additive migration; nothing existing changes shape.

1. Enums, three tables, indexes, composite FKs, RLS `ENABLE`/`FORCE` + `tenant_isolation`
   policy per table — copying the structure of `20260920125729_ai_assistant_conversations`.
   No grants: `ALTER DEFAULT PRIVILEGES FOR ROLE saas_migrator` already covers new tables.
2. Two partial unique indexes as raw SQL: `client_message_id` per conversation, and
   `is_default` per tenant.
3. **Backfill in the same migration:** create the default channel for every existing tenant and
   a participant row for every existing user, with `last_read_seq` set to the channel's
   `last_seq`. Without this step, existing dev databases and any deployed tenant are left as
   the only ones without a default channel, and the seed alone would not fix them.
4. `pnpm db:generate`, then `pnpm openapi:generate && pnpm web:codegen`; the generated
   artefacts are committed with the change.

Rollback is a down migration dropping the three tables; no other table is touched, and no data
outside them exists yet.

## Open Questions

- **Maximum message length.** A number is needed for the contract; 4000 characters is the
  working assumption and can move without touching the specs, the approach or the tasks.
- **Default channel title and whether it is renameable.** "General" is the working assumption;
  renaming is a `0.3` concern (it needs the `conversation.renamed` system entry).
