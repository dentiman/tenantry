# chat/whatsapp-receipts Specification

## Purpose
TBD - created by archiving change chat-3b2-meta-inbound-receipts. Update Purpose after archive.

## Requirements

### Requirement: A Meta status updates the delivery state of our message
A Meta webhook status of `sent`, `delivered`, `read` or `failed` SHALL update the outbound message it refers
to, found by the provider message id or, when the id has not yet been recorded on our side, by our message id
returned in `biz_opaque_callback_data` (the status is then parked until the id is written). State only moves
forward: a late `sent` SHALL NOT overwrite `delivered` or `read`. The provider's status time SHALL be the time
shown.

#### Scenario: Delivered
- **WHEN** a signed webhook reports `delivered` for a message we sent
- **THEN** the message is delivered and its delivery time is the provider's

#### Scenario: A status that beats the id
- **WHEN** a status arrives before our message has its provider id, carrying our message id
- **THEN** it is parked and applied as soon as the id is recorded

#### Scenario: Out of order
- **WHEN** `delivered` is applied and a `sent` for the same message arrives afterwards
- **THEN** the message stays delivered

### Requirement: A failed status says why
A `failed` status SHALL mark the message failed with the provider code, a classified failure class from the
existing set (an unknown code is permanent), a title and the provider's `error_data.details` when present. It
SHALL NOT retry.

#### Scenario: Not delivered to maintain engagement
- **WHEN** a status fails with code 131049
- **THEN** the message is failed with class policy, that code, and the provider's details

### Requirement: Receipts are available for a subscribed Meta number
The `deliveryReceipts` flag of a Meta channel SHALL be true exactly while the number is recorded as subscribed
to this system, and false otherwise, so the composer and bubble stop saying that ticks are not tracked only when
they can in fact arrive.

#### Scenario: Subscribed
- **WHEN** a number is subscribed
- **THEN** its channel and its conversations report receipts available

#### Scenario: Unsubscribed
- **WHEN** the subscription is cleared
- **THEN** receipts are reported unavailable again
