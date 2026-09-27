# Tasks

Step **AI-1a** of `docs/ai-assistant.md` §10.1. No test touches the network or needs a key.

Root gate at the end of each group: `pnpm lint && pnpm typecheck && pnpm build`.
Unit tests: `pnpm --filter @saas-skeleton/shared test`, `pnpm --filter @saas-skeleton/worker test`.
Tenant e2e: `pnpm api:test:e2e` (this workspace slot's Postgres + Valkey, via `pnpm ws:init`).

## 1. Interface and configuration

- [x] 1.1 Extend `llm-provider.ts`: `LlmProviderError` gains optional `retryAfterMs`;
      `LlmUsage` gains optional `model` and `cachedPromptTokens` (design D4, D7). Verify with
      `pnpm --filter @saas-skeleton/shared typecheck`.
- [x] 1.2 `ai.config.ts`: `AI_PROVIDER` enum `fake | openai-compat`; `AI_BASE_URL` (URL,
      optional), `AI_API_KEY` (optional); `AiConfig.baseUrl`/`apiKey`; track whether
      `AI_MODEL` was set explicitly; export `requireProviderCredentials(config)` that throws
      `Invalid AI configuration — <VAR>: …` for a missing base URL, key or model when
      enabled with a non-fake provider (design D5). Verify with new cases in
      `ai.config.test.ts` (accepts `openai-compat`; rejects unknown provider; each missing
      variable is named; disabled needs no key; invalid URL rejected).

## 2. `OpenAiCompatProvider`

- [x] 2.1 Add `openai@^7` to `libs/shared` and `apps/worker` dependencies (webpack
      externalises `node_modules`, pnpm resolution is strict). Verify `pnpm install` and that
      `pnpm --filter @saas-skeleton/worker build` bundles without the package inlined.
- [x] 2.2 Implement `libs/shared/src/ai/llm/openai-compat.provider.ts` per design D1–D3, D6:
      client with `baseURL`, `maxRetries: 0`, `timeout`; `stream: true`,
      `stream_options.include_usage`, `max_tokens`; signal passed to the request; quiet return
      on abort; error classification table; premature-end detection; `Retry-After` /
      `retry-after-ms` parsing; usage (incl. model and cached tokens) on the terminal frame;
      Anthropic-host warning; startup log with host only. Export from `ai/index.ts`. Verify
      with 2.3.
- [x] 2.3 `openai-compat.provider.test.ts` against a local `node:http` stub serving recorded
      SSE (design D9): success + usage in the last chunk (text and usage asserted, request
      shape asserted incl. bearer auth and `include_usage`); 429 with `Retry-After`
      (retryable, `retryAfterMs`); 401 (non-retryable); 400/404/422 non-retryable and 500/503/
      408/409 retryable; socket destroyed mid-stream (retryable); stream ending with neither
      `finish_reason` nor usage (retryable); no `finish_reason` but usage present (completes);
      `finish_reason: "length"` (completes, not an error); error frame inside a 200 stream (retryable); abort during a
      stalled stream returns quietly and the stub sees the connection close; connection
      refused (retryable); Anthropic host warns, other hosts do not; the key appears in no
      log call and no error message. Verify `pnpm --filter @saas-skeleton/shared test`.

## 3. Provider wiring (worker-only)

- [x] 3.1 Create `libs/shared/src/ai/ai-llm.module.ts` holding `LLM_FACTORIES`
      (`fake`, `openai-compat`) and the `LLM_PROVIDER` factory; remove the provider from the
      global `AiModule`; import `AiLlmModule` in `apps/worker/src/worker.module.ts` only.
      Disabled + missing credentials → a provider that rejects every call non-retryably
      (design D5). Verify with `ai-llm.module.test.ts` (fake by default; openai-compat built
      when configured; enabled without key throws naming `AI_API_KEY`; disabled without key
      builds a rejecting provider) and `pnpm --filter @saas-skeleton/api typecheck` (nothing
      in the API injects `LLM_PROVIDER`).

## 4. Usage recording

- [x] 4.1 `FakeLlmProvider` emits a terminal `{ text: '', usage }` frame with synthetic,
      deterministic counts and `model = request.model`; none on abort (design D8). Verify with
      new cases in `fake-llm.provider.test.ts`.
- [x] 4.2 `AiMessageStateService`: `claim()` resets `promptTokens`/`completionTokens` to
      `NULL`; `finalize()` accepts optional usage and writes `promptTokens`,
      `completionTokens` and reported `model` in the same conditional update (design D7).
      Verify with 4.4 and the tenant e2e `ai-state.e2e-spec.ts` staying green.
- [x] 4.3 Worker subscriber: keep the last `usage` of the current attempt, reset it on
      `restart()`, pass it to `finalize()`, and log token counts (with cached tokens when
      present) after commit (design D7). Verify with 4.4.
- [x] 4.4 Subscriber tests: fake reply stores non-zero usage and the configured model; a
      reported model overrides it; `__fail_once__` stores the completing attempt's usage; a
      stopped reply keeps usage empty. Verify `pnpm --filter @saas-skeleton/worker test`.

## 5. Retry-After in the worker

- [x] 5.1 Retry pause honours `retryAfterMs` per design D4 (≤ budget → wait the configured
      pause; > budget → no retry, `FAILED`/`PROVIDER_UNAVAILABLE`). Verify with subscriber
      tests using a scripted provider: 429 with a short `retryAfterMs` retries once and
      completes; with a `retryAfterMs` over `AI_RETRY_DELAY_MS` fails after one call.

## 6. Operations and docs

- [x] 6.1 `.env.example`: `AI_PROVIDER=openai-compat` option, `AI_BASE_URL`, `AI_API_KEY`,
      `AI_MODEL`; recommended default OpenRouter (`https://openrouter.ai/api/v1`) with ZDR
      routing and a cheap §5.5 model; the MANDATORY hard monthly spend cap written next to
      `AI_API_KEY`; DeepSeek direct and Anthropic's compat endpoint called out as not to use.
      Verify by reading the block.
- [x] 6.2 `docker/docker-compose.stack.yml` (worker-only anchor for `AI_BASE_URL`/`AI_API_KEY`,
      shared block comment updated), `docker/deploy.env` comment, `docs/deploy-swarm.md`
      (variables, key only on the worker, spend cap before enabling). Verify with
      `docker compose -f docker/docker-compose.stack.yml config -q` (env stubs as needed).
- [x] 6.3 Promote design decisions that stay true into `docs/ai-assistant-implementation.md`
      (provider section, error table, Retry-After rule, usage flow, worker-only credentials,
      §11 config table, §12 test table, §13 status); update `docs/ai-assistant.md` §10/§10.1
      AI-1a status and `docs/roadmap.md`. Verify by reading the updated sections.

## 7. Verification

- [x] 7.1 `pnpm lint && pnpm typecheck && pnpm build` green.
- [x] 7.2 `pnpm --filter @saas-skeleton/shared test`, `pnpm --filter @saas-skeleton/worker test`,
      `pnpm web:test` green.
- [x] 7.3 `pnpm api:test:e2e` green on this workspace's own slot (`pnpm ws:init`).
- [x] 7.4 Manual smoke test with a live key on the chosen backend: first-frame latency and
      `cached_tokens` on the second turn recorded in `docs/ai-assistant-implementation.md`.
      **Done 2026-09-27 on slot 0 with a real OpenRouter key** (`openai/gpt-5.6-luna`), results in
      `docs/ai-assistant-implementation.md` §7.1 "Живий прогін": cache confirmed from the second
      turn (~98% of the ~11k-token prompt). First-frame latency is not persisted anywhere, so the
      total generation time (2.8–4.1 s) was recorded instead; a first-frame metric is left to AI-3.
