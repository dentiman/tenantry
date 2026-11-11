## ADDED Requirements

### Requirement: Every billable provider call is recorded
The system SHALL record one ledger entry for every call to a model provider that may be billed —
each generation attempt including failed and cancelled ones, the question embedding and every
ingest embedding batch — with tokens, provider, model and, when available, the provider-reported
cost and request id. Entries SHALL contain no question, answer or document text.

#### Scenario: Reply with a retried attempt
- **WHEN** a reply succeeds on its second attempt
- **THEN** the ledger holds two generation entries and one question-embedding entry for that reply

#### Scenario: Conversation deleted
- **WHEN** a user deletes their conversations or retention purges them
- **THEN** the ledger entries of those replies remain

### Requirement: Cost is known in money
The system SHALL store the provider-reported cost when the provider returns it and SHALL compute
an estimated cost from the tariff valid at the time of the call, freezing it in the entry.

#### Scenario: Tariff changes later
- **WHEN** a model's tariff changes after a call
- **THEN** the estimated cost of the earlier call is unchanged

#### Scenario: Attempt without a usage frame
- **WHEN** an attempt is cancelled or cut off before the provider reports usage
- **THEN** the entry is reconciled later from the provider's generation record, or keeps the estimate if that is unavailable

### Requirement: Superadmin spending report
The system SHALL let a platform operator see spending for a period by tenant, model and call type,
the average cost per reply, spending on failed and cancelled replies, cache savings, and reported
versus estimated totals. Tenant users SHALL NOT have access to this report.

#### Scenario: Monthly report
- **WHEN** the operator opens the report for a month
- **THEN** the totals equal the sum of the ledger entries of that month, split by the chosen dimension
