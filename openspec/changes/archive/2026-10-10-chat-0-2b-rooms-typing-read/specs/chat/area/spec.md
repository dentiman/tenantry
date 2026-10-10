# Spec Delta

## ADDED Requirements

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

