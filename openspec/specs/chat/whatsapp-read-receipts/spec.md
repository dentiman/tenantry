# chat/whatsapp-read-receipts Specification

## Purpose
TBD - created by archiving change chat-3b3-mark-read. Update Purpose after archive.

## Requirements

### Requirement: Reading a customer conversation acknowledges the inbound messages to the provider
When a user moves the read cursor of a customer conversation to a sequence number, every inbound message of that
conversation up to it that has a provider message id, was sent by the customer within the last 30 days and has
not been acknowledged yet SHALL be marked as acknowledged, and a job SHALL be queued that tells the provider the
newest of them is read. The marking and the job SHALL happen in the transaction that moved the cursor. An inbound
message SHALL be acknowledged at most once, however many users read the conversation or how often the cursor
moves. Internal conversations and outbound messages SHALL NOT be acknowledged.

#### Scenario: An agent opens an unread customer message
- **WHEN** an agent reads a customer conversation whose newest inbound message has not been acknowledged
- **THEN** that message and the older unacknowledged inbound messages are marked acknowledged and one acknowledgement job is queued for the newest

#### Scenario: A second agent reads the same message
- **WHEN** another user reads the same conversation up to the same message
- **THEN** no further job is queued

#### Scenario: A newer message arrives
- **WHEN** the customer writes again and an agent reads up to the new message
- **THEN** only the new inbound message is acknowledged

#### Scenario: An old message
- **WHEN** the newest inbound message is older than 30 days
- **THEN** it is not acknowledged and no job is queued

#### Scenario: An internal conversation
- **WHEN** a user reads an internal conversation
- **THEN** nothing is acknowledged to any provider

### Requirement: The acknowledgement is sent once, best effort
The worker SHALL send the acknowledgement for the newest message through the channel's adapter, only when the
adapter supports it, the channel is enabled and the account is connected. A provider that does not support it
(the fake provider) SHALL be skipped without error. A refusal or an unreachable provider SHALL be recorded in
the provider-call log as a failed `read` call, SHALL NOT change the message or the conversation, and SHALL NOT
be retried. The call SHALL carry no message text.

#### Scenario: Meta accepts it
- **WHEN** the worker handles the job for a Meta channel
- **THEN** one request marks that message read at the provider and nothing is logged

#### Scenario: Meta refuses it
- **WHEN** the provider answers with an error
- **THEN** a failed `read` entry with the provider code is logged, and the job finishes without a retry

#### Scenario: A provider without support
- **WHEN** the channel's adapter has no read acknowledgement
- **THEN** the job finishes without any call

#### Scenario: A disconnected account
- **WHEN** the account needs re-authorisation or is disabled
- **THEN** no call is made
