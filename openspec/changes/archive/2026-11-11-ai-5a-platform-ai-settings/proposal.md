## Why

Provider, base URL, model and API key live in `.env`, so changing the model needs a redeploy,
and the assistant can be switched off only for the whole installation. The owner decided
(docs/ai-platform-controls.md) to move these settings into the superadmin UI, keep the key
encrypted with an explicit reveal, and add per-platform, per-tenant and tenant-admin switches.

## What Changes

- `platform_ai_settings` (one row) and an append-only `platform_ai_settings_events` journal;
  writable only by the control plane, readable (settings only) by tenant processes.
- API key encrypted with AES-256-GCM under `AI_SECRETS_KEY`; masked on read, revealed only by a
  dedicated audited endpoint.
- Worker and tenant API resolve settings at runtime (short cache) over env defaults; a change
  applies to the next reply without restart.
- Switches: platform (superadmin), tenant permission (superadmin, `tenant_ai_access`), tenant
  choice (Tenant Admin, `settings.ai.enabled`). Effective = `AI_ENABLED` ∧ all three.
- platform-web: AI area with the settings form and key reveal; tenant detail permission toggle.
  Tenant web: assistant switch in `/settings/ai`.

## Capabilities

### New Capabilities

- `ai-assistant/platform-controls`: runtime AI settings, encrypted key, three-level availability.

### Modified Capabilities

None.

## Impact

Migration (three tables), tenant and platform OpenAPI + orval, worker provider resolution,
`AI_SECRETS_KEY` for worker and platform-api.
