# chat/delivery-status Specification

## Purpose
Defines how provider delivery receipts are folded into the state of outbound messages and how the
browser learns about the change.

## Requirements

### Requirement: A receipt moves a message forward only
A provider receipt that names a stored outbound message SHALL advance its state along
sent, delivered, read and record the time of the step. A receipt SHALL NOT move a message to an
earlier state, and a receipt that does not advance the state SHALL change nothing and cause no
signal. The advance SHALL be decided by the database in one atomic operation, so that receipts
arriving concurrently or out of order give the same final state as in-order arrival.

#### Scenario: In-order receipts
- **WHEN** a message is reported delivered and then read
- **THEN** it ends read, with both times recorded

#### Scenario: A late earlier receipt
- **WHEN** a read receipt arrives and then a delivered receipt for the same message
- **THEN** the message stays read and the delivered time is not lost

#### Scenario: A repeated receipt
- **WHEN** the same receipt is delivered twice
- **THEN** the second changes nothing and emits no signal

#### Scenario: Receipts race
- **WHEN** a delivered and a read receipt for one message are processed at the same time
- **THEN** the message ends read

### Requirement: A failure receipt does not override a delivery
A failure receipt SHALL mark a message failed with the provider's code and title unless the message
is already delivered or read. A later sent receipt SHALL NOT clear a failure. Evidence of delivery
that arrives after a failure SHALL replace the failed state and clear the stored failure.

#### Scenario: Failure after sending
- **WHEN** a sent message is reported failed
- **THEN** it is failed with the code and title recorded

#### Scenario: Failure after delivery
- **WHEN** a delivered message is reported failed
- **THEN** it stays delivered

#### Scenario: Delivery after failure
- **WHEN** a failed message is later reported delivered
- **THEN** it becomes delivered and the failure is cleared

### Requirement: A receipt for an unknown message is parked, not dropped
When a receipt names a provider identifier or our own message identifier that matches no stored
message, the system SHALL keep it. When the provider identifier of a message is recorded, parked
receipts for it SHALL be applied. A periodic sweep SHALL retry parked receipts a bounded number of
times and then discard them with a log entry. A receipt that names a message of another channel or
tenant SHALL NOT be applied to it.

#### Scenario: Receipt before the identifier is stored
- **WHEN** a delivered receipt arrives before the provider identifier of its message is recorded
- **THEN** it is parked, and when the identifier is recorded the message becomes delivered

#### Scenario: A receipt that never matches
- **WHEN** a parked receipt still matches nothing after the allowed number of sweeps
- **THEN** it is discarded and the discard is logged

#### Scenario: Another tenant's message
- **WHEN** a receipt names an identifier that belongs to a message of a different tenant
- **THEN** that message is not changed

### Requirement: The browser is told to re-read, not given the state
When a message changes state because of a receipt or a delivery outcome, the system SHALL notify the
users who can see the conversation with a signal that carries only the identifiers of the
conversation and the message. The client SHALL obtain the new state from the server. A lost signal
SHALL lose no information, because the stored message is the source of truth.

#### Scenario: A receipt changes a message
- **WHEN** a delivered receipt advances a message
- **THEN** a signal naming the conversation and the message reaches the tenant's connected users who can see it

#### Scenario: The user missed the signal
- **WHEN** a user reloads the conversation after a missed signal
- **THEN** the transcript shows the current state of every message

### Requirement: Receipts are accepted through the same signed channel as inbound messages
Receipts SHALL arrive through the public webhook under the same signature and acknowledgement rules
as inbound messages, and SHALL be stored in the raw event store before being processed. A
receipt SHALL NOT be accepted without a valid signature.

#### Scenario: A signed receipt
- **WHEN** a correctly signed receipt is posted to the webhook
- **THEN** it is stored and acknowledged, and the message is updated by the worker

#### Scenario: An unsigned receipt
- **WHEN** a receipt without a valid signature is posted
- **THEN** it is rejected and nothing is stored
