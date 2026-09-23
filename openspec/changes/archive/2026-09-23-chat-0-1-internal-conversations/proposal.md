# Proposal

## Why

`docs/chat.md` fixes the design of chat (§4, §6) and §7 splits delivery into phases. This
change is **CHAT-0.1**, the first of three thin slices that `CHAT-0` was cut into: a complete,
demonstrable Chat screen — conversation list, transcript, composer — served entirely over
REST, with **no realtime, no queues, no notifications, no attachments**.

The cut is deliberate. Everything the later slices need from the infrastructure already
exists (Socket.IO/Valkey gateway, messaging, notifications, Files), so the risk in this phase
is not integration — it is the **contract**: server-side `seq` as the source of order, the
keyset cursor built on it, and `clientMessageId` in the request body. Those three decide the
shape of the realtime protocol (`0.2`) and of every screen built on top. Fixing them one
slice before sockets arrive costs hours; changing them afterwards means renumbering rows and
rewriting the feed, its hooks and the gap detector at the same time. `docs/chat.md` §7.6
lists the twelve invariants this slice must establish for that reason.

The Chat area in `apps/web` has been an empty placeholder since the shell was built
(`app-shell/areas/chat-sidebar.tsx`, `pages/chat.tsx`, both rendering `Empty`). This change
fills it.

## What Changes

- **New data model** (`libs/database`): `Conversation`, `ConversationParticipant`,
  `ChatMessage` under RLS ENABLE/FORCE per the MT-2 pattern, `tenant_id` from the DB default,
  composite FKs. Columns whose later addition would require a backfill or a rewrite of
  already-written queries land now even though this slice does not use them (`status`,
  `visibility`, `kind`, `payload`, `client_message_id`); purely additive nullable columns
  (`channel_id`, `direction`, `assignee_id`, `customer_id`, …) wait for their phase.
  `channels` and `customer_channel_identities` are **not** created.
- **Server-assigned `seq`.** Order inside a conversation comes from
  `UPDATE conversations SET last_seq = last_seq + 1 … RETURNING`, never from `created_at`.
  The same statement updates `last_message_at` and the denormalised
  `last_message_preview`, so the conversation list needs no LATERAL join.
- **New REST surface** in `apps/api/src/chat/`, following the existing module layering
  (DTO → Service → Mapper → Controller, as in `customers`/`ai`): `GET /conversations`,
  `POST /conversations`, `GET /conversations/:id`, `GET /conversations/:id/messages`
  (keyset by `seq`, `DESC`), `POST /conversations/:id/messages`,
  `POST /conversations/:id/read`.
- **One access function.** `ConversationAccessService` is the single place that answers "may
  this user see this conversation", and it takes `access` + membership from the start even
  though only `private` is resolvable in this slice. RLS is the tenant boundary, not the
  participant boundary — the private-channel rule lives in the service
  (`docs/chat.md` §5, item 6), exactly as it does for private calendar events and AI
  conversations.
- **Idempotent send.** `clientMessageId` travels in the request body and is enforced by a
  partial unique index `(tenant_id, conversation_id, client_message_id)`; a repeat returns
  **the same row**, not a 409. This makes the optimistic row safe in this slice and the
  double-tap/axios-retry case safe forever.
- **System rows in the transcript from day one.** `conversation.created` and `member.added`
  are written as `kind = SYSTEM` rows with `payload = { type, params }` and rendered through
  i18next — the same doctrine as activities and notifications. They cost one INSERT, they
  keep a fresh thread from opening empty, and they validate the one-feed decision (§4.7) on
  its cheapest example.
- **A default channel per tenant.** A `private` conversation titled "General" with every user
  of the tenant as a participant, created idempotently in `db:seed`. A user created later is
  added to it inside the transaction that creates them, which also writes the `member.added`
  row. The alternative — `access = 'tenant'` — is rejected: it would switch on a second
  branch of the access resolver for one row and leave the channel with no participant rows,
  i.e. no unread counter and no read cursor precisely where they are seen first.
- **Read state without a per-message flag.** `last_read_seq` (monotonic, `GREATEST`) plus a
  denormalised `unread_count` maintained in the same insert transaction. An `is_read` flag
  per message would be N×M rows and still could not answer "how far did each person read".
- **Chat area filled in** (`apps/web`): the sidebar becomes a real cursor feed of
  conversations (`Item*` + `Avatar` + preview + time + unread `Badge`), a new
  `/chat/$conversationId` route renders the transcript, and the composer is written here —
  the registry has no messenger composer (§4.14.1). The index page keeps its "no conversation
  selected" empty state, which is what it was designed for.
- **Four registry primitives vendored into `libs/ui`**: `message-scroller`, `message`,
  `bubble`, `marker`. `attachment` is left for the attachments slice so no vendored primitive
  sits without a consumer. `message-scroller` brings `@shadcn/react`, the first headless npm
  dependency of `libs/ui`.
- **Optimistic sent row**, keyed by `clientMessageId` and replaced by the server row without
  flicker. It does not depend on a socket, and without it even a perfectly drawn chat feels
  dead.
- **Freshness without realtime**: `refetchOnWindowFocus` plus invalidation after a send.
  **No polling interval** — `0.2` would have to remove it, and it hides cursor bugs by
  re-reading everything every N seconds.

**Explicitly out of scope**, each with its phase in `docs/chat.md` §7.3: realtime and typing
(`0.2`), presence, notifications (`0.2`), participant management in the UI, mentions,
attachments, edit/delete (`0.3`), conversation status, assignment, internal notes, the
unassigned queue, Activity Log entries (`CHAT-1`), channels, customers, webhooks, queues
(`CHAT-2`+), server-side transcript search (`CHAT-4`).

One cross-feature decision is closed here rather than deferred, because both models gain code
from this point on: **`ai_conversations` / `ai_messages` stay a separate model** and are not
folded into a `ConversationKind.AI` (open question 8 in `docs/ai-assistant.md` §4.1). An AI
conversation is always 1:1 with a bot — participants, delivery status, unread counts and
reopen policy do not exist for it, and merging would produce one table whose columns are half
NULL for either kind. The duplication is of a **pattern** (`seq`, cursor, room), not of code.

## Capabilities

### New Capabilities
- `chat/conversation`: what a conversation is and who may see it — creation with an explicit
  participant list, the single access rule for private conversations, the tenant's default
  channel and its membership, and the conversation list with its denormalised preview.
- `chat/transcript`: the single ordered feed of a conversation — server-assigned `seq`,
  posting plain text idempotently by `clientMessageId`, cursor-paginated history, and system
  rows living in the same feed as replies.
- `chat/read-state`: how far each participant has read — a monotonic cursor, the derived
  unread counter, and what moving the cursor does and does not affect.
- `chat/area`: the Chat area as a screen — what the list and the transcript show, how a
  message appears before the server confirms it, and how a client without realtime learns
  about new messages.

### Modified Capabilities
<!-- None. `openspec list --specs` reports ai-assistant/{conversation,generation-pipeline,
     panel} and app-shell/resizable-panels; this change adds a separate area and a separate
     data model and alters no requirement of any of them. The decision to keep
     ai_conversations separate (see above) is a decision NOT to change ai-assistant/*. -->

## Impact

- **Database** (`libs/database`): three models + migration with raw-SQL RLS policies per the
  MT-2 pattern (`20260920125729_ai_assistant_conversations` is the reference) and **two
  partial unique indexes** Prisma cannot express — `client_message_id` and the reserved
  `external_id` shape is *not* created here. `seed.ts` gains the default channel.
- **Contracts** (`libs/contracts/src/chat/`): conversation, participant and message schemas
  plus the cursor query/response pair built on the existing `CursorQuerySchema` /
  `cursorResponseSchema`. Regenerate and commit `openapi.json` and the orval artifacts
  together (`pnpm openapi:generate && pnpm web:codegen`).
- **API** (`apps/api/src/chat/`): module, controller, service(s), mapper, DTOs.
  `apps/api/src/users/users.service.ts` gains the default-channel membership call inside its
  existing `withTenantTx` block.
- **Platform API** (`apps/platform-api/src/tenants/tenants.service.ts`): tenant creation
  already provisions the tenant's first administrator in one transaction; the default channel
  and that administrator's membership are created there too. A tenant born in the control
  plane must not be the one tenant without a default channel.
- **UI library** (`libs/ui`): four vendored primitives + `@shadcn/react` in the package's own
  `dependencies`. `platform-web` simply does not import them.
- **Web** (`apps/web`): `app-shell/areas/chat-sidebar.tsx` rewritten, `/chat/$conversationId`
  added as a child of the existing `chatRoute`, transcript and composer components, i18n keys
  in `locales/en/chat.json`.
- **Docs**: `docs/chat.md` §7 already carries the phase plan; `CLAUDE.md`'s architecture map
  gains the `chat` module, and `docs/roadmap.md` the chat line.
- **Tests**: `pnpm api:test:e2e` covers access (a non-participant gets 404/403), `seq`
  monotonicity under concurrent posts, `clientMessageId` replay returning the same row, and
  unread counters; `pnpm web:test` covers the optimistic-row replacement.
- **Not touched**: messaging topology, worker, realtime gateway, notifications, Files,
  `attachments`.
