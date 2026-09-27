# Proposal

## Why

AI-0 and AI-0.1 built and hardened the whole assistant pipeline, but only on `FakeLlmProvider`:
the assistant cannot yet answer anything real, and nobody knows how the pipeline behaves
against a live model (first-frame latency, real error shapes, whether prefix caching works).
This is step **AI-1a** of `docs/ai-assistant.md` §10.1 — the first and, in AI-1, only real
provider — and the prerequisite for the "working version" (`ai-1a` + `ai-1b`) and for the
quota work in `ai-1d`, which needs recorded token usage to exist.

## What Changes

- **A real, OpenAI-compatible backend.** A new `OpenAiCompatProvider` implementation of the
  existing `LlmProvider` seam, built on the official `openai` npm package with a configurable
  base URL, so one class serves OpenRouter, DeepSeek, Groq, xAI, MiniMax and any other backend
  whose native API is the Chat Completions form (§5.2). It streams, asks for usage in the
  final frame, and passes the generation's abort signal to the HTTP request, so Stop and the
  generation timeout close the connection instead of merely ceasing to read.
- **Configuration.** `AI_PROVIDER` accepts `openai-compat`; new `AI_BASE_URL`, `AI_API_KEY`.
  With the assistant enabled and a non-fake provider, a missing base URL, key or model fails
  the worker's startup naming the variable. The key is held only by the worker process and is
  never logged.
- **Honest failure classification.** Backend errors are mapped onto the existing
  `LlmProviderError.retryable` flag that AI-0.1's in-delivery retry relies on: network errors,
  connection timeouts, 408/409/429/5xx and a stream cut mid-way are transient; 400/401/403/
  404/422 are permanent. A `Retry-After` from the backend is honoured within the existing
  retry budget — the retry never fires earlier than the backend asked, and a wait longer than
  the budget allows fails the reply now instead of burning a doomed request.
- **Token usage is recorded.** The usage the backend reports in the final frame is written
  into the already reserved `ai_messages.prompt_tokens` / `completion_tokens` / `model`
  columns in the worker's final transaction. `FakeLlmProvider` starts emitting synthetic
  usage on its last frame, so usage (and later `ai-1d` quotas) is testable without a key.
- **Guard against the silent 50× cost trap (§5.3).** The worker warns at startup when
  `AI_BASE_URL` points at an Anthropic host: Claude through the compatibility layer loses
  prompt caching without any error.
- **Operational condition.** `.env.example`, the Swarm stack file and `docs/deploy-swarm.md`
  document the new variables, recommend OpenRouter with zero-data-retention routing and a
  cheap model from §5.5 as the default, and make a hard monthly spend cap on the provider key
  mandatory (next to `AI_API_KEY`) until `ai-1d` quotas exist.

Out of scope: quotas (`ai-1d`), the knowledge corpus (`ai-1b`), assistant settings (`ai-1c`),
retention (`ai-1e`), a native `AnthropicProvider` (deferred, §5.3). The delta protocol, the
AI-0.1 ownership lifecycle (attempt/lease/fencing) and the panel do not change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-assistant/generation-pipeline`: the replaceable-backend requirement gains an external
  backend selected by configuration that must be fully configured to start; the failure
  requirement gains the transient/permanent classification of backend responses, the
  interrupted-stream case and the backend's own retry delay; a new requirement records the
  token usage of each reply.

## Impact

- **Dependencies:** `openai` (official SDK) added to `libs/shared` and, because the worker
  bundles `libs/shared` through webpack with `node_modules` externalised, to `apps/worker`.
- **Shared (`libs/shared/src/ai`):** new `llm/openai-compat.provider.ts`; `ai.config.ts`
  (`openai-compat`, `AI_BASE_URL`, `AI_API_KEY`, credential check); `llm-provider.ts`
  (`retryAfterMs` on `LlmProviderError`, `model` on `LlmUsage`); `fake-llm.provider.ts`
  (synthetic usage); the provider factory moves from the global `AiModule` into a
  worker-only `AiLlmModule`, so the API process never constructs a provider or needs the key;
  `AiMessageStateService.finalize()` writes usage.
- **Worker:** `ai-generate-reply.subscriber.ts` carries usage from the stream to `finalize()`
  and uses `retryAfterMs` in its retry pause; `worker.module.ts` imports `AiLlmModule`.
- **Database:** none — the columns were reserved in AI-0. **Contracts / OpenAPI:** none.
- **Ops/docs:** `.env.example`, `docker/docker-compose.stack.yml`, `docker/deploy.env`,
  `docs/deploy-swarm.md`, `docs/ai-assistant-implementation.md`, `docs/ai-assistant.md`
  §10/§10.1, `docs/roadmap.md`.
