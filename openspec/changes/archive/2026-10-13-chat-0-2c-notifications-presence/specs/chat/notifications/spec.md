# Spec Delta

## Purpose

Defines how people who are not looking at a conversation learn that someone wrote to it: who is
notified and who is not, how the notifications collapse, how reading clears them, and the
guarantee that notifying never affects sending.

## ADDED Requirements

### Requirement: A participant who is not looking at a conversation is notified of a new message
When a text message is posted to a conversation, every active participant other than its author
SHALL receive an in-app notification of it, except those who are viewing that conversation at the
moment it is posted. The notification SHALL identify the author and the conversation, SHALL carry
a short preview of the message, and SHALL open the conversation when followed. A participant who
has left the conversation SHALL NOT be notified, and the author SHALL NOT be notified of their own
message.

#### Scenario: A colleague posts while the user is elsewhere
- **WHEN** a participant posts a message and another participant has the application open on a
  different screen
- **THEN** the other participant receives a notification naming the author and the conversation,
  and following it opens the conversation

#### Scenario: A colleague posts while the user is offline
- **WHEN** a participant posts a message and another participant is not connected
- **THEN** the other participant finds the notification in the inbox the next time they open it

#### Scenario: The author is not notified
- **WHEN** a participant posts a message
- **THEN** no notification is recorded for the author, including for the author's other tabs and
  devices

#### Scenario: A former participant is not notified
- **WHEN** a message is posted to a conversation that a user has left
- **THEN** that user receives no notification

#### Scenario: Only text messages notify
- **WHEN** an event entry, such as a participant being added, is recorded in a conversation
- **THEN** no notification is recorded for it

### Requirement: Someone who is viewing the conversation is not notified of it
A participant who has the conversation open — announced as viewing it on at least one of their
connections — at the moment a message is posted SHALL NOT receive a notification of that message.
The decision SHALL be made for the moment of posting: a participant who starts viewing afterwards
does not retroactively lose a notification already recorded, and one who stops viewing does not
retroactively gain one. If it cannot be determined who is viewing, participants SHALL be notified
rather than left unnotified.

#### Scenario: The user is reading the conversation
- **WHEN** a participant posts a message and another participant has that conversation open
- **THEN** the other participant is not notified

#### Scenario: The user has two tabs, one on the conversation
- **WHEN** a participant has the conversation open in one tab and a different screen in another,
  and a colleague posts a message
- **THEN** the participant is not notified

#### Scenario: The user is viewing a different conversation
- **WHEN** a participant has one conversation open and a colleague posts to another conversation
  they take part in
- **THEN** the participant is notified of the message in the other conversation

#### Scenario: Who is viewing cannot be determined
- **WHEN** a message is posted and the system cannot tell who has the conversation open
- **THEN** every other active participant is notified

### Requirement: Notifications of a conversation collapse until they are read
While a participant has an unread notification for a conversation, further messages in that
conversation SHALL be added to the same notification rather than creating new ones: it SHALL show
how many messages it stands for and the latest author and preview. Once the participant has read
it, the next message SHALL create a new notification.

#### Scenario: Several messages arrive before the user looks
- **WHEN** three messages are posted to a conversation while a participant has not read its
  notification
- **THEN** the participant has one notification for that conversation that stands for three
  messages

#### Scenario: A message arrives after the notification was read
- **WHEN** a participant has read the notification of a conversation and a new message is posted
- **THEN** a new notification is recorded for that conversation

#### Scenario: Two conversations notify separately
- **WHEN** messages are posted to two different conversations
- **THEN** the participant has one notification per conversation

### Requirement: Chat notifications follow the user's notification preferences
Chat message notifications SHALL form their own category in the user's notification preferences,
enabled by default, and a user who has switched them off SHALL receive none of them. The setting
SHALL apply to that user only.

#### Scenario: The user has switched chat notifications off
- **WHEN** a user has disabled chat message notifications and a colleague posts to a conversation
  they take part in
- **THEN** the user receives no notification, while the conversation's unread count still grows

#### Scenario: A colleague has them off
- **WHEN** one participant has disabled chat notifications and another has not
- **THEN** only the second participant is notified

### Requirement: Reading a conversation clears its notification
When a participant's read position in a conversation moves forward, their unread notifications for
that conversation SHALL be marked read, and every open tab and device of that participant SHALL be
told so that the bell and the inbox update without a reload. A read report that does not move the
position SHALL leave the notifications as they are. Another participant's reading SHALL NOT affect
the notifications of anyone else.

#### Scenario: The user opens the conversation
- **WHEN** a participant with an unread notification for a conversation reads it to the end
- **THEN** that notification is marked read and the unread count of the bell drops, in every tab

#### Scenario: A stale read report
- **WHEN** a participant reports a read position older than the recorded one
- **THEN** their notifications are unchanged

#### Scenario: A colleague reads the conversation
- **WHEN** one participant reads a conversation
- **THEN** the other participants' notifications for it are unchanged

### Requirement: Notifying never affects sending
Sending a message SHALL NOT wait for notifications to be recorded, and a failure to record
notifications SHALL NOT fail, delay or undo the message. A message that was not stored SHALL
produce no notification. Recording notifications for one message SHALL happen at most once per
participant even if the work is delivered more than once, and a message in a conversation that no
longer exists SHALL be dropped without retrying.

#### Scenario: Notifications cannot be recorded
- **WHEN** recording notifications for a posted message fails
- **THEN** the message remains stored and delivered to the open conversations, and the work is
  retried without affecting anyone's ability to send

#### Scenario: A send is rejected
- **WHEN** a message is rejected or rolled back
- **THEN** no notification is recorded for it

#### Scenario: The work is delivered twice
- **WHEN** the notification work for one message is delivered twice
- **THEN** each participant is notified once

#### Scenario: The conversation is gone by the time the work runs
- **WHEN** the conversation no longer exists when notifications are about to be recorded
- **THEN** nothing is recorded and the work is not retried
