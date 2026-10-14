# chat/outreach Specification

## Purpose
Defines how an agent starts a conversation with a phone number that has not written to the tenant.

## Requirements

### Requirement: An agent can start a conversation from a phone number
A user of the tenant SHALL be able to start a customer conversation by choosing an enabled channel and
entering a phone number, optionally with a name. The system SHALL normalise the number, create the
contact and its address when they do not exist, create an open customer conversation with no messages,
and return it. When the contact already has an open conversation on that channel the system SHALL return
that one instead of creating a second. The number SHALL be validated; an invalid one SHALL be refused
with a field error.

#### Scenario: A new number
- **WHEN** an agent starts a conversation with a number the tenant has never seen
- **THEN** a contact and an empty open conversation are created and returned

#### Scenario: A number with an open conversation
- **WHEN** an agent starts a conversation with a number that already has an open conversation on that channel
- **THEN** the existing conversation is returned and nothing is created

#### Scenario: A number whose conversation is resolved
- **WHEN** the contact's only conversation on that channel is resolved
- **THEN** a new open conversation is created for the same contact

#### Scenario: An invalid number
- **WHEN** the number cannot be parsed
- **THEN** the system answers with a field error and creates nothing

#### Scenario: A disabled or foreign channel
- **WHEN** the chosen channel is disabled, missing, or belongs to another tenant
- **THEN** the system refuses and creates nothing

### Requirement: A started conversation links to a customer when the number matches exactly one
The same rule as for an inbound contact SHALL apply: when exactly one customer of the tenant owns the
number, the new contact SHALL be linked to that customer; otherwise it SHALL be left unlinked. A
customer SHALL NOT be created automatically.

#### Scenario: A number owned by one customer
- **WHEN** an agent starts a conversation with the phone number of exactly one customer
- **THEN** the contact is linked to that customer

#### Scenario: A number shared by two customers
- **WHEN** two customers have the number
- **THEN** the contact is left unlinked

### Requirement: The first message of a started conversation can be a template
A user SHALL be able to send an approved template by name and language into a customer conversation at
any time, including when the conversation has no inbound message or the freeform window is closed. A
template send SHALL be queued, ordered and delivered like any reply, SHALL claim an unassigned
conversation for its author, and SHALL be shown in the transcript as a template with its name and
language.

#### Scenario: A template into a new conversation
- **WHEN** an agent sends a template into a conversation the customer has never written to
- **THEN** the message is queued and the conversation is assigned to the agent

#### Scenario: A template while the window is closed
- **WHEN** the freeform window is closed and the agent sends a template
- **THEN** the template is accepted and queued

#### Scenario: A text before any template
- **WHEN** an agent sends text into a started conversation on a provider-enforced channel
- **THEN** the system queues it and the provider's answer decides, as the window state is unknown
