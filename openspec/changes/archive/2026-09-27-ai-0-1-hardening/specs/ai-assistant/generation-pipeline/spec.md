# Spec Delta

## ADDED Requirements

### Requirement: Only one attempt generates a reply at a time
The system SHALL let at most one generation attempt own a reply at any moment. A second
attempt to generate the same reply SHALL NOT start while the first still owns it, and an
attempt that has lost ownership SHALL NOT change the stored reply or have its incremental
updates applied by clients.

#### Scenario: Generation work for a reply is delivered twice concurrently
- **WHEN** two workers pick up generation for the same reply at the same time
- **THEN** exactly one of them generates, the backend is consulted once, and the other exits
  without changing the reply

#### Scenario: A stale attempt keeps running after losing ownership
- **WHEN** an attempt whose ownership has expired continues producing output after a newer
  attempt took over the reply
- **THEN** its output is not written to the stored reply, and clients discard its incremental
  updates rather than mixing them into the newer attempt's text

#### Scenario: The generating process dies mid-reply
- **WHEN** the process generating a reply stops and the work is delivered again after the
  previous owner's ownership has expired
- **THEN** the new attempt takes over and regenerates the reply from the beginning

### Requirement: An abandoned reply does not keep the conversation busy
The system SHALL treat a reply that is still marked pending or in progress, but whose
generation ownership has expired with no attempt holding it, as abandoned. An abandoned reply
SHALL be closed as failed, with its partial content kept, no later than the next time its
conversation is read or a question is asked in it.

#### Scenario: All generation deliveries were lost
- **WHEN** a reply's generation never completes because every delivery of the work was lost,
  and its ownership window has passed
- **THEN** the next read of the conversation shows that reply as failed, and the user can ask
  a new question without being told the conversation is busy

#### Scenario: A live reply is not mistaken for an abandoned one
- **WHEN** the conversation is read while a reply is still owned by a running attempt
- **THEN** the reply is returned as in progress and its generation is not interrupted

### Requirement: The model receives the conversation context exactly once
The system SHALL send the backend the question being answered exactly once, preceded by the
most recent completed question/answer pairs of the same conversation up to the configured
number of turns, in conversation order. A question whose answer failed or was stopped SHALL
NOT appear in that history without its answer.

#### Scenario: First question in a conversation
- **WHEN** the first question of a conversation is answered
- **THEN** the backend receives that question once and no history

#### Scenario: History contains a failed turn
- **WHEN** a question is asked after an earlier question whose answer failed
- **THEN** the history sent to the backend omits the failed turn entirely and contains only
  complete question/answer pairs, oldest first, with the current question last and once

#### Scenario: History is longer than the configured limit
- **WHEN** the conversation has more completed turns than the configured history size
- **THEN** only the most recent configured number of complete pairs is sent

## MODIFIED Requirements

### Requirement: Replies are delivered progressively
The system SHALL deliver an in-progress reply to the asking user's open clients as a sequence
of incremental updates, and SHALL send a final update stating how the reply ended. Updates
SHALL be grouped so that a reply produces far fewer updates than it has tokens. Every open
client of the asking user SHALL be able to display the new question and the reply as it
grows, not only the client that asked.

#### Scenario: User watches a reply arrive
- **WHEN** a reply is being generated for a user with the panel open
- **THEN** the visible answer grows in increments as it is produced, and a final update marks
  it complete

#### Scenario: The same user has several clients open
- **WHEN** a user has the application open in more than one browser tab and asks a question
  in one of them
- **THEN** every one of that user's tabs shows the question and the reply growing as it is
  produced, without waiting for the reply to finish

#### Scenario: Another user is not shown the reply
- **WHEN** a reply is generated for one user
- **THEN** no other user, in the same tenant or any other, receives its updates

### Requirement: Progressive updates are ordered and recoverable
Each incremental update SHALL identify the generation attempt it belongs to and carry a
position within that attempt, so that a client can detect a missing, out-of-order, or
superseded update. On detecting a gap, or after reconnecting, a client SHALL be able to
recover the true state by re-reading the transcript, and the transcript SHALL state which
attempt and how many updates its content for an in-progress reply already includes, so that
the client can continue applying later updates from that point. Losing an update SHALL NOT
corrupt the stored reply or leave the client permanently wrong.

#### Scenario: A client misses an update
- **WHEN** a client detects a gap in the sequence of incremental updates
- **THEN** re-reading the transcript yields the correct content produced so far, and rendering
  continues correctly from there

#### Scenario: Client reconnects mid-generation
- **WHEN** a client loses and re-establishes its realtime connection while a reply is being
  generated
- **THEN** after re-reading the transcript it shows the content produced so far and continues
  to receive subsequent updates

#### Scenario: Client resumes live updates after one re-read
- **WHEN** a client re-reads the transcript while a reply is in progress and further updates
  for that reply arrive afterwards
- **THEN** the client appends those updates after the content it read, skipping any update
  already included in it, without re-reading the transcript again

### Requirement: The user can stop a reply in progress
The system SHALL let the user stop a reply that is pending or being generated. Stopping SHALL
keep the content produced so far, mark the reply as stopped by the user rather than failed,
and leave the user free to ask another question immediately. A stop request SHALL be durable:
it SHALL take effect even if generation has not started yet, and even if the immediate stop
signal to the generating process is lost.

#### Scenario: User stops a long reply
- **WHEN** the user stops a reply that is still being generated
- **THEN** generation ceases, the partial content is kept and marked as stopped by the user,
  and the conversation is no longer busy

#### Scenario: User stops a reply before generation starts
- **WHEN** the user stops a reply that is still waiting for generation to begin
- **THEN** the reply is marked stopped by the user immediately, the conversation is no longer
  busy, and generation for it never starts, so the backend is not consulted

#### Scenario: The immediate stop signal is lost
- **WHEN** the user stops a reply in progress and the immediate signal to the generating
  process does not arrive, including while the backend is producing no output
- **THEN** generation still ceases within a bounded few seconds and the reply is marked
  stopped by the user

#### Scenario: User stops a reply that has already finished
- **WHEN** the user stops a reply that completed a moment earlier
- **THEN** the request is accepted without error and the completed reply is left unchanged

### Requirement: Failures are visible and recoverable
When a reply cannot be produced, the system SHALL mark that reply as failed with a
distinguishable error code, SHALL NOT present a failed reply as an answer, and SHALL leave the
conversation usable so the user can ask again. A transient backend failure SHALL be retried
automatically, a bounded number of times, before the reply is marked failed; a permanent
backend failure, a timeout, and a user stop SHALL NOT be retried.

#### Scenario: The backend is unavailable
- **WHEN** the text-generating backend cannot be reached or refuses the request on every
  allowed attempt
- **THEN** the reply is marked failed with an error code identifying the backend as
  unavailable, the user is shown that it failed, and the conversation accepts a new question

#### Scenario: A reply exceeds the allowed generation time
- **WHEN** generation exceeds the configured time limit
- **THEN** it is stopped without being retried, the reply is marked failed, and the
  conversation is no longer busy

#### Scenario: Generation is retried after a transient failure
- **WHEN** the backend fails transiently once and then succeeds
- **THEN** the reply is regenerated from the beginning and completes, and clients are told to
  discard the content received for the failed attempt, so no two attempts are concatenated

#### Scenario: A permanent failure is not retried
- **WHEN** the backend rejects the request in a way that retrying cannot fix
- **THEN** the reply is marked failed after that single attempt

#### Scenario: A completed reply is never regenerated
- **WHEN** generation is attempted again for a reply that already completed
- **THEN** nothing is regenerated and the stored reply is left unchanged
