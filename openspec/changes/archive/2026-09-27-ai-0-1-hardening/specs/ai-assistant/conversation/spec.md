# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
