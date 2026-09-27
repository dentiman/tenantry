# ai-assistant/conversation Specification

## Purpose

Defines the one-conversation-per-user assistant transcript: who may read it, how a user starts
over, what the system accepts as a question, and how the transcript is exposed so a client can
always recover the true state after a lost or missed realtime update.

## Requirements

### Requirement: Each user has exactly one active conversation
The system SHALL maintain at most one active AI conversation per user per tenant, and SHALL
create it on demand the first time that user needs one. Concurrent requests that each need
the conversation to exist SHALL all succeed and SHALL all resolve to the same single
conversation. There SHALL be no conversation list or history screen.

#### Scenario: User opens the assistant for the first time
- **WHEN** a user who has never used the assistant requests their conversation
- **THEN** the system returns an empty conversation for that user

#### Scenario: User asks a second question
- **WHEN** a user who already has an active conversation asks another question
- **THEN** the question is appended to that same conversation rather than starting a new one

#### Scenario: Two tabs open the assistant for the first time at once
- **WHEN** a user with no conversation reads the conversation, asks a question, or starts a
  new conversation from two clients at the same moment
- **THEN** neither request fails with a server error, and afterwards the user has exactly one
  active conversation, which both responses refer to

### Requirement: Starting a new conversation retires the previous one
The system SHALL let a user start a new conversation, which SHALL make the previous
conversation no longer active while retaining it and its messages in storage.

#### Scenario: User starts a new conversation
- **WHEN** the user starts a new conversation
- **THEN** the assistant's context is cleared, subsequent questions no longer see the earlier
  messages, and the user is returned an empty active conversation

#### Scenario: Retired conversation is not destroyed
- **WHEN** a conversation has been retired by starting a new one
- **THEN** its messages still exist in storage and are not deleted as part of that action

### Requirement: A conversation is readable only by the user who owns it
The system SHALL scope conversations to a single user within a single tenant, and SHALL deny
access to any other user, including a user with the ADMIN role in the same tenant, and
including any user in another tenant.

#### Scenario: Administrator tries to read another user's conversation
- **WHEN** a user with the ADMIN role requests a conversation belonging to another user in the
  same tenant
- **THEN** the request is denied and no message content is returned

#### Scenario: User of another tenant references a conversation identifier
- **WHEN** a request authenticated for one tenant references a conversation belonging to
  another tenant
- **THEN** the request is denied and the existence of that conversation is not revealed

### Requirement: The transcript is readable as a whole at any time
The system SHALL expose the active conversation's messages, each with its role, its content
(including content produced so far by a reply still being generated), its ordering position,
and its state, so that a client can reconstruct the exact current state from this read alone.

#### Scenario: Client reads the transcript while a reply is being generated
- **WHEN** the transcript is requested while a reply is still being generated
- **THEN** the response includes the partially generated reply, marked as still in progress

#### Scenario: Client recovers after missing realtime updates
- **WHEN** a client that missed realtime updates re-reads the transcript
- **THEN** the returned transcript reflects the true current state without depending on any
  update the client missed

### Requirement: Questions are bounded on submission
The system SHALL reject a question that is empty or longer than the configured maximum length
with a validation error naming the offending field, and SHALL NOT enqueue any work for a
rejected question.

#### Scenario: User submits an over-long question
- **WHEN** the user submits a question longer than the configured maximum
- **THEN** the request is rejected with a field-level validation error and no reply generation
  is started

#### Scenario: User submits an empty question
- **WHEN** the user submits an empty or whitespace-only question
- **THEN** the request is rejected with a field-level validation error

### Requirement: A user cannot have two replies generating at once
The system SHALL reject a new question while a reply in the same conversation is still being
generated, with a distinguishable error the client can act on. When two questions are
submitted concurrently to the same conversation, exactly one SHALL be accepted and the other
SHALL be rejected with that same error.

#### Scenario: User submits a second question before the first reply finishes
- **WHEN** the user submits a question while the previous reply is still being generated
- **THEN** the request is rejected with an error identifying the conversation as busy, and the
  in-progress reply continues unaffected

#### Scenario: Two questions are submitted at the same moment
- **WHEN** the user submits two questions to the same conversation concurrently
- **THEN** exactly one is accepted and generated, the other is rejected with the busy error,
  and the transcript contains a single new question/reply pair

### Requirement: Other open clients learn when the conversation changes
The system SHALL notify all of a user's open clients when a question is asked in that user's
active conversation or when the user starts a new conversation, so that each client can
re-read the transcript. The notification SHALL reach only that user.

#### Scenario: User starts a new conversation in one tab
- **WHEN** a user with two tabs open starts a new conversation in one of them
- **THEN** the other tab shows the new, empty conversation without being reloaded

#### Scenario: Notification is private to the user
- **WHEN** a user asks a question or starts a new conversation
- **THEN** no other user, in the same tenant or any other, is notified

### Requirement: The assistant can be disabled for the installation
The system SHALL support disabling the AI assistant for the whole installation, and SHALL
default to disabled. While disabled, every assistant endpoint SHALL refuse requests with a
distinguishable error code.

#### Scenario: Request arrives while the assistant is disabled
- **WHEN** the assistant is disabled and any assistant endpoint is called
- **THEN** the request is refused with an error code identifying the assistant as disabled, and
  no conversation is created and no work is enqueued

### Requirement: Question submission is rate limited per user
The system SHALL limit how frequently a single user may submit questions, and SHALL answer an
over-limit request with a rate-limit error that states how long to wait.

#### Scenario: User submits questions faster than the limit allows
- **WHEN** a user submits more questions within a minute than the configured limit
- **THEN** the excess requests are refused with a rate-limit error carrying a retry hint, and
  no work is enqueued for them
