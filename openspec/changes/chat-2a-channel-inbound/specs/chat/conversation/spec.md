# chat/conversation Specification

## MODIFIED Requirements

### Requirement: Participation is the only way to see a conversation
An internal conversation SHALL be readable and writable only by its current participants. Belonging
to the same tenant SHALL NOT be sufficient, and no role SHALL grant access to an internal
conversation the holder does not take part in. A request from a user who is not a current
participant SHALL be answered as if the conversation did not exist, so that the response cannot be
used to probe which conversations exist. Customer conversations, which arrive from a channel,
follow `chat/customer-inbox` instead and are readable by every active user of the tenant.

#### Scenario: A user who is not a participant requests a conversation
- **WHEN** a user of the tenant requests an internal conversation they do not take part in
- **THEN** the system answers not found, and neither the transcript nor the participant list
  is disclosed

#### Scenario: A tenant administrator requests someone else's conversation
- **WHEN** a user with the administrator role requests an internal conversation they do not take
  part in
- **THEN** the response is the same as for any other non-participant

#### Scenario: A user of another tenant requests the conversation
- **WHEN** a user of a different tenant requests the conversation by its identifier
- **THEN** the system answers not found

#### Scenario: A customer conversation is requested by a non-participant
- **WHEN** an active user of the tenant requests a customer conversation they do not take part in
- **THEN** the conversation is returned, because customer conversations are visible to the tenant
