# Design

## Context

See `proposal.md` — Why. The seams this change plugs into, as they are today:

- `LlmProvider.generate(request, signal): AsyncIterable<LlmChunk>` (`libs/shared/src/ai/llm/
  llm-provider.ts`). `LlmChunk.usage?` and `LlmUsage` already exist but nothing fills them.
  `LlmProviderError.retryable` (AI-0.1) is what the worker's in-delivery retry reads.
- `LLM_FACTORIES: Record<AiConfig['provider'], () => LlmProvider>` in the **global** shared
  `AiModule`, which both `apps/api` and `apps/worker` import — so today the API process also
  constructs a provider, although only the worker ever calls one.
- `loadAiConfig()` validates env with Zod and throws `Invalid AI configuration — <VAR>: …`.
  `AI_MODEL` defaults to `fake-1`; `AI_PROVIDER` is `z.enum(['fake'])`.
- The worker (`ai-generate-reply.subscriber.ts`) retries a `retryable` error after a fixed
  `AI_RETRY_DELAY_MS` pause, at most `AI_PROVIDER_RETRIES` times; `AiLeaseGuard` checks at boot
  that the queue's `expireInSeconds` exceeds `leaseMs + retryDelayMs × providerRetries`. Any
  non-`LlmProviderError` thrown from the stream finalizes as `INTERNAL`; an aborted signal
  finalizes as `CANCELLED` or `TIMEOUT` **only if** the provider returns quietly on abort.
- `ai_messages.model` is written by `claim()` from config; `prompt_tokens` /
  `completion_tokens` are reserved and never written. `finalize()` is the one final write.

Observed behaviour of `openai@7` streaming (probed against a local HTTP stub before this
design was fixed): a socket destroyed mid-stream surfaces as a plain `TypeError: terminated`
from `fetch`, not as an `APIError`; a body that ends without any `finish_reason` and without
`[DONE]` ends the iteration **normally**; an abort during iteration also ends it normally
(before the response it throws `APIUserAbortError`); HTTP errors are typed (`RateLimitError`
etc.) with `status` and `headers`; usage arrives in a separate last chunk with `choices: []`
and the model the backend actually used.

## Goals / Non-Goals

**Goals:**
- One class covers every backend whose native API is Chat Completions; switching backend is
  configuration only.
- The worker's lifecycle (claim → stream → retry → finalize, attempt fencing) is untouched;
  the provider adapts to it, not the other way round.
- Every behaviour in the spec delta is reachable from a test with no network and no key.

**Non-Goals:**
- Persisting cached-token counts, quotas, cost in money (`ai-1d`).
- Tool calling, files, multiple system messages (the prompt builder is unchanged).
- A non-streaming mode.
- Native Anthropic (§5.3).

## Decisions

### D1. The official `openai` SDK with `baseURL`, its own retries switched off

`openai@7` (CommonJS, so it needs none of the ESM treatment `pg-boss`/`file-type` get) with
`new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: requestTimeoutMs })`, one client per
provider instance.

`maxRetries: 0` is the important part. The SDK retries 408/409/429/5xx twice by default,
honouring `Retry-After` itself; left on, a single "attempt" of the worker would become up to
three HTTP requests, invisible to `AiLeaseGuard`'s budget arithmetic and to the delta
protocol's `attempt` counter. There is exactly one retry loop in the system, the worker's.

*Alternatives:* raw `fetch` + a hand-written SSE parser — fewer dependencies, but the SSE edge
cases (multi-line `data:`, comments, `[DONE]`, error bodies) are exactly what the SDK has
already debugged, and the typed errors make D3 a table rather than a parser. The Vercel AI SDK
— a second abstraction over the one we already own (`LlmProvider`).

### D2. Request shape

`chat.completions.create({ model, messages, max_tokens, stream: true,
stream_options: { include_usage: true } }, { signal })`.

- `max_tokens`, not `max_completion_tokens`: the latter is OpenAI-first-party only; the older
  name is what every compatible backend and OpenRouter accept.
- `signal` is the worker's own `AbortController` signal, so Stop/timeout tear down the HTTP
  connection (spec: "Stop ends the request to the external backend").
- On abort the provider **returns quietly** — whether the SDK threw `APIUserAbortError` or the
  iteration just ended — because the worker derives `CANCELLED`/`TIMEOUT` from the signal's
  reason, and any thrown non-provider error would be misfiled as `INTERNAL`.
- A frame's `delta.content` is yielded as text; frames with no content (role-only, the
  `finish_reason` frame, the usage frame) yield nothing or only `usage`.

### D3. Error classification onto `LlmProviderError.retryable`

Every error leaving `generate()` is an `LlmProviderError`; the message is diagnostic
(`OpenAI-compatible backend responded 401`) and never contains the key or the request body.

| Source | `retryable` |
| --- | --- |
| `APIConnectionError` / `APIConnectionTimeoutError` (DNS, refused, TLS, connect timeout) | `true` |
| HTTP 408, 409, 429, ≥ 500 | `true` |
| HTTP 400, 401, 403, 404, 422 and any other 4xx | `false` |
| Error while iterating the body (`TypeError: terminated`, `ECONNRESET`, …) | `true` |
| Body ended with neither a `finish_reason` nor the usage frame | `true` (new error, "stream ended prematurely") |
| An error frame inside a 200 stream (OpenRouter sends `{"error": …}` mid-stream) | `true` — surfaces as `APIError` without status |

"Any other 4xx → false" is the safe default: an unknown client error will not be fixed by
sending the same bytes again, and a wrong `false` costs one failed reply, a wrong `true` costs
money. `finish_reason: "length"` or `"content_filter"` is a **completed** reply (the output
ceiling is by design); the text so far stands.

A premature end is transient because the worker restarts from scratch (AI-0.1 D2), and the
spec requires that a truncated reply is never stored as `COMPLETE`.

**What counts as "ended properly"** (coordinator review, 2026-09-27): a `finish_reason` on
any frame **or** the final usage frame. Some compatible backends omit `finish_reason` on the
last content chunk; since every request asks for `include_usage`, the usage frame is an
equally reliable end-of-reply marker — it is emitted only after generation finished. Only
*neither* marker → truncation. `finish_reason: "length"` (the `max_tokens` ceiling) is a
normal `COMPLETE` reply: not an error, not retried.

### D4. `Retry-After` within the existing budget

`LlmProviderError` gains an optional `retryAfterMs`, parsed from `retry-after-ms` or
`retry-after` (seconds or HTTP date). The worker's pause becomes:

- no `retryAfterMs` → `AI_RETRY_DELAY_MS`, as today;
- `retryAfterMs ≤ AI_RETRY_DELAY_MS` → `AI_RETRY_DELAY_MS` (never sooner than asked, and the
  configured pause stays the floor);
- `retryAfterMs > AI_RETRY_DELAY_MS` → no retry; the reply fails as `PROVIDER_UNAVAILABLE`
  now.

The budget is `AI_RETRY_DELAY_MS`, because it is what `AiLeaseGuard` already accounts for in
`leaseMs + retryDelayMs × providerRetries`. Waiting longer than that would let pg-boss
redeliver a job whose owner is still alive; retrying sooner than asked is a guaranteed second
429. Failing fast is the honest outcome and costs nothing. The pause stays abortable.

*Alternative:* clamp the wait down to the budget and retry anyway — rejected, it is the "burn
a doomed request" case.

### D5. Credentials are the worker's, validated where a provider is built

`AiConfig` gains `baseUrl: string | null` and `apiKey: string | null`; `AI_PROVIDER` becomes
`z.enum(['fake', 'openai-compat'])`. The credential check is **not** part of `loadAiConfig()`:
the API process reads the same config (flag, limits) but never calls a model, and should
neither need nor hold the key.

- The provider factory moves from the global `AiModule` into a new, non-global
  `AiLlmModule` (`libs/shared/src/ai/ai-llm.module.ts`) that only `WorkerModule` imports.
  `LLM_FACTORIES` stays a `Record` over the provider union (exhaustiveness is still checked
  by the type system).
- `openai-compat` with `AI_ENABLED=true` and a missing `AI_BASE_URL`, `AI_API_KEY` or an
  unset `AI_MODEL` throws at factory time: `Invalid AI configuration — AI_API_KEY: required
  when AI_PROVIDER=openai-compat and AI_ENABLED=true`. Nest resolves providers during
  bootstrap, so the worker fails to start, as the rest of `ai.config.ts` does. `AI_MODEL`
  keeps its `fake-1` default for `fake`; for `openai-compat` it must be set explicitly (the
  default would be sent to a real backend as a model name).
- `openai-compat` with `AI_ENABLED=false` and missing credentials starts, with a provider that
  rejects every call with a non-retryable `LlmProviderError`: a disabled assistant accepts no
  questions, and a stray queued job should fail its reply rather than crash the worker.
- The key is only passed to the SDK constructor. Nothing logs `AiConfig` as a whole; the
  startup line logs provider, model and base-URL **host** only. Test: a spy on the Nest
  logger across construction and a failing request never sees the key.
- `docker-compose.stack.yml`: `AI_BASE_URL`/`AI_API_KEY` go into a worker-only anchor, not the
  shared `x-ai-env`.

### D6. Anthropic-host warning

At construction, if the base URL's hostname is `anthropic.com` or ends with `.anthropic.com`,
log a `warn` pointing at `docs/ai-assistant.md` §5.3 (prompt caching is silently lost through
the compatibility layer). A warning, not a refusal: the doc defers native Anthropic, it does
not forbid an operator's informed choice, and a refusal would need an override flag for no
gain.

### D7. Usage travels with the stream and lands in `finalize()`

- `LlmUsage` gains optional `model` (the model the backend reports — routers can substitute,
  so this is more truthful than the configured name) and optional `cachedPromptTokens` (from
  `usage.prompt_tokens_details.cached_tokens`; logged, not persisted — persisting it is
  `ai-1d`).
- The worker keeps the last `usage` seen in the current attempt; a `restart()` resets it, so
  stored usage is the completing attempt's (spec scenario). Earlier failed attempts' tokens
  are not recorded — accepted for now (Risks).
- `AiMessageStateService.finalize()` takes an optional `usage` and writes `promptTokens`,
  `completionTokens` and — if reported — `model` in the same conditional `updateMany`. No
  usage → columns untouched (they are `NULL` from `claim()`'s fresh row, and `claim()` now also
  resets them to `NULL` so a reclaimed row cannot keep a previous attempt's numbers).
- After commit the worker logs one `info` line per reply with the token counts (and cached
  tokens when present) — that is where the manual live-key smoke test reads `cached_tokens`.

### D8. `FakeLlmProvider` synthetic usage

On its last frame (a `{ text: '', usage }` terminal frame, the shape the interface already
documents), the fake reports `promptTokens = ceil(prompt chars / 4)`,
`completionTokens = ceil(answer chars / 4)`, `model = request.model`. Deterministic, non-zero,
proportional to input — enough for `ai-1d` to test quota arithmetic. No usage on abort, like a
real backend.

### D9. Tests without network: a local HTTP stub serving recorded SSE

`openai-compat.provider.test.ts` (vitest, `libs/shared`) starts `node:http` on `127.0.0.1:0`
per suite and serves canned responses keyed by scenario: success with a usage frame, 429 with
`Retry-After`, 401, a stream whose socket is destroyed mid-way, a stream that ends without
`finish_reason`, an error frame, a stalled stream for abort. The canned bodies are recorded
SSE in the exact shape OpenRouter emits (fixtures inline in the test, not files). The stub also
asserts the request: path `/chat/completions`, `Authorization: Bearer`, `stream`,
`stream_options.include_usage`, `max_tokens`, and — for abort — that the server sees the
connection close.

Worker-level behaviour (usage written, reset on restart, `retryAfterMs` honoured/over budget)
is tested in the existing `ai-generate-reply.subscriber.test.ts` with a small scripted
provider, since the fake has no 429 directive and adding test-only directives for header
semantics is not worth it. Config/factory behaviour gets tests in `ai.config.test.ts` and a
new `ai-llm.module.test.ts`.

## Risks / Trade-offs

- [Usage of failed attempts is lost] → a transient failure mid-stream is billed by the
  backend but not recorded. Bounded by `AI_PROVIDER_RETRIES` (1). `ai-1d` decides whether to
  count it; the seam (usage per attempt in the worker) is already there.
- [Backend without `stream_options` support] → some compatible backends ignore it; usage then
  stays `NULL` (spec: "left empty rather than estimated"). A backend that *rejects* the unknown
  field would fail every reply with 400 — the startup smoke test catches it immediately.
- [`finish_reason` never sent by a quirky backend] → every reply would be classified as a
  premature end and retried. Known compatible backends all send it; if one does not, the
  manual smoke test shows it on the first question.
- [Retry-After longer than the pause fails fast] → under sustained 429 the user sees
  failures instead of slow answers. Correct for a rate-limited key; the operator raises
  `AI_RETRY_DELAY_MS` (and the queue expiry, as `AiLeaseGuard` demands) if they prefer waiting.
- [The API no longer has `LLM_PROVIDER` in its container] → nothing in `apps/api` injects it
  (verified by grep); an e2e that did would fail loudly at compile/boot, not silently.

## Migration Plan

No data migration. Deploys keep `AI_PROVIDER=fake` unless the operator changes it. Enabling a
real backend: set `AI_PROVIDER=openai-compat`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` on the
worker, set the hard monthly spend cap on the key **first**, then `AI_ENABLED=true` on both
api and worker. Rollback: `AI_PROVIDER=fake` (or `AI_ENABLED=false`) and restart the worker.
