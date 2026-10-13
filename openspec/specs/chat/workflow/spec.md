# chat/workflow Specification

## Purpose
Defines the working state of a customer conversation: its status, who handles it, internal notes,
and the records those actions leave behind.

## Requirements

### Requirement: A customer conversation has a status
A customer conversation SHALL be open, pending, or resolved. A user who can see it SHALL be able to
change the status to any of the three. Resolving SHALL record the time and reopening SHALL clear it.
An inbound message from the customer SHALL return a pending conversation to open. Changing a status
to the status it already has SHALL change nothing. Internal conversations SHALL NOT have this status
workflow.

#### Scenario: Resolve a conversation
- **WHEN** a user marks an open conversation resolved
- **THEN** its status is resolved, the resolution time is recorded, and it leaves the open inbox filters

#### Scenario: Pending becomes open on a reply from the customer
- **WHEN** a customer writes in a pending conversation
- **THEN** the conversation becomes open

#### Scenario: The same status again
- **WHEN** a user sets the status a conversation already has
- **THEN** nothing is written and no entry appears in the transcript

#### Scenario: An internal conversation
- **WHEN** a user tries to set a status on an internal conversation
- **THEN** the system refuses the request

### Requirement: A reply claims and reopens
A reply sent into an unassigned conversation SHALL assign the conversation to the replying user,
decided atomically so that two simultaneous first replies assign exactly one user. A reply sent into
a resolved conversation SHALL reopen it in the same transaction as the message. A reply to a pending
conversation SHALL leave it pending.

#### Scenario: First reply to an unassigned conversation
- **WHEN** a user replies to a conversation nobody is assigned to
- **THEN** the conversation is assigned to that user

#### Scenario: Two first replies at once
- **WHEN** two users reply to the same unassigned conversation at the same time
- **THEN** exactly one of them becomes the assignee and both messages are stored

#### Scenario: A reply to a resolved conversation
- **WHEN** a user replies to a resolved conversation inside the window
- **THEN** the conversation is open again and the message is queued

### Requirement: A conversation can be assigned
A user who can see a customer conversation SHALL be able to assign it to any active user of the
tenant or to nobody. Assigning to a deactivated user or to a user of another tenant SHALL be
refused. The assignee SHALL be considered to be taking part in the conversation: the conversation
counts unread messages for them, and appears under the "mine" filter. Assigning again to the same
user SHALL change nothing.

#### Scenario: Assign to a colleague
- **WHEN** a user assigns a conversation to an active colleague
- **THEN** the colleague is the assignee, the conversation is under their "mine" filter, and it counts inbound messages as unread for them

#### Scenario: Unassign
- **WHEN** a user removes the assignee
- **THEN** the conversation appears under "unassigned"

#### Scenario: Assign to someone who cannot be assigned
- **WHEN** a user assigns a conversation to a deactivated user
- **THEN** the system refuses with a validation error

#### Scenario: Assign to a user of another tenant
- **WHEN** the request names a user of another tenant
- **THEN** the system answers as if that user did not exist

### Requirement: Internal notes stay inside the team
A user SHALL be able to add an internal note to a customer conversation. A note SHALL appear in the
transcript to every user who can see the conversation, SHALL be clearly distinguished from a reply,
SHALL never be queued for delivery or sent to the provider, and SHALL NOT be subject to the
freeform window. A note SHALL NOT change the conversation's last-message time, its preview, or
whether it is waiting for a reply.

#### Scenario: A note outside the window
- **WHEN** a user adds a note after the window has closed
- **THEN** the note is stored and visible to colleagues

#### Scenario: A note is not delivered
- **WHEN** a note is added
- **THEN** no delivery is queued and the provider is not called

#### Scenario: A note does not reorder the inbox
- **WHEN** a note is added to an older conversation
- **THEN** its position in the inbox and its preview do not change

### Requirement: Workflow changes are recorded in the transcript and the activity log
A change of status, an assignment, an unassignment, and a reopening SHALL each write one system entry
into the conversation's transcript, in the transaction that made the change, naming the acting user
(or the customer for a reopening caused by an inbound message). They SHALL also be recorded as
activities linked to the conversation and, when the contact is linked to a customer, to that
customer. A change that is rolled back SHALL leave neither.

#### Scenario: Assignment is recorded
- **WHEN** a user assigns a conversation
- **THEN** one system entry names the actor and the assignee, and one activity is recorded on the conversation

#### Scenario: Activity on the customer
- **WHEN** a conversation of a linked contact is resolved
- **THEN** the customer's activity feed shows the resolution

#### Scenario: A failed change
- **WHEN** the transaction of a status change fails
- **THEN** no system entry and no activity remain

### Requirement: An assignee is notified of inbound messages
When an inbound message arrives in an assigned conversation, the assignee SHALL receive an in-app
notification that follows the existing notification rules: collapsed per conversation while unread,
suppressed while the assignee is viewing the conversation, and cleared when they read it. Messages
in an unassigned conversation SHALL appear in the inbox and the unassigned filter and SHALL NOT
notify individual users.

#### Scenario: Inbound message for an assigned conversation
- **WHEN** a customer writes in a conversation assigned to a user who is elsewhere
- **THEN** that user receives a notification naming the conversation

#### Scenario: Unassigned conversation
- **WHEN** a customer writes in an unassigned conversation
- **THEN** no user is notified individually and the conversation shows in the unassigned filter

#### Scenario: The assignee is looking
- **WHEN** the assignee has the conversation open as the message arrives
- **THEN** no notification is created
