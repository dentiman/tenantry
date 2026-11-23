## Decisions

D1. Precedence: a value set in `platform_ai_settings` wins; otherwise env. No row = behaviour
before AI-5a. `AI_ENABLED` stays the installation gate: the UI cannot enable an installation
whose env disables AI.

D2. Fields in UI now: platform switch, provider, base URL, model, API key. Timeouts, queue
concurrency, embedding model/key, retrieval and quotas stay in env (AI-5c moves quality levers).

D3. Key: AES-256-GCM, 12-byte random IV, AAD bound to the column, stored as
`v1:<iv>:<tag>:<ciphertext>` (base64) plus a 4-char hint for masking. Master key
`AI_SECRETS_KEY` (32 bytes, base64) only in worker and platform-api env. Saving a key without the
master key fails with a clear error; reading never returns plaintext except via
`POST /ai/settings/api-key/reveal`, which writes a `key_revealed` event.

D4. Grants: `platform_ai_settings` — `saas_app` SELECT only; events — no `saas_app` access;
`tenant_ai_access` — `saas_app` SELECT under RLS (own row), writes only by `saas_platform`.
Tenant permission is not part of `tenants.settings`, because the tenant writes that JSON.

D5. Runtime resolution: one shared reader with a few seconds of cache; the worker rebuilds the LLM
provider only when provider, URL or key change. The subscriber receives provider and model from
an `AiRuntime` per generation instead of a boot-time singleton. Embedding credentials fall back to
the runtime generation credentials when no dedicated `AI_EMBEDDING_*` pair is set; missing
credentials fail the reply, not the worker boot.

D6. Availability is checked in the API (403 on every AI route, `features.ai` in bootstrap) and in
the worker before claim: a queued reply of a disabled tenant is cancelled without a model call.
Defaults: platform enabled, tenant allowed, tenant choice enabled — existing installs keep working.
