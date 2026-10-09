# Spec Delta

## Purpose

Defines how participants learn about changes to their conversations without asking: who is told,
when, what the notice carries, and how a client that missed notices returns to a correct state.
The stored conversation remains the source of truth; live notices only accelerate it.

## ADDED Requirements

### Requirement: Participants are told about a new message as soon as it is stored
When a message is added to a conversation's transcript — a reply or an event entry — every
active participant of that conversation SHALL receive a live notice of it, including the author
on their other open tabs and devices. The notice SHALL be sent only after the message is
durably stored; a send that fails or is rolled back SHALL produce no notice. A replayed send
that returns an already stored message SHALL NOT produce a second notice.

#### Scenario: A colleague posts a reply
- **WHEN** a participant posts a message while another participant has the application open
- **THEN** the other participant receives a notice of that message without reloading or
  refocusing the window

#### Scenario: The author has two tabs open
- **WHEN** a participant posts from one tab
- **THEN** their other tab receives the same notice and shows the message

#### Scenario: Storing the message fails
- **WHEN** a send is rejected or its storage is rolled back
- **THEN** no participant receives a notice for it

#### Scenario: A send is retried with the same client identifier
- **WHEN** a send is repeated with a client identifier that already produced a stored message
- **THEN** the stored message is returned and no further notice is sent

### Requirement: Live notices never reach anyone who could not read the conversation
A notice about a conversation SHALL be delivered only to users who, at the moment the change was
stored, were active participants of it — the same set the conversation's read access admits. A
user of the same tenant who does not take part SHALL NOT receive it, and a user of another tenant
SHALL NOT receive it under any circumstances.

#### Scenario: A non-participant of the same tenant is connected
- **WHEN** a message is posted to a conversation the connected user does not take part in
- **THEN** that user receives no notice of it

#### Scenario: Users of another tenant are connected
- **WHEN** a message is posted in one tenant
- **THEN** no user of any other tenant receives a notice of it

### Requirement: A message notice carries the stored message and its position
A notice of a new message SHALL carry the conversation it belongs to and the message exactly as
the transcript would return it — including its sequence number and, for the author, the client
identifier it was sent with — so that a client can show it without a further request and can
tell whether it directly follows what it already holds.

#### Scenario: The notice matches the transcript
- **WHEN** a client compares a received message notice with the same message read from the
  transcript
- **THEN** both describe the message identically, including its sequence number

#### Scenario: The author's optimistic entry is settled by the notice
- **WHEN** the author's tab receives the notice of a message it is still showing as not yet
  confirmed
- **THEN** the client can match it by the client identifier and show a single, confirmed entry

### Requirement: A client that misses notices returns to the stored state
Live notices SHALL be treated as best effort: a lost, duplicated or reordered notice SHALL NOT
leave a client showing a wrong transcript. A client SHALL apply a message notice only if it
directly follows the newest message it holds, SHALL ignore a notice for a message it already
holds, and SHALL re-read the transcript from the server when a notice reveals a gap. After a
lost connection that could not be resumed, the client SHALL re-read its chat state.

#### Scenario: A notice arrives twice
- **WHEN** the same message notice is received twice
- **THEN** the transcript shows the message once

#### Scenario: A notice is missed
- **WHEN** a client holding messages up to position N receives a notice for position N+2
- **THEN** the client re-reads the transcript and shows N+1 and N+2 in order

#### Scenario: The connection drops and comes back
- **WHEN** the connection is lost while messages are posted and is then re-established without
  resuming the missed traffic
- **THEN** the client re-reads its conversations and any open transcript, and shows everything
  posted meanwhile

### Requirement: Changes to a user's conversation list are announced
A user SHALL receive a live notice when a conversation they take part in is created, when they
or others are added to one, and when their own read position in one moves (including from
another tab or device). The notice SHALL identify the conversation and the kind of change and
SHALL NOT carry other users' read positions or unread counts.

#### Scenario: A user is added to a new conversation
- **WHEN** a colleague creates a conversation that includes the user
- **THEN** the user receives a notice and the conversation appears in their list without a reload

#### Scenario: A new colleague joins the default channel
- **WHEN** a new user is created in the tenant and joins the default channel
- **THEN** the existing members of that channel receive a notice of the change

#### Scenario: The user reads a conversation on another device
- **WHEN** the user reads a conversation to the end on one device
- **THEN** their other open tabs and devices receive a notice and stop showing it as unread

#### Scenario: Another participant reads the conversation
- **WHEN** a different participant moves their own read position
- **THEN** the user receives no notice about it
