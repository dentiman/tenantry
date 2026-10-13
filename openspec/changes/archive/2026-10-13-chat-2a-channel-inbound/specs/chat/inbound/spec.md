# chat/inbound Specification

## Purpose

Defines how messages from a provider enter the system: the public webhook, its acknowledgement
rules, exactly-once ingest, and who the person on the other end is.

## ADDED Requirements

### Requirement: The webhook answers the provider's verification handshake
The system SHALL answer a verification request addressed to a channel account's webhook address by
returning the provider's challenge value when the supplied verify token equals the account's own
verify token, and SHALL refuse it otherwise. The verify token SHALL be per account, not a global
secret.

#### Scenario: A correct handshake
- **WHEN** the provider sends a verification request with the account's verify token and a challenge
- **THEN** the challenge is returned unchanged

#### Scenario: A wrong or unknown token
- **WHEN** the verify token does not match, or the webhook key is unknown
- **THEN** the request is refused and no challenge is returned

### Requirement: A delivery is accepted only with a valid signature over the raw bytes
For a delivery to a known account the system SHALL verify the provider's signature over the exact
bytes received, using the account's secret. A delivery with a missing or invalid signature SHALL be
rejected with an authentication error and SHALL write nothing.

#### Scenario: A valid signature
- **WHEN** a delivery arrives whose signature matches the bytes received
- **THEN** it is accepted

#### Scenario: An altered body
- **WHEN** one byte of an otherwise valid body is changed
- **THEN** the delivery is rejected and nothing is stored

#### Scenario: Equivalent JSON, different bytes
- **WHEN** a body is re-serialised (different whitespace or key order) but signed over the original
- **THEN** it is rejected, because the signature covers the bytes, not the meaning

### Requirement: A verified delivery is stored first and acknowledged only then
For a delivery that passed verification the system SHALL store the raw body and queue its processing
in one transaction, and SHALL acknowledge with success only after that transaction commits. A
delivery that cannot be parsed SHALL still be acknowledged and stored in a failed state, so that the
provider does not retry it indefinitely. Processing SHALL NOT happen inside the request.

#### Scenario: A normal delivery
- **WHEN** a valid delivery arrives
- **THEN** the raw body is stored, processing is queued, and the provider receives success

#### Scenario: Storage fails
- **WHEN** the transaction cannot commit
- **THEN** the provider receives an error status and the delivery will be retried by the provider

#### Scenario: A signed but unparsable body
- **WHEN** a correctly signed delivery cannot be parsed
- **THEN** it is stored as failed, the provider receives success, and no message is created

#### Scenario: A byte-identical repeat
- **WHEN** the provider sends the same bytes again for the same channel
- **THEN** it is not stored a second time

### Requirement: Deliveries that cannot be routed are acknowledged and recorded
For an unknown webhook key, an account that is disabled, or a delivery naming a channel that does
not exist, is disabled, or belongs to another account, the system SHALL answer success, SHALL create
no conversation or message, and SHALL record the occurrence with its reason. A record of an
unknown key SHALL carry no tenant and SHALL NOT retain the body.

#### Scenario: An unknown webhook key
- **WHEN** a delivery arrives for a key that matches no account
- **THEN** the provider receives success and an unroutable record is written without a tenant

#### Scenario: The response does not reveal which keys exist
- **WHEN** deliveries arrive for a real and an unknown key with invalid signatures
- **THEN** the responses do not let the sender tell which key exists beyond what the signature
  check itself implies

#### Scenario: A channel of another account
- **WHEN** a delivery names a channel that exists but belongs to a different account
- **THEN** it is recorded as unroutable and nothing is added to any conversation

### Requirement: The webhook is rate limited by key and by address
The system SHALL apply a named limit to the webhook that is generous enough for status traffic and
SHALL answer an over-limit request with a retry hint and without storing anything.

#### Scenario: A burst beyond the limit
- **WHEN** one address sends deliveries faster than the limit allows
- **THEN** the excess is refused with a retry hint and nothing from them is stored

### Requirement: An inbound message is stored exactly once
For a given channel, a provider message identifier SHALL produce at most one stored message however
many times, in whatever order and from whichever worker the delivery is processed. The first
processing SHALL create the message and later ones SHALL change nothing, including counters and
notices.

#### Scenario: Redelivery
- **WHEN** the same provider message arrives in two separate deliveries
- **THEN** exactly one message exists and the conversation's unread count counted it once

#### Scenario: Concurrent processing
- **WHEN** two workers process deliveries carrying the same provider message at the same time
- **THEN** exactly one message exists

### Requirement: Inbound messages keep the provider's time and the conversation's order
A stored inbound message SHALL record the provider's timestamp as the time the customer wrote, in
addition to the time it was stored. The conversation SHALL record the provider time of the most
recent inbound message from the customer. Messages SHALL be ordered within the conversation by the
server-assigned sequence number, not by the provider's timestamp.

#### Scenario: A delayed delivery
- **WHEN** a message written an hour ago is delivered now
- **THEN** it takes the next sequence number, and the conversation's last customer-message time is
  the provider's time, not the time of delivery

### Requirement: The person on the other end is a contact with addresses
Each channel SHALL keep contacts. A contact SHALL have a display name taken from the provider's
profile and one or more addresses, each with a kind (phone, or a provider user identifier) and a
value, unique within the channel. A message from an address that already belongs to a contact SHALL
use that contact; any other address SHALL create a new contact. Two contacts SHALL NOT be merged
automatically.

#### Scenario: A known address
- **WHEN** a message arrives from an address a contact already has
- **THEN** it is attributed to that contact and no contact is created

#### Scenario: A new address
- **WHEN** a message arrives from an address no contact has
- **THEN** a contact is created with that address and the profile name, with no customer attached

#### Scenario: A phone written in two formats
- **WHEN** the same number arrives once with a leading plus and once without
- **THEN** both resolve to one contact

### Requirement: A contact exists without a customer and links only when unambiguous
A new contact SHALL be linked to a customer automatically only when exactly one customer of the
tenant has that phone number. When no customer or more than one customer matches, the contact SHALL
stay unlinked. The system SHALL NOT create a customer from an inbound message.

#### Scenario: Exactly one customer has the number
- **WHEN** a message arrives from a number that exactly one customer has
- **THEN** the contact is linked to that customer

#### Scenario: Two customers have the number
- **WHEN** a message arrives from a number that two customers have
- **THEN** the contact stays unlinked

#### Scenario: Nobody has the number
- **WHEN** a message arrives from an unknown number
- **THEN** a contact exists with no customer and no customer is created
