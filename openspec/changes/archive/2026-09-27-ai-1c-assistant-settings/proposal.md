# Proposal

## Why

The assistant's instruction is a `const SYSTEM_INSTRUCTION` inside the prompt builder, so a
fork that wants its own persona has to edit code, and one tenant cannot tell the assistant
anything about how it works (§7.3 of `docs/ai-assistant.md` calls this an AI-0 shortfall).
This is step **AI-1c** of `docs/ai-assistant.md` §10.1: the persona and extra instructions
become organization configuration, while the assistant's safety boundaries stay in code where
no tenant can remove them.

## What Changes

- **A `settings.ai` section** in the existing org-level settings (same JSON-section pattern
  as `calendar`, stored in `Tenant.settings`, no migration): `persona` (≤ 500 characters) and
  `instructions` (≤ 4 000 characters), both trimmed plain text where an empty string means
  "not set". `GET` and `PUT /settings/ai`, both ADMIN only (least privilege — no other screen
  reads it);
  each write is journalled as `settings.updated` with `section: 'ai'` (the text itself is
  never copied into the activity payload).
- **The prompt splits in two.** The immutable assistant boundaries (no access to data, no
  actions, do not invent, answer in the user's language) stay in code as the first system
  message, byte-for-byte what AI-0…AI-1b send today. The tenant's persona/instructions, when
  present, follow as a separate, delimited system message that declares itself subordinate
  to those boundaries. Order: boundaries → knowledge → tenant instructions → user context →
  history → question (revised after the live-key run, see design.md D4).
- **The worker reads `settings.ai`** in `prepare()`, inside the existing tenant transaction
  (RLS), and passes it to the prompt builder. Absent, empty or unreadable settings produce
  exactly today's prompt.
- **A `/settings/ai` screen** in tenant web (Settings area, ADMIN only) with a visible note
  that this text is sent to the AI provider together with every question (§9.3), plus a
  sidebar entry.
- Regenerated OpenAPI + orval artifacts; promoted docs; the level-1 knowledge corpus stops
  saying the assistant has no settings.

Out of scope: `settings.ai.enabled` per tenant (AI-2), usage summary on the screen (AI-3),
quotas (`ai-1d`), retention (`ai-1e`). The delta protocol, the AI-0.1 ownership lifecycle,
AI-1a's provider and error mapping and AI-1b's knowledge pipeline do not change.

## Capabilities

### New Capabilities

- `ai-assistant/settings`: how an organization's administrator configures the assistant's
  persona and instructions, who may read and change them, their limits, the guarantee that
  they cannot remove the assistant's fixed boundaries, and where they sit in what the model
  receives.

### Modified Capabilities

None. `ai-assistant/generation-pipeline` (context exactly once, history then question) holds
as written. The knowledge requirement from `ai-1b` ("after the assistant's fixed
instructions") is still in flight in its own unarchived change and remains true — tenant
instructions sit between the fixed instructions and the knowledge, and are specified here.

## Impact

- **Contracts:** `AiSettingsSchema`, `AI_SETTINGS_DEFAULTS`, limits constants, types.
- **Shared (`libs/shared/src/ai/prompt/`):** `buildPrompt` gains an optional
  `organization` input; boundaries become an exported constant; a tolerant reader of the
  `settings.ai` JSON section used by both the API and the worker.
- **API:** `SettingsService.ai()/updateAi()`, `GET`/`PUT /settings/ai` (both `@Roles(ADMIN)`), DTOs; regenerated `openapi.json`.
- **Worker:** `ai-generate-reply.subscriber.ts` `prepare()` reads the tenant row's settings.
- **Web:** `pages/settings/ai.tsx`, route, sidebar item, `settings.json` locale keys,
  regenerated orval client.
- **Docs / corpus:** `docs/ai-assistant-implementation.md`, `docs/ai-assistant.md`
  §7.3/§10/§10.1, `docs/roadmap.md`, `docs/settings.md`, `docs/ai-knowledge/08-…`, `12-…`
  and the regenerated knowledge artifact.
- **Database:** none (JSON key in the existing `tenants.settings` column).
