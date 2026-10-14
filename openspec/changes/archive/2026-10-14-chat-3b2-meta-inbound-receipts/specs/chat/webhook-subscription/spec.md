## RENAMED Requirements

- FROM: `### Requirement: Subscription actions are administrator-only and leave receipts off`
- TO: `### Requirement: Subscription actions are administrator-only and drive receipts`

## MODIFIED Requirements

### Requirement: Subscription actions are administrator-only and drive receipts
Reading and changing the subscription SHALL be allowed to tenant administrators only. A recorded subscription
SHALL make delivery receipts available for that channel; clearing it SHALL make them unavailable again.

#### Scenario: A non-administrator
- **WHEN** a user who is not an administrator calls any of these routes
- **THEN** the answer is 403

#### Scenario: Receipts follow the subscription
- **WHEN** an administrator subscribes a number
- **THEN** the channel's `deliveryReceipts` becomes true, and false again after unsubscribing
