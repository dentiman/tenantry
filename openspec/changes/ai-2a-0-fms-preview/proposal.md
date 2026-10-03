## Why

The pgvector store accepts vectors but operators cannot inspect which FMS documents
will be indexed or their embedding token cost. A local, deterministic preview is
the next increment before any external API calls.

## What Changes

- Add `ai:docs:preview` with an explicit checkout root and source manifest.
- Validate publication status, language, product and audience mapping; report every rejection.
- Parse Markdown sections, produce Unicode-safe chunks with bounded token overlap,
  and count actual cl100k_base tokens including headings.
- Reject symlinks, oversized files and duplicate document identities.
- Simplify the local pgvector transition to an authorized disposable database reset.

## Capabilities

### New Capabilities

- `ai-assistant/document-preview`: inspect admitted documents/chunks/cost inputs offline.

## Impact

New ingestion utilities in libs/shared, CLI and pilot manifest. No HTTP contract changes.
No embeddings API or database writes in preview. Existing assistant corpus is unchanged.
