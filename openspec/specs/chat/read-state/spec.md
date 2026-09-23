# chat/read-state Specification

## Purpose

Defines how far each participant has read a conversation: a per-participant cursor that only
moves forward, the unread count derived from it, and what joining a conversation does to both.

## Requirements

### Requirement: Each participant has a read cursor that only moves forward
Every participant SHALL have their own record of how far they have read a conversation,
expressed as a position in that conversation's ordering. A request to move the cursor SHALL
move it only towards newer messages; a request naming an older position SHALL leave it where it
is and SHALL NOT be reported as an error. The cursor SHALL be per participant: moving it SHALL
NOT affect what any other participant sees as unread.

#### Scenario: A participant reads to the end
- **WHEN** a participant reports having read up to the most recent message
- **THEN** their cursor moves to that message and their unread count for the conversation
  becomes zero

#### Scenario: A stale cursor update arrives late
- **WHEN** a participant reports a position older than the one already recorded
- **THEN** the request succeeds without moving the cursor backwards

#### Scenario: One participant reads, another does not
- **WHEN** one participant reads a conversation to the end
- **THEN** the unread counts of the other participants are unchanged

### Requirement: Unread counts exclude the reader's own messages
A participant's unread count for a conversation SHALL reflect the messages posted by others
after their read cursor. A participant's own message SHALL NOT increase their unread count.
Entries recording events about the conversation SHALL advance the transcript without increasing
anyone's unread count, so that membership changes do not raise an unread badge.

#### Scenario: A colleague posts three messages
- **WHEN** another participant posts three messages to a conversation
- **THEN** the reader's unread count for it is three, and the author's is zero

#### Scenario: A participant is added
- **WHEN** a participant is added to a conversation and the corresponding event is recorded
- **THEN** no participant's unread count changes as a result

#### Scenario: The conversation is opened and read
- **WHEN** the reader reports having read up to the latest message
- **THEN** their unread count becomes zero and stays zero until someone else posts

### Requirement: Joining shows the whole history and creates no unread
A participant added to an existing conversation SHALL be able to read its entire history from
before they joined. Their read cursor SHALL start at the conversation's most recent message, so
that joining SHALL NOT produce an unread count for messages written before they were added. The
position at which they joined SHALL be recorded so that it can be shown in the transcript.

#### Scenario: A user is added to a busy conversation
- **WHEN** a user is added to a conversation that already holds hundreds of messages
- **THEN** their unread count for it is zero

#### Scenario: The new participant scrolls back
- **WHEN** that user pages back through the transcript
- **THEN** the messages written before they joined are readable

#### Scenario: The joining point is visible
- **WHEN** that user reads the conversation
- **THEN** the system exposes where they joined, so the transcript can mark the boundary

### Requirement: Unread counts are reported with the conversation list
The unread count SHALL be available together with the list of a user's conversations, without
a separate request per conversation, and SHALL be the requesting user's own count rather than
any shared value.

#### Scenario: A user opens the chat area
- **WHEN** a user requests their conversations
- **THEN** each entry carries that user's unread count for it

#### Scenario: Two users compare the same conversation
- **WHEN** two participants of the same conversation request their lists
- **THEN** each sees their own unread count for it, which may differ
