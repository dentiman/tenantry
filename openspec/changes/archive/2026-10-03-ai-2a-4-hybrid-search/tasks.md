## 1. Search

- [x] 1.1 Migration: `fts_config`, generated `search_vector`, GIN index; ingest writes `fts_config`.
- [x] 1.2 Store: full-text search with the same filters.
- [x] 1.3 Source: modes, RRF fusion, vector threshold, hybrid degradation; config.

## 2. Evaluation

- [x] 2.1 Question set (draft) and `pnpm ai:docs:eval`.
- [x] 2.2 Run on the FMS index; choose default mode and threshold.

## 3. Verification

- [x] 3.1 Unit: fusion, threshold, modes, degradation.
- [x] 3.2 E2E: FTS filters, language config, tenant isolation.
- [x] 3.3 Docs; lint/typecheck/build.
