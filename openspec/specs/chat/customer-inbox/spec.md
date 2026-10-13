# chat/customer-inbox Specification

## Purpose
Defines customer conversations: who sees them, how an inbound message finds or opens one, how they
are filtered, how a contact is linked to a customer, and how a developer receives messages without
a provider.

## Requirements

### Requirement: Every active user of the tenant can see a customer conversation
A conversation created from a channel (kind customer) SHALL be readable by every active user of
the tenant that owns it, whether or not that user takes part in it. It SHALL NOT be readable by a
user of another tenant, and a request from one SHALL be answered as if the conversation did not
exist. Internal conversations SHALL keep their participant-only rule.

#### Scenario: Any user opens a customer conversation
- **WHEN** an active user who is not a participant requests a customer conversation of their tenant
- **THEN** the conversation and its transcript are returned

#### Scenario: A user of another tenant
- **WHEN** a user of a different tenant requests it
- **THEN** the system answers not found

#### Scenario: An internal conversation is unaffected
- **WHEN** a non-participant requests an internal conversation of the same tenant
- **THEN** the system answers not found, as before

#### Scenario: A deactivated user
- **WHEN** a deactivated user requests a customer conversation
- **THEN** the request is refused as for any inactive user

### Requirement: An inbound message goes to the contact's open conversation or opens one
For a contact the system SHALL keep at most one open conversation. An inbound message SHALL be
added to it. When the contact has no open conversation, an inbound message SHALL open one. A
resolved conversation SHALL be reopened by an inbound message arriving within the reopen window
after its last message, and a new conversation SHALL be opened after that. The reopen window SHALL
default to 24 hours and be configurable per channel.

#### Scenario: A message while a conversation is open
- **WHEN** a contact with an open conversation sends a message
- **THEN** it is added to that conversation and no other is created

#### Scenario: A message soon after resolution
- **WHEN** a contact writes within the window after their conversation was resolved
- **THEN** the same conversation is reopened and the message is added to it

#### Scenario: A message long after resolution
- **WHEN** a contact writes after the window has passed
- **THEN** a new conversation is opened

#### Scenario: Two messages at once
- **WHEN** two inbound messages from a contact with no open conversation are processed concurrently
- **THEN** exactly one conversation is opened and both messages are in it

### Requirement: The inbox can be filtered to mine, unassigned and all
The system SHALL list customer conversations, most recently active first and paginated by an opaque
cursor, with a filter: assigned to the requester, unassigned, or all. Each entry SHALL show the
channel, the contact's name, the linked customer when there is one, a preview, the time of the last
message and whether the last message is the customer's and still awaits a reply (personal unread
counts begin when a conversation is assigned, in a later change).

#### Scenario: Unassigned
- **WHEN** a user requests the unassigned filter
- **THEN** only customer conversations with no assignee are returned

#### Scenario: All
- **WHEN** a user requests all
- **THEN** every customer conversation of the tenant is returned, including those assigned to others

#### Scenario: A new inbound message moves a conversation up
- **WHEN** a message arrives in a conversation further down the list
- **THEN** on the next request it is first and its preview reflects the message

### Requirement: An open inbox learns that a customer wrote
When an inbound message is stored, every open client of the tenant SHALL be told which conversation
changed, without the message itself, so that it re-reads. A client that misses the notice SHALL see
the message on its next read, because the notice is not the source of truth.

#### Scenario: A customer writes while the inbox is open
- **WHEN** an inbound message is stored and a user has the inbox open
- **THEN** the user's inbox refreshes without a reload and shows the message in its place

#### Scenario: The notice is lost
- **WHEN** a client misses the notice
- **THEN** the message is still present on its next read of the inbox or the conversation

#### Scenario: Another tenant
- **WHEN** an inbound message is stored for one tenant
- **THEN** clients of other tenants receive no notice

### Requirement: An agent can link a contact to a customer or create one from it
A user SHALL be able to link an unlinked contact to an existing customer of the tenant, and to
create a customer from the contact's name and phone and link it. A contact SHALL link to at most one
customer. A user SHALL NOT link a contact to a customer of another tenant. The link SHALL show on the
contact's conversations.

#### Scenario: Linking
- **WHEN** a user links an unlinked contact to a customer
- **THEN** the contact's conversations show that customer

#### Scenario: Creating a customer from the conversation
- **WHEN** a user creates a customer from an unlinked contact
- **THEN** a customer exists with the contact's name and phone and the contact is linked to it

#### Scenario: Already linked
- **WHEN** a user tries to link a contact that is already linked
- **THEN** the system refuses it unless the existing link is removed first

### Requirement: Messages can be received in development without a provider
In an environment where development tooling is enabled, a user SHALL be able to cause an inbound
message to be received on the fake channel, from a chosen sender, through the same signed webhook
path a provider would use. The facility SHALL NOT exist elsewhere.

#### Scenario: Simulating a message
- **WHEN** a developer simulates a message from a new sender
- **THEN** a contact and a customer conversation appear in the inbox as for a real delivery

#### Scenario: Simulating the same message twice
- **WHEN** the same simulated provider message is sent twice
- **THEN** only one message appears

#### Scenario: Production
- **WHEN** the facility is requested where development tooling is disabled
- **THEN** the system answers as if it did not exist
