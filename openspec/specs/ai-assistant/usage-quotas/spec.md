# ai-assistant/usage-quotas Specification

## Purpose

Bounds how many tokens the AI assistant can spend per user and per tenant in a period, so a
runaway client loop or chatty usage is caught by an application-level budget rather than
relying solely on the provider's own monthly spend cap.

## Requirements

### Requirement: A question is rejected before it is queued when a quota is exceeded
The system SHALL check the asking user's and their tenant's token usage for the current period
against configured limits before the question is accepted, and SHALL reject the question with
a distinguishable, machine-readable reason when either limit has already been reached. A
rejected question SHALL NOT be stored, and no generation work SHALL be queued for it.

#### Scenario: A user has already reached their own quota
- **WHEN** a user asks a question and their token usage for the current period is already at
  or above their configured limit
- **THEN** the question is rejected with a distinguishable reason, no question or reply is
  stored, and no generation work is queued

#### Scenario: A tenant has already reached its quota
- **WHEN** a user asks a question and their tenant's combined token usage for the current
  period is already at or above the tenant's configured limit, even though that user's own
  usage is under their personal limit
- **THEN** the question is rejected the same way as when the personal limit is reached

#### Scenario: Usage is under both limits
- **WHEN** a user asks a question and both their own and their tenant's usage for the current
  period are under the configured limits
- **THEN** the question is accepted and proceeds exactly as it would without quotas

### Requirement: Token usage is deducted once generation completes
The system SHALL add a completed reply's prompt and completion tokens to the asking user's
running total for the period in which the question was asked, in the same durable write that
records the reply's final outcome. A reply that never reports usage SHALL NOT change any
counter.

#### Scenario: A normal turn completes
- **WHEN** a reply finishes and its prompt and completion token counts are known
- **THEN** the asking user's counter for the current period increases by exactly those counts,
  and so does the total observable for their tenant in that period

#### Scenario: A reply never reports usage
- **WHEN** a reply ends without token usage being known, for example because the user stopped
  it before any was reported
- **THEN** no counter changes

### Requirement: Concurrent turns cannot silently double-charge or bypass the quota
The system SHALL deduct usage in a way that two replies completing at the same moment both
have their tokens counted exactly once each, never lost and never applied twice. Because the
check happens before generation and the deduction after, the system SHALL bound how far usage
can run past a limit before further questions are rejected: exceeding a user's own limit is
bounded to the one turn that was already in flight when the limit was reached, since a user
cannot have a second turn in flight at the same time.

#### Scenario: Two replies for the same user finish close together
- **WHEN** a user has at most one reply generating at a time and successive replies complete
  in quick succession
- **THEN** each reply's tokens are added to the counter exactly once, and the final total
  reflects the sum of both, with neither addition lost or duplicated

#### Scenario: A user's quota is exceeded by exactly one turn
- **WHEN** a user's usage is just under their limit, they ask a question that is accepted, and
  that turn's tokens push their total over the limit
- **THEN** that in-flight turn still completes and is billed, and the user's very next question
  is rejected

### Requirement: Cached, prompt and completion tokens are tracked separately
The system SHALL record a period's usage for a user broken down into prompt tokens, the subset
of those prompt tokens served from the backend's cache, and completion tokens, rather than a
single combined count, so that prompt-cache effectiveness is observable independently of raw
spend. The tenant-wide total for a period SHALL be derived from these per-user records rather
than kept as a separately written figure.

#### Scenario: A cached and an uncached turn are compared
- **WHEN** one turn is served mostly from the backend's prompt cache and another is not
- **THEN** the recorded cached-token count differs between the two turns' contribution to the
  counters, even though their total prompt-token count may be similar

### Requirement: Usage counters are isolated per tenant
The system SHALL store usage counters under the same tenant isolation as the rest of the AI
assistant's data: a tenant's process context SHALL never be able to read or write another
tenant's usage counters, regardless of the user or tenant identifiers supplied.

#### Scenario: One tenant's context is used to read counters
- **WHEN** a request running under one tenant's context attempts to read usage counters
  belonging to a different tenant
- **THEN** no rows from the other tenant are returned

#### Scenario: One tenant's context is used to write counters
- **WHEN** a request running under one tenant's context attempts to create or modify a usage
  counter row addressed to a different tenant
- **THEN** the write is rejected or has no effect on the other tenant's data
