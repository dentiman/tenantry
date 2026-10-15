# chat/whatsapp-inbound Specification

## Purpose
TBD - created by archiving change chat-3b2-meta-inbound-receipts. Update Purpose after archive.

## Requirements

### Requirement: An inbound WhatsApp text becomes a customer message
A Meta webhook message of type `text` SHALL be turned into an inbound customer message on the channel named by
`metadata.phone_number_id`: the sender's phone number is the contact address, the profile name (from
`contacts[].profile.name`) is the contact's display name when the contact has none, the provider time is the
message time and the provider message id is the de-duplication key. A second delivery of the same message id
SHALL NOT create a second message. The customer's last-message time SHALL be set, so the 24-hour reply window
opens from it.

#### Scenario: A first text from a new number
- **WHEN** a signed webhook carries a text from a number the channel has never seen
- **THEN** a contact, an open conversation and one inbound message with that text exist, and the conversation can be replied to

#### Scenario: Redelivery
- **WHEN** Meta delivers the same message id again, in the same or a different webhook
- **THEN** no second message is stored

### Requirement: Every other inbound type leaves a placeholder, never a hole
A Meta webhook message of any type other than `text` — including types the system does not know — SHALL be
stored as an inbound message whose body is the language-neutral placeholder `[<type>]` and whose payload names
the provider type. The transcript SHALL render it as an unsupported message naming the type. Nothing is
downloaded and no reaction is applied.

#### Scenario: An image
- **WHEN** a webhook carries an inbound image
- **THEN** one message with body `[image]` and the payload type `image` is stored, and the conversation preview shows `[image]`

#### Scenario: An unknown type
- **WHEN** a webhook carries a message type this version does not recognise
- **THEN** a placeholder message is stored for it

### Requirement: Other webhook fields are stored and ignored
A change whose field is not `messages` (template status, account updates, …) SHALL be kept as received and
produce no conversation, message or channel change.

#### Scenario: A template status update
- **WHEN** a webhook carries `message_template_status_update`
- **THEN** it is stored and nothing else changes

### Requirement: Provider identifiers beyond the phone number are kept
Where Meta sends a business-scoped user id (`user_id`, `from_user_id`), the system SHALL keep it in the stored
message's provider metadata. It SHALL NOT merge or create contacts from it in this slice.

#### Scenario: BSUID present
- **WHEN** a text arrives with `from_user_id`
- **THEN** the stored message's provider metadata contains it and the contact is resolved by the phone number as before

### Requirement: An inbound reaction is stored with its emoji and does not open the reply window
A Meta webhook message of type `reaction` SHALL be stored as an inbound message whose payload carries the emoji
(or no emoji, when the customer removed the reaction) and whose body is the placeholder `[reaction]`. The
transcript SHALL render it as "Reacted <emoji>" or "Removed a reaction". Unlike any other inbound message, it
SHALL NOT set or extend the customer's last-message time, so the 24-hour reply window is not opened by it.

#### Scenario: A reaction with an emoji
- **WHEN** a webhook carries a reaction with the emoji 👍
- **THEN** one inbound message is stored with that emoji and the transcript shows "Reacted 👍"

#### Scenario: A removed reaction
- **WHEN** a webhook carries a reaction without an emoji
- **THEN** the transcript shows "Removed a reaction"

#### Scenario: A reaction does not open the window
- **WHEN** a conversation has no earlier inbound message and the customer sends a reaction
- **THEN** the customer's last-message time stays empty
