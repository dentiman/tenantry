# Spec Delta

## Purpose

Defines how an assistant reply is produced after a question is accepted: asynchronously, with
the answer arriving progressively, recoverable when updates are lost, stoppable by the user,
honest about failure, and unable to let one tenant's traffic starve another's.

## ADDED Requirements

### Requirement: Reply generation is asynchronous
The system SHALL accept a question and acknowledge it without waiting for the reply to be
produced. The acknowledgement SHALL identify both the stored question and the reply that is
about to be generated, so the client can display them immediately.

#### Scenario: User submits a question
- **WHEN** the user submits a valid question
- **THEN** the request is acknowledged promptly with the question and a placeholder reply
  marked as pending, before any model has been consulted

#### Scenario: Reply generation outlives the request
- **WHEN** the client that submitted a question disconnects immediately afterwards
- **THEN** generation still proceeds and the completed reply is stored and readable later

### Requirement: The model backend is replaceable without behavioral change
The system SHALL treat the text-generating backend as an interchangeable component selected by
deployment configuration, such that replacing it changes neither the stored transcript's shape,
nor the progressive-delivery protocol, nor any error the client can observe.

#### Scenario: Deployment runs the built-in test backend
- **WHEN** the installation is configured to use the built-in test backend, which requires no
  credentials and makes no outbound network request
- **THEN** questions are answered end to end, and the transcript and progressive delivery are
  indistinguishable in shape from a deployment using an external backend

#### Scenario: Test backend is instructed to fail
- **WHEN** the built-in test backend is configured to fail or to stall for a given question
- **THEN** the system exercises its real failure and timeout handling, rather than a special
  case reserved for testing

### Requirement: Replies are delivered progressively
The system SHALL deliver an in-progress reply to the asking user's open clients as a sequence
of incremental updates, and SHALL send a final update stating how the reply ended. Updates
SHALL be grouped so that a reply produces far fewer updates than it has tokens.

#### Scenario: User watches a reply arrive
- **WHEN** a reply is being generated for a user with the panel open
- **THEN** the visible answer grows in increments as it is produced, and a final update marks
  it complete

#### Scenario: The same user has several clients open
- **WHEN** a user has the application open in more than one browser tab
- **THEN** every one of that user's tabs receives the same incremental updates for the reply

#### Scenario: Another user is not shown the reply
- **WHEN** a reply is generated for one user
- **THEN** no other user, in the same tenant or any other, receives its updates

### Requirement: Progressive updates are ordered and recoverable
Each incremental update SHALL carry a position that lets a client detect a missing or
out-of-order update. On detecting a gap, or after reconnecting, a client SHALL be able to
recover the true state by re-reading the transcript. Losing an update SHALL NOT corrupt the
stored reply or leave the client permanently wrong.

#### Scenario: A client misses an update
- **WHEN** a client detects a gap in the sequence of incremental updates
- **THEN** re-reading the transcript yields the correct content produced so far, and rendering
  continues correctly from there

#### Scenario: Client reconnects mid-generation
- **WHEN** a client loses and re-establishes its realtime connection while a reply is being
  generated
- **THEN** after re-reading the transcript it shows the content produced so far and continues
  to receive subsequent updates

### Requirement: Partial output survives interruption
The system SHALL persist the reply's content as it is produced, frequently enough that an
interruption — a process restart, a crash, or a lost connection — leaves the content generated
up to that point readable rather than discarded.

#### Scenario: The generating process stops mid-reply
- **WHEN** the process generating a reply stops before the reply is complete
- **THEN** the content produced up to that point is still present in the transcript and the
  reply is not left claiming to be complete

### Requirement: The user can stop a reply in progress
The system SHALL let the user stop a reply that is being generated. Stopping SHALL keep the
content produced so far, mark the reply as stopped by the user rather than failed, and leave
the user free to ask another question immediately.

#### Scenario: User stops a long reply
- **WHEN** the user stops a reply that is still being generated
- **THEN** generation ceases, the partial content is kept and marked as stopped by the user,
  and the conversation is no longer busy

#### Scenario: User stops a reply that has already finished
- **WHEN** the user stops a reply that completed a moment earlier
- **THEN** the request is accepted without error and the completed reply is left unchanged

### Requirement: Failures are visible and recoverable
When a reply cannot be produced, the system SHALL mark that reply as failed with a
distinguishable error code, SHALL NOT present a failed reply as an answer, and SHALL leave the
conversation usable so the user can ask again.

#### Scenario: The backend is unavailable
- **WHEN** the text-generating backend cannot be reached or refuses the request
- **THEN** the reply is marked failed with an error code identifying the backend as
  unavailable, the user is shown that it failed, and the conversation accepts a new question

#### Scenario: A reply exceeds the allowed generation time
- **WHEN** generation exceeds the configured time limit
- **THEN** it is stopped, the reply is marked failed, and the conversation is no longer busy

#### Scenario: Generation is retried after a transient failure
- **WHEN** a transient failure causes generation for a reply to be attempted again
- **THEN** the reply is regenerated from the beginning and clients are told to discard the
  content received for the previous attempt, so no two attempts are concatenated

#### Scenario: A completed reply is never regenerated
- **WHEN** generation is attempted again for a reply that already completed
- **THEN** nothing is regenerated and the stored reply is left unchanged

### Requirement: One tenant cannot monopolise generation capacity
The system SHALL process replies for different users concurrently, and SHALL bound how many
replies a single tenant may have generating at one time, so that sustained use by one tenant
does not prevent other tenants from receiving replies.

#### Scenario: Two users ask at the same time
- **WHEN** two users in different tenants submit questions at the same moment
- **THEN** both replies are generated concurrently rather than one waiting for the other to
  finish

#### Scenario: One tenant floods the queue
- **WHEN** one tenant has more questions queued than its concurrency bound allows
- **THEN** its excess questions wait, and a question from another tenant submitted afterwards
  is still picked up without waiting for that backlog to drain
