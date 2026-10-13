# chat/outbound Specification

## Purpose

Defines how an agent's reply to a customer is accepted, queued, delivered through the channel's
provider, and what happens when delivery fails.

## ADDED Requirements

### Requirement: An agent can reply to a customer conversation
A user who can see a customer conversation SHALL be able to post a text reply into it. The reply
SHALL be stored as part of the conversation transcript with the next sequence number, attributed to
the user, and marked as outbound and queued, and the request SHALL be answered without waiting for
the provider. A reply SHALL carry a client-supplied identifier, and posting the same identifier
again SHALL return the stored message without queueing a second delivery. This supersedes the
refusal to post into a customer conversation introduced with the customer inbox.

#### Scenario: A reply is accepted
- **WHEN** a user posts a reply with text and a new client identifier inside the freeform window
- **THEN** the system answers created with the message in the queued state, and one delivery is queued

#### Scenario: The same client identifier is posted again
- **WHEN** the same user posts again with the same client identifier
- **THEN** the stored message is returned and no further delivery is queued

#### Scenario: Two identical requests race
- **WHEN** two requests with the same client identifier arrive at the same time
- **THEN** exactly one message is stored, exactly one delivery is queued, and both requests succeed

#### Scenario: A user who cannot see the conversation
- **WHEN** a user of another tenant posts into it
- **THEN** the system answers not found and stores nothing

#### Scenario: Text longer than the channel allows
- **WHEN** the reply exceeds the maximum text length the channel's provider accepts
- **THEN** the system refuses it as invalid and stores nothing

### Requirement: Freeform replies are limited to the provider's window
When the provider restricts freeform messages to a period after the customer's last message, the
system SHALL refuse a reply once that period has passed, measured from the provider's timestamp of
the customer's last message, with a distinct error code that the client can explain. When the
customer has never written, there is no window and the reply SHALL be refused the same way. The
system SHALL check the window again in the worker immediately before sending, and a message found to
be outside the window then SHALL fail with the window-closed class instead of being sent.

#### Scenario: Inside the window
- **WHEN** the customer wrote 23 hours ago and an agent replies
- **THEN** the reply is accepted

#### Scenario: Outside the window
- **WHEN** the customer wrote 25 hours ago and an agent replies
- **THEN** the system answers unprocessable with the window-closed error code and stores nothing

#### Scenario: The window closes while the message waits
- **WHEN** a reply accepted inside the window is picked up by the worker after the window ended
- **THEN** it is not sent and is marked failed with the window-closed class

#### Scenario: A provider without a window
- **WHEN** the channel's provider declares no freeform window
- **THEN** a reply is never refused for that reason

### Requirement: Delivery is ordered per conversation and bounded
Deliveries for one conversation SHALL be attempted one at a time in the order the messages were
accepted. A delivery SHALL record each attempt on the message and SHALL stop after a bounded number
of attempts. Every outcome that cannot succeed by waiting SHALL end the message in the failed state
and the delivery job normally, so that a single bad message never blocks the messages behind it
indefinitely. Deliveries for different conversations SHALL NOT wait for each other.

#### Scenario: Two replies in a row
- **WHEN** two replies are accepted in one conversation one after the other
- **THEN** the first is handed to the provider before the second

#### Scenario: A message that can never be sent
- **WHEN** the provider rejects a reply permanently
- **THEN** the message is failed, and the next reply in the conversation is delivered

#### Scenario: Attempts are exhausted
- **WHEN** a temporary failure persists through the allowed number of attempts
- **THEN** the message is failed with the transient class and the attempt count is recorded

#### Scenario: Another conversation is not delayed
- **WHEN** one conversation has a message waiting for a retry
- **THEN** replies in other conversations are delivered without waiting for it

### Requirement: Provider errors are classified and each class has a defined effect
The adapter SHALL translate a provider failure into one of a closed set of classes: window closed,
permanent, policy, rate limited, authentication, transient, or needs a human. The system SHALL store
the class, the provider's code and a human-readable title on the failed message. Rate-limited and
transient failures SHALL be retried with backoff until the attempt bound. Window-closed, permanent,
policy and needs-a-human failures SHALL fail the message without retry. An authentication failure
SHALL mark the messaging account as needing re-authentication and fail the message with the
authentication class. No class SHALL expose the provider's secret material.

#### Scenario: A temporary failure
- **WHEN** the provider is unavailable for the first attempt and available for the second
- **THEN** the message ends up sent and records two attempts

#### Scenario: A permanent rejection
- **WHEN** the provider reports that the recipient cannot be reached
- **THEN** the message is failed with the permanent class and is not retried

#### Scenario: Rate limiting
- **WHEN** the provider answers with a rate limit
- **THEN** the delivery is retried later and the message is not failed until the bound is reached

#### Scenario: Credentials rejected
- **WHEN** the provider rejects the account's credentials
- **THEN** the account is marked as needing re-authentication and the message is failed with the authentication class

### Requirement: An unconfirmed delivery is never resent blindly
If a delivery attempt is interrupted after the provider may have accepted the message but before the
provider's identifier was stored, a repeated delivery job SHALL NOT send the message again. It SHALL
wait a bounded time for a receipt that identifies the message, and when none arrives the message
SHALL become failed as unconfirmed. The author SHALL be able to resend such a message explicitly.

#### Scenario: Receipt arrives during the wait
- **WHEN** a delivery job restarts for a message in sending without a provider identifier, and a receipt naming the message arrives within the wait
- **THEN** the message takes the receipt's identifier and state and nothing is sent again

#### Scenario: No receipt arrives
- **WHEN** the wait ends with no receipt
- **THEN** the message is failed as unconfirmed and the provider was not called a second time

### Requirement: A failed message can be resent explicitly
A user who can see the conversation SHALL be able to resend a failed outbound message. Resending
SHALL put the same message back in the queued state with a cleared failure and a fresh attempt
count, keep its place in the transcript, and queue one delivery. It SHALL be refused for a message
that is not failed, and a window-closed message SHALL be refused again while the window is closed.

#### Scenario: Resend after a failure
- **WHEN** a user resends a failed message inside the window
- **THEN** the same message becomes queued again and is delivered

#### Scenario: Resend of a message that is not failed
- **WHEN** a user resends a sent message
- **THEN** the system refuses with a conflict and queues nothing

#### Scenario: Two users resend at once
- **WHEN** two users resend the same failed message at the same time
- **THEN** exactly one delivery is queued

### Requirement: A fake provider exercises every outcome
The fake provider SHALL be able to produce each error class and a successful send on demand, without
network access, so that all behaviour in this capability can be verified without a provider account.
It SHALL be available only where development tools are enabled.

#### Scenario: A scripted failure
- **WHEN** a reply contains the fake provider's marker for a permanent failure
- **THEN** the message ends failed with the permanent class

#### Scenario: Development tools are off
- **WHEN** development tools are disabled
- **THEN** no fake channel can be created and the fake provider is not registered
