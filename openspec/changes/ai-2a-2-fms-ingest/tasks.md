## Implementation

- [x] Add embeddings adapter with validation, bounded retries and cancellation.
- [x] Add ingest state, checkpointing, reuse and guarded atomic publication.
- [x] Add tenant-aware ingest/search CLI and configuration documentation.

## Verification

- [x] Test provider boundary and real PostgreSQL isolation/publication/retry.
- [x] Import the actual FMS business corpus and verify zero-call repeat plus text search.
- [x] Run lint/typecheck/build and record results.
