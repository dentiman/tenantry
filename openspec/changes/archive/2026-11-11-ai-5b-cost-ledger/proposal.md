## Why
The platform pays for every provider call but records only tokens of the successful attempt:
no money, no failed or cancelled attempts, no embeddings. The owner needs the cost of every
reply and a full spending history for the superadmin (docs/ai-platform-controls.md §1, §3).

## What Changes
- Read provider-reported cost and request id from OpenRouter responses (chat and embeddings).
- A tariff table with validity periods (OpenRouter sync and manual entry) and a decimal cost
  estimate for every call.
- An append-only cost ledger: one row per billable provider call — every generation attempt,
  the question embedding, ingest embeddings — kept independently of conversation retention.
- Background reconciliation of reported cost for attempts without a usage frame.
- Superadmin reporting in platform-web: spend by period, tenant, model and call type, average
  cost per reply, failed spend, cache savings, reported vs estimated.
- A model without a tariff cannot be activated for a provider that does not report cost.

## Capabilities
### New Capabilities
- `ai-assistant/cost-ledger`: per-call cost recording, tariffs, reconciliation, superadmin reporting.

### Modified Capabilities
None.

## Impact
Migrations (ledger, tariffs), provider adapters, worker finalize/claim paths, ingest store, two
system-scope crons, platform-api and platform-web pages; no tenant-facing contract change.
