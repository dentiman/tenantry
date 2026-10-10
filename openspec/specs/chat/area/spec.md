# chat/area Specification

## Purpose

Defines the Chat area as a screen in the tenant application: how conversations are listed and
opened, how a message behaves between being sent and being confirmed, and how the screen stays
current as conversations move on.

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

### Requirement: The Chat area stays current without a reload
The Chat area SHALL show changes made elsewhere as they happen: another participant's message
SHALL appear in the open transcript, the conversation list SHALL reflect new previews, ordering,
unread indicators and newly created conversations, and reading a conversation in one tab SHALL
clear its unread indicator in the user's other tabs — all without a reload, a focus change or a
manual refresh action. The area SHALL NOT poll on a timer. When the live channel is unavailable,
the area SHALL still converge to the stored state when the window regains focus or the
connection is restored, and SHALL NOT show the same message twice.

#### Scenario: A colleague posts into the open conversation
- **WHEN** another participant posts a message while the user has that conversation open and
  scrolled to the end
- **THEN** the message appears at the end of the transcript without any action by the user, and
  the conversation is not left marked as unread

#### Scenario: A colleague posts into another conversation
- **WHEN** another participant posts into a conversation that is not open
- **THEN** the conversation list moves it to the top with the new preview and an increased
  unread indicator

#### Scenario: The user sends a message
- **WHEN** the user sends a message and its confirmation and its live notice both arrive
- **THEN** the transcript contains exactly one entry for it, and the conversation list reflects
  the new preview and ordering

#### Scenario: The live channel is unavailable
- **WHEN** the live connection is down and the user sends a message
- **THEN** the message is still confirmed in the transcript, and messages from others appear
  once the window regains focus or the connection returns

#### Scenario: The window is left open and untouched
- **WHEN** the window stays focused and nothing changes in the user's conversations
- **THEN** the client issues no repeated background requests for chat

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

### Requirement: The open conversation announces itself and keeps doing so
While a conversation is open in the Chat area, the client SHALL announce that the user is viewing
it, and SHALL withdraw the announcement when the conversation is closed, the user navigates to
another conversation or leaves the area. After a lost connection that the live channel did not
resume, the client SHALL announce the open conversation again without any action by the user.
A refused or failed announcement SHALL NOT break the screen: messages and the conversation list
SHALL keep updating, and only the typing indications of others are lost.

#### Scenario: A conversation is opened
- **WHEN** the user opens a conversation
- **THEN** the client announces it, and colleagues viewing it can see this user's typing

#### Scenario: The user switches conversation
- **WHEN** the user moves from one conversation to another
- **THEN** the first announcement is withdrawn and the second is made

#### Scenario: The connection is lost and comes back
- **WHEN** the live connection drops and is re-established without resuming the session
- **THEN** the open conversation is announced again and typing indications work again

#### Scenario: The announcement is refused
- **WHEN** the server refuses the announcement for the open conversation
- **THEN** the transcript and the list still update live and the screen shows no error for it

### Requirement: Others typing are shown in the open conversation
The open conversation SHALL show who else is typing, naming the person when one is typing and
summarising when several are, and SHALL NOT show the user's own typing from their other tabs. An
indication SHALL disappear when it lapses, and SHALL disappear at once when a message from that
person arrives. While the user is typing, the client SHALL signal it, at most once per the
published interval, SHALL NOT signal for an empty input, and SHALL stop signalling once the
message is sent.

#### Scenario: A colleague is typing
- **WHEN** another participant types in the conversation the user is viewing
- **THEN** the screen shows that this colleague is typing

#### Scenario: Several people are typing
- **WHEN** more than one other participant is typing
- **THEN** the screen summarises them in one indication rather than stacking one per person

#### Scenario: The typist sends the message
- **WHEN** the person who was typing sends their message
- **THEN** their indication disappears at once and the message appears

#### Scenario: The indication is not renewed
- **WHEN** a colleague stops typing without sending
- **THEN** the indication disappears after it lapses

#### Scenario: The user's own other tab
- **WHEN** the user types in one tab while the same conversation is open in another tab
- **THEN** the other tab does not show that the user is typing

#### Scenario: Typing is signalled sparingly
- **WHEN** the user types continuously for several seconds
- **THEN** the client signals typing at most once per interval, and not at all while the input
  is empty

### Requirement: A conversation is marked read only while the user is looking at it
The Chat area SHALL report a conversation as read only while the window is visible and focused
and the newest message of the open conversation is on screen. A message that arrives while the
window is in the background, or while the user is scrolled away from the newest messages, SHALL
leave the conversation unread, with its unread indicator in the list, until the user returns to
the window or scrolls to the newest message, at which point it SHALL be reported read. Opening a
conversation whose newest message is on screen in a focused window SHALL report it read.

#### Scenario: A message arrives while the user is reading
- **WHEN** a colleague posts while the user has the conversation open, the window focused and the
  newest message on screen
- **THEN** the message is reported read and the conversation shows no unread indicator

#### Scenario: A message arrives while the window is in the background
- **WHEN** a colleague posts while the window is hidden or not focused
- **THEN** the conversation keeps its unread indicator in the list until the user returns

#### Scenario: The user returns to the window
- **WHEN** the user focuses the window again with the newest message on screen
- **THEN** the conversation is reported read and its unread indicator clears, in every open tab

#### Scenario: The user is scrolled up in the history
- **WHEN** a colleague posts while the user has scrolled away from the newest messages
- **THEN** the conversation stays unread until the user scrolls to the newest message

#### Scenario: A conversation with unread messages is opened
- **WHEN** the user opens a conversation with unread messages in a focused window
- **THEN** it is reported read once the newest message is on screen

### Requirement: An incoming message does not move a reader who has scrolled up
While the user is reading earlier messages, a message arriving from someone else SHALL NOT move
the reading position; it SHALL leave the conversation unread and make it possible to jump to the
newest message. A user who is at the newest message SHALL keep following new messages, and a
message the user sends themselves SHALL always be brought into view.

#### Scenario: A colleague posts while the user is reading history
- **WHEN** another participant posts while the user has scrolled up in the transcript
- **THEN** the visible part of the transcript does not move, the conversation stays unread, and
  the control for jumping to the newest message is available

#### Scenario: A colleague posts while the user is at the newest message
- **WHEN** another participant posts while the newest message is on screen
- **THEN** the new message is brought into view

#### Scenario: The user sends a message while scrolled up
- **WHEN** the user sends a message while reading earlier messages
- **THEN** the transcript moves to show that message

#### Scenario: A new message is placed at the bottom
- **WHEN** a message is added to the end of the transcript, whether sent by the user or by someone
  else while the user is at the newest message
- **THEN** it appears directly under the previous messages at the bottom of the visible
  transcript, with no blank space below it
