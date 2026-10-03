## 1. Backend

- [x] 1.1 Config: knowledge backend, product, retrieval budget; embedding credentials in the worker.
- [x] 1.2 `PostgresKnowledgeSource` selection, version and excerpt metadata.
- [x] 1.3 Prompt block for retrieved excerpts; static prompt unchanged.
- [x] 1.4 Migration `ai_messages.knowledge_chunks`; `claim()` stores it.
- [x] 1.5 Worker: three-phase `prepare()`, explicit failure on embedding errors.
- [x] 1.6 Contract `citations`, citation endpoint with re-authorization; OpenAPI + orval.

## 2. Frontend

- [x] 2.1 AiPanel sources list and excerpt dialog; i18n.

## 3. Verification

- [x] 3.1 Unit tests: selection, prompt, citation extraction, worker phases/failure.
- [x] 3.2 E2E: citation endpoint ownership and re-authorization on real Postgres.
- [x] 3.3 Live FMS run in the browser; lint/typecheck/build.
