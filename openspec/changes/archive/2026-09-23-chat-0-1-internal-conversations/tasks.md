# Tasks

Assumptions carried from `design.md` — Open Questions, neither of which changes the breakdown:
message body limit **4000 characters**, default channel title **"General"**.

## 1. Data model and migration

- [x] 1.1 Add `Conversation`, `ConversationParticipant`, `ChatMessage` and their enums to
      `libs/database/prisma/schema.prisma` per `design.md` D7 (columns that land now vs later),
      including `is_default`; verify `pnpm db:generate` succeeds and the generated client
      exposes the three models
- [x] 1.2 Create the migration with `cd libs/database && pnpm exec prisma migrate dev --name
      chat_conversations` (never through `pnpm ... -- --name`); verify it applies cleanly on a
      fresh `pnpm db:reset`
- [x] 1.3 Hand-write the RLS block into the migration (`ENABLE`/`FORCE` + `tenant_isolation`
      per table, no grants), copying `20260920125729_ai_assistant_conversations`; verify by
      querying each table as `saas_app` without `app.tenant_id` set and getting zero rows
- [x] 1.4 Hand-write the two partial unique indexes: `(tenant_id, conversation_id,
      client_message_id) WHERE client_message_id IS NOT NULL` and `(tenant_id) WHERE
      is_default`; verify each rejects a duplicate via `psql`
- [x] 1.5 Add the backfill step to the same migration — default channel per existing tenant,
      participant row per existing user with `last_read_seq = last_seq`; verify on a database
      seeded before the migration that every pre-existing user has membership

## 2. Contracts

- [x] 2.1 Add `libs/contracts/src/chat/` with conversation, participant and message schemas
      (message `body` trimmed, 1..4000; `clientMessageId` a uuid), reusing `CursorQuerySchema`
      and `cursorResponseSchema`; verify `pnpm typecheck` passes and `z.infer` types are
      exported from the package root
- [x] 2.2 Model the system-entry payload as a discriminated union of
      `conversation.created` / `member.added` with their params; verify a round-trip parse test
      of each variant

## 3. API — chat module

- [x] 3.1 Scaffold `apps/api/src/chat/` (module, controller, service, mapper, DTOs) following
      the `customers` layering and register it in `app.module.ts`; verify the app boots and
      `/api/docs` lists the new routes
- [x] 3.2 Implement `ConversationAccessService` per `design.md` D4 — single entry point,
      takes `access` + membership, `404` for non-participants; verify by unit test that an
      administrator who is not a participant is refused
- [x] 3.3 Implement `POST /conversations` (participants + optional title, tenant-membership
      validation, creator always included) writing the `conversation.created` and
      `member.added` system entries in the same `withTenantTx`; verify the created conversation
      opens with a non-empty transcript
- [x] 3.4 Implement `GET /conversations` — participant-scoped, ordered by `last_message_at`
      desc, cursor-paginated, carrying preview, time and the caller's `unreadCount`; verify
      paging returns no repeats and no gaps across two pages
- [x] 3.5 Implement `GET /conversations/:id` returning the conversation and its current
      participants (`left_at IS NULL`); verify a departed participant is absent while their
      messages remain
- [x] 3.6 Implement `GET /conversations/:id/messages` — keyset by `seq` desc with the opaque
      base64url cursor, following `activities.service.ts`; verify the last page returns
      `nextCursor: null`
- [x] 3.7 Implement `POST /conversations/:id/messages` per `design.md` D1 (increment-and-return
      `seq`, preview and `last_message_at` in the same statement) and D6 (unread update);
      verify two sequential posts get `seq` 2 and 3 after the creation entries
- [x] 3.8 Implement the idempotency flow of `design.md` D2 — pre-check, insert, single retry on
      the named partial index; verify a repeated `clientMessageId` returns the original message
      and the transcript holds one entry
- [x] 3.9 Reserve the `0.2` seams: a commented call site for `publish(tx, …)` and one for
      `onCommit(tx, …)` in the post path, naming the events from `docs/chat.md` §4.8; verify by
      review that no socket or queue code is imported by the module
- [x] 3.10 Implement `POST /conversations/:id/read` with `GREATEST` semantics and
      `unread_count = 0`; verify an older position is accepted without moving the cursor back

## 4. Default channel provisioning

- [x] 4.1 Add the lookup/ensure helper keyed by `is_default` and use it from
      `apps/api/src/users/users.service.ts` inside the existing `withTenantTx`, writing the
      `member.added` entry; verify a user created through `POST /users` lists the default
      channel on first request
- [x] 4.2 Create the default channel and the first admin's membership in
      `apps/platform-api/src/tenants/tenants.service.ts` inside its existing `$transaction`
      (explicit `tenantId` under `SystemPrismaService`); verify a tenant created through the
      platform API has exactly one default channel
- [x] 4.3 Make `libs/database/prisma/seed.ts` upsert the default channel and membership for
      seeded users; verify running `pnpm db:seed` twice produces no second channel

## 5. UI library

- [x] 5.1 Vendor the four primitives into `libs/ui` with `pnpm dlx shadcn@4.19.0 add
      message-scroller message bubble marker` (`--dry-run` first); verify `@shadcn/react` lands
      in the package's own `dependencies` and `pnpm build` passes
- [x] 5.2 Lift the hard-coded English `sr-only` strings out of the vendored primitives into
      i18next and tag every local edit `ЛОКАЛЬНА ПРАВКА реєстру`; verify by grep that no
      untranslated user-visible string remains in the four files

## 6. Web — data layer

- [x] 6.1 Regenerate the client (`pnpm openapi:generate && pnpm web:codegen`) and commit the
      generated artefacts together; verify the chat hooks appear with the names
      `operationIdFactory` produces
- [x] 6.2 Add the transcript infinite query and the conversation-list query with a chat-local
      short `staleTime` override; verify no `refetchInterval` is configured anywhere in the
      chat code
- [x] 6.3 Add the pending/failed send store per `design.md` D8 (Zustand, keyed by conversation
      and `clientMessageId`); verify a unit test that a refetch does not drop a pending entry
      and that a successful send removes exactly its own

## 7. Web — screen

- [x] 7.1 Replace the placeholder in `app-shell/areas/chat-sidebar.tsx` with the conversation
      feed (`Item*`, avatar, preview, time, unread badge, "Load more", loading/empty/error
      states); verify the unread badge matches the API response and the empty state renders for
      a user with no conversations
- [x] 7.2 Add the `/chat/$conversationId` route as a child of the existing `chatRoute` and
      leave the index page as the "no conversation selected" state; verify a reload on a
      conversation address restores it and an inaccessible id renders the unavailable state
- [x] 7.3 Build the transcript with `message-scroller` — bottom anchor, upward paging that
      preserves reading position, author grouping, day separators, `Marker` for system entries
      rendered through i18next; verify paging to the start stops requesting and marks the
      beginning
- [x] 7.4 Build the composer (`input-group` + `textarea` + `Button`): auto-growing to a bounded
      height, Enter sends, Shift+Enter breaks, empty cannot be sent, cleared on accept; verify
      each behaviour manually and cover Enter/Shift+Enter with a unit test
- [x] 7.5 Wire the optimistic send: entry appears at once, replaced without flicker on success,
      failed state with retry that reuses the same `clientMessageId`; verify a forced failure
      leaves the text recoverable and a retry produces exactly one message
- [x] 7.6 Add a deliberate refresh affordance and confirm focus-driven refresh of both list and
      transcript; verify in the browser that returning to the window shows a colleague's new
      message
- [x] 7.7 Add the `chat` i18n keys for system entries, states and the composer to
      `apps/web/src/locales/en/chat.json`; verify no literal user-facing string remains in the
      chat components

## 8. Tests

- [x] 8.1 e2e: access — non-participant and administrator get `404` on read, transcript and
      post; verify `pnpm api:test:e2e` passes with the chat suite
- [x] 8.2 e2e: ordering — concurrent posts to one conversation get distinct increasing `seq`
      and both survive; verify by posting in parallel within the test
- [x] 8.3 e2e: idempotency — the same `clientMessageId` twice returns the same message and the
      transcript holds one entry
- [x] 8.4 e2e: read state — unread counts per participant, own messages excluded, system
      entries excluded, a stale cursor is a no-op, a newly added participant starts at zero with
      full history
- [x] 8.5 e2e: paging — two pages of transcript with an insert in between return no repeats and
      no gaps, and the final page reports the end
- [x] 8.6 `pnpm lint && pnpm typecheck && pnpm build` clean

## 9. Documentation

- [x] 9.1 Promote the `is_default` column decision (`design.md` D3) and the system-entry
      preview rule (D5) into `docs/chat.md` §7.4 — required before this change is archived;
      verify the §7.4 column table matches the shipped migration
- [x] 9.2 Add the `chat` module to the architecture map in `CLAUDE.md` and the chat line to
      `docs/roadmap.md`; verify the documentation map entry no longer calls chat an empty
      placeholder
