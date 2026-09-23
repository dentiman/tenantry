# chat/transcript Specification

## Purpose

Defines the single ordered feed of a conversation: how messages are ordered and paginated, how
a participant posts text without risking duplicates, and how events about the conversation
itself appear in the same feed as replies.

## Requirements

### Requirement: Every message carries a sequence number assigned by the server
Each message SHALL receive a sequence number that is unique and strictly increasing within its
conversation, assigned by the system rather than supplied by the client. Order SHALL be
determined by that number alone and SHALL NOT depend on timestamps. Two messages posted at the
same instant, including from different processes, SHALL receive different sequence numbers, and
neither SHALL be lost.

#### Scenario: Messages are posted one after another
- **WHEN** three messages are posted to a conversation
- **THEN** their sequence numbers increase in the order the system accepted them, and the
  transcript returns them in that order

#### Scenario: Two messages are posted concurrently
- **WHEN** two messages are posted to the same conversation at the same moment
- **THEN** both are stored, they receive different sequence numbers, and the transcript shows a
  single unambiguous order

#### Scenario: Sequence numbers are per conversation
- **WHEN** messages are posted to two different conversations
- **THEN** the numbering of one conversation is unaffected by the other, and posting to one
  never blocks posting to the other

### Requirement: A participant posts plain text to a conversation
A participant SHALL be able to post a text message to a conversation they take part in. The
body MUST be non-empty after trimming and MUST NOT exceed the published maximum length; a
violation SHALL be rejected with a validation error identifying the body field. A non-
participant SHALL NOT be able to post. The accepted message SHALL be returned with its
identifier and sequence number.

#### Scenario: A participant posts a message
- **WHEN** a participant posts a non-empty body
- **THEN** the message is stored, returned with its sequence number, and appears at the end of
  the transcript

#### Scenario: The body is empty or whitespace only
- **WHEN** a participant posts a body that is empty after trimming
- **THEN** the system rejects it with a validation error on the body and stores nothing

#### Scenario: A non-participant posts
- **WHEN** a user who does not take part in the conversation posts a message
- **THEN** the system refuses in the same way it refuses to disclose the conversation, and
  stores nothing

### Requirement: Re-sending a message with the same client identifier is not a duplicate
Each send SHALL carry a client-supplied identifier for the message. A second send with an
identifier already used in that conversation SHALL NOT create another message: it SHALL return
the message stored the first time, with its original identifier and sequence number, and SHALL
NOT be reported as a conflict.

#### Scenario: The network retries a send
- **WHEN** the same send is delivered twice with the same client identifier
- **THEN** the second call succeeds and returns the message created by the first, and the
  transcript contains exactly one message

#### Scenario: The same text is sent twice deliberately
- **WHEN** a participant sends identical text twice with two different client identifiers
- **THEN** both messages are stored as separate entries in the transcript

### Requirement: The transcript is read backwards through an opaque cursor
The transcript SHALL be readable as pages ordered from the most recent message backwards, each
page returning a cursor for the page before it and an empty cursor once the history is
exhausted. Paging SHALL be stable: messages posted while a client is paging SHALL NOT cause
already-returned messages to repeat or unreturned ones to be skipped.

#### Scenario: Opening a conversation with a long history
- **WHEN** a participant reads the transcript without a cursor
- **THEN** the most recent page of messages is returned together with a cursor for the
  preceding page

#### Scenario: Scrolling further back
- **WHEN** the client requests the next page using the returned cursor
- **THEN** the preceding messages are returned, with no repeats and no gaps

#### Scenario: New messages arrive while paging back
- **WHEN** messages are posted to the conversation between two page requests
- **THEN** the pages already fetched are unaffected and the next page still continues from
  where the previous one ended

#### Scenario: The start of the conversation is reached
- **WHEN** the oldest page is returned
- **THEN** the cursor is empty, and the client can tell that no more history exists

### Requirement: Events about the conversation appear in the transcript
Facts about the conversation itself — that it was created, and that a participant was added —
SHALL appear as entries in the same transcript as replies, in the same ordering, and SHALL be
distinguishable from replies by their type. Their wording SHALL NOT be stored: each entry
SHALL carry a machine-readable type and the data needed to render it, so the displayed text
follows the reader's language.

#### Scenario: A conversation is created
- **WHEN** a participant opens a newly created conversation
- **THEN** the transcript is not empty: it contains an entry recording the creation, followed
  by an entry for each participant who was added

#### Scenario: The reader's language changes
- **WHEN** the same event entry is displayed to readers using different languages
- **THEN** each reader sees it in their own language, with no stored wording overriding it

#### Scenario: Events and replies are paged together
- **WHEN** a client pages back through a transcript containing both replies and events
- **THEN** they are interleaved in a single ordering with a single cursor, and no second feed
  needs to be merged

### Requirement: The transcript stays readable when a sender is no longer available
A message SHALL retain a snapshot of the label its sender had when it was written, so that the
transcript remains attributable after the sender is deactivated, renamed, or removed.

#### Scenario: A sender is deactivated and renamed
- **WHEN** a participant reads a transcript containing messages from a user who has since been
  deactivated or renamed
- **THEN** each message still shows who wrote it, using the label recorded at the time of
  writing

### Requirement: Posting updates the conversation's activity and preview
Posting a message SHALL, as part of the same operation, update the conversation's latest
activity time and the preview shown in the conversation list. A conversation whose message was
accepted SHALL NOT be listed with a stale preview, and a message SHALL NOT be stored without
its conversation being updated.

#### Scenario: A message is posted
- **WHEN** a participant posts a message
- **THEN** the conversation's latest activity time and preview reflect that message from the
  next read onwards

#### Scenario: Storing the message fails
- **WHEN** a send cannot be completed
- **THEN** neither the message nor any change to the conversation's activity, preview or
  counters is retained
