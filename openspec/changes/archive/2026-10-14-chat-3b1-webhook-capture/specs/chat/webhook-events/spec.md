## ADDED Requirements

### Requirement: An administrator can read the captured webhooks of an account
A tenant administrator SHALL be able to list the stored webhook events of one account, newest first, with
their id, receive time, state, error, signature result, the stored headers and the raw body, paged by a
cursor. Events of other accounts and other tenants SHALL NOT be reachable.

#### Scenario: List
- **WHEN** an administrator lists the events of an account that has received webhooks
- **THEN** they come newest first with headers, raw body and signature result

#### Scenario: Another tenant's account
- **WHEN** the account belongs to another tenant
- **THEN** the answer is 404

#### Scenario: Not an administrator
- **WHEN** a user who is not an administrator lists events
- **THEN** the answer is 403
