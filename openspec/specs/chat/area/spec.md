# chat/area Specification

## Purpose

Defines the Chat area as a screen in the tenant application: how conversations are listed and
opened, how a message behaves between being sent and being confirmed, and how a client that
holds no live connection learns that the conversation has moved on.

## Requirements

### Requirement: The Chat area lists conversations and opens one by URL
The Chat area SHALL show the user's conversations in its own column, each with its title, a
preview of the latest message, the time of that message and an unread indicator when the count
is above zero, with conversations carrying unread messages visually distinguishable from the
rest. Opening a conversation SHALL change the address, and opening that address directly SHALL
restore the same conversation.

#### Scenario: A user opens a conversation
- **WHEN** the user selects a conversation from the list
- **THEN** its transcript is shown and the address identifies that conversation

#### Scenario: The page is reloaded
- **WHEN** the user reloads the page on a conversation's address
- **THEN** the same conversation is open and its transcript is shown

#### Scenario: An unknown conversation is addressed
- **WHEN** the user opens the address of a conversation they cannot see
- **THEN** the area stays usable and reports that the conversation is unavailable, rather than
  failing to render

#### Scenario: No conversation is selected
- **WHEN** the user enters the Chat area without selecting a conversation
- **THEN** the list is shown beside an explanatory empty state rather than a blank panel

### Requirement: A sent message appears immediately and is reconciled with the server
A message SHALL appear in the transcript as soon as the user sends it, marked as not yet
confirmed, and SHALL be replaced by the stored message once accepted, without the entry
appearing twice or visibly jumping. If the send fails, the entry SHALL remain visible in a
failed state with a way to retry, and retrying SHALL NOT produce a second message.

#### Scenario: A message is sent successfully
- **WHEN** the user sends a message
- **THEN** it appears in the transcript at once and, once accepted, is shown as sent without
  duplication

#### Scenario: The send fails
- **WHEN** the send does not complete
- **THEN** the entry stays visible marked as failed, and the text is not lost

#### Scenario: The user retries a failed send
- **WHEN** the user retries that entry and the retry succeeds
- **THEN** the transcript contains exactly one message for it

### Requirement: The transcript refreshes on demand, not continuously
The Chat area SHALL NOT hold a live connection for chat and SHALL NOT poll on a timer. It
SHALL refresh the open transcript and the conversation list when the window regains focus and
after the user sends a message, and SHALL offer a way to refresh deliberately. Consequently a
message posted by another user SHALL become visible at the next refresh rather than
immediately, and the screen SHALL NOT present stale data as live.

#### Scenario: A colleague posts while the window is in the background
- **WHEN** another participant posts a message and the user returns to the window
- **THEN** the transcript and the conversation list show that message and the updated unread
  indicator

#### Scenario: The user sends a message
- **WHEN** the user sends a message
- **THEN** the conversation list reflects the new preview and ordering without a manual refresh

#### Scenario: The window is left open and untouched
- **WHEN** the window stays focused and idle
- **THEN** the client issues no repeated background requests for the conversation

### Requirement: Older history loads by scrolling up without losing the reading position
The transcript SHALL open anchored at its most recent message and SHALL load the preceding page
when the user scrolls to the top of the history. Loading older messages SHALL preserve the
user's reading position, and a loading state SHALL be shown while the page is fetched. When no
more history exists, the transcript SHALL stop requesting it.

#### Scenario: The user scrolls to the top
- **WHEN** the user scrolls to the start of the loaded history
- **THEN** the preceding messages are loaded and the message they were reading stays where it
  was on screen

#### Scenario: The beginning of the conversation is reached
- **WHEN** the oldest messages have been loaded
- **THEN** no further requests are made and the transcript indicates its beginning

### Requirement: The transcript is grouped and dated
Consecutive messages from the same author SHALL be grouped so that the author is shown once per
group, and the transcript SHALL separate messages by day. The user's own messages SHALL be
visually distinguishable from other participants'. Entries recording events about the
conversation SHALL be rendered distinctly from replies, in the reader's language.

#### Scenario: One author writes several messages in a row
- **WHEN** a participant posts three consecutive messages
- **THEN** they are shown as one group with a single author heading

#### Scenario: The conversation spans several days
- **WHEN** the transcript contains messages from more than one day
- **THEN** a separator marks each change of day

#### Scenario: An event entry is rendered
- **WHEN** the transcript contains an entry recording that a participant was added
- **THEN** it is shown in the reader's language and is not styled as a reply

### Requirement: The composer accepts plain text only
The composer SHALL accept multi-line plain text, grow with its content up to a bounded height
and then scroll, send on Enter and insert a line break on Shift+Enter. It SHALL refuse to send
an empty or whitespace-only message, SHALL clear itself once a send is accepted by the client,
and SHALL offer no attachments, emoji picker or formatting controls in this slice.

#### Scenario: The user types a multi-line message
- **WHEN** the user inserts line breaks with Shift+Enter
- **THEN** the composer grows to fit the text up to its maximum height and then scrolls

#### Scenario: The user presses Enter
- **WHEN** the composer holds a non-empty message and the user presses Enter
- **THEN** the message is sent and the composer is cleared

#### Scenario: The composer is empty
- **WHEN** the composer is empty or holds only whitespace
- **THEN** sending is unavailable

### Requirement: The area shows explicit loading, empty and error states
Each surface of the Chat area — the conversation list and the transcript — SHALL show a
loading state while its data is being fetched, an explanatory empty state when there is
nothing to show, and a recoverable error state when the request fails. None of them SHALL
render as a blank region.

#### Scenario: The conversation list is loading
- **WHEN** the user enters the Chat area and the list has not arrived
- **THEN** a loading placeholder is shown in the list column

#### Scenario: A user takes part in no conversations
- **WHEN** the list returns no conversations
- **THEN** an explanatory empty state is shown instead of an empty column

#### Scenario: A request fails
- **WHEN** the conversation list or a transcript page fails to load
- **THEN** the failure is shown in place with a way to retry, and the rest of the area stays
  usable
