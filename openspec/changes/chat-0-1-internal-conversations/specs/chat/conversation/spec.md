# Spec Delta

## Purpose

Defines an internal conversation in the tenant workspace: who takes part in it, who is allowed
to see it, how one is created, how the tenant's default channel is populated, and what the
list of a user's conversations shows.

## ADDED Requirements

### Requirement: Participation is the only way to see a conversation
A conversation SHALL be readable and writable only by its current participants. Belonging to
the same tenant SHALL NOT be sufficient, and no role SHALL grant access to a conversation the
holder does not take part in. A request from a user who is not a current participant SHALL be
answered as if the conversation did not exist, so that the response cannot be used to probe
which conversations exist.

#### Scenario: A user who is not a participant requests a conversation
- **WHEN** a user of the tenant requests a conversation they do not take part in
- **THEN** the system answers not found, and neither the transcript nor the participant list
  is disclosed

#### Scenario: A tenant administrator requests someone else's conversation
- **WHEN** a user with the administrator role requests a conversation they do not take part in
- **THEN** the response is the same as for any other non-participant

#### Scenario: A user of another tenant requests the conversation
- **WHEN** a user of a different tenant requests the conversation by its identifier
- **THEN** the system answers not found

### Requirement: A conversation is created with an explicit list of participants
A user SHALL be able to create a conversation by naming the other users who take part in it,
optionally with a title. The creator SHALL always become a participant. Every named user MUST
belong to the same tenant; a request naming a user outside the tenant, or naming an unknown
user, SHALL be rejected with a validation error identifying the offending field. A
conversation with exactly two participants SHALL be an ordinary conversation, not a distinct
kind of object.

#### Scenario: A user creates a conversation with two colleagues
- **WHEN** a user creates a conversation naming two other users of the tenant
- **THEN** the conversation has three participants, including the creator

#### Scenario: A user creates a one-to-one conversation
- **WHEN** a user creates a conversation naming a single colleague
- **THEN** the result is a conversation with two participants, addressable and readable by the
  same means as any other conversation

#### Scenario: The request names a user outside the tenant
- **WHEN** a create request names a user that does not belong to the caller's tenant
- **THEN** the system rejects it with a validation error on the participants field and creates
  nothing

#### Scenario: No request can make a conversation visible tenant-wide
- **WHEN** a user creates a conversation by any available means
- **THEN** the conversation is accessible to its participants only, and the system exposes no
  way to create a conversation that the whole tenant can read

### Requirement: Every tenant has a default channel containing all of its users
Each tenant SHALL have one default conversation that all of its users take part in. A user
created after the default channel exists SHALL become a participant as part of being created,
and SHALL NOT be created at all if that fails. The default channel SHALL behave like any other
conversation once opened.

#### Scenario: A freshly provisioned tenant
- **WHEN** a tenant and its first users are provisioned
- **THEN** a default channel exists and every one of those users is a participant

#### Scenario: An administrator adds a new user
- **WHEN** an administrator creates a user
- **THEN** that user takes part in the default channel from their first sign-in, and the
  conversation records that they joined

#### Scenario: Provisioning runs twice
- **WHEN** tenant provisioning runs again over an existing tenant
- **THEN** no second default channel appears and existing membership is unchanged

### Requirement: A user can list the conversations they take part in
The system SHALL return the conversations the requesting user currently takes part in, most
recently active first, each carrying its title, a preview of the most recent message, the time
of that message, and the requester's own unread count. The list SHALL be paginated by an
opaque cursor, and SHALL NOT include conversations the requester does not take part in.

#### Scenario: A user opens the chat area
- **WHEN** a user requests their conversations
- **THEN** the conversations they take part in are returned, most recently active first, each
  with a preview of its latest message

#### Scenario: A message arrives in one of them
- **WHEN** a new message is posted to a conversation further down the list
- **THEN** on the next request that conversation is first, and its preview and time reflect
  the new message

#### Scenario: More conversations exist than fit one page
- **WHEN** the user requests the next page with the cursor returned by the previous one
- **THEN** the following conversations are returned with no repeats and no omissions, and the
  cursor is empty once the list is exhausted

### Requirement: A conversation identifies its participants
Reading a single conversation SHALL return its participants with enough identity to label
messages and show who is present — at minimum each participant's identifier, display name and
email. Users who have left SHALL NOT be listed as current participants.

#### Scenario: Opening a conversation
- **WHEN** a participant reads the conversation
- **THEN** the response carries the conversation and its current participants

#### Scenario: A former participant
- **WHEN** a user who has left the conversation is read back
- **THEN** they are absent from the current participant list, while messages they wrote remain
  in the transcript
