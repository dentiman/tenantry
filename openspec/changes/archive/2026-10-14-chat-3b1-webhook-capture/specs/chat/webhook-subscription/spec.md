## ADDED Requirements

### Requirement: The admin can see where a number's webhooks go
For a Meta channel, a tenant administrator SHALL be able to read, live from Meta, where that number's webhook
events are delivered: the host configured for the number itself, for its WhatsApp Business Account and for
the application, the effective destination, and whether it is this account's address. The answer SHALL carry
hosts only, never full foreign addresses.

#### Scenario: Events go to another host
- **WHEN** the number has no override and the account level points to another host
- **THEN** the state is "elsewhere" with that host named

#### Scenario: Events go to us
- **WHEN** the number's override equals this account's webhook address
- **THEN** the state is "ours"

### Requirement: Subscribing is an explicit action on one number
The system SHALL NOT subscribe anything when an account is connected, synchronised or a number enabled.
Pressing "Subscribe" on a number SHALL set that number's override to this account's webhook address together
with the account's verify token, then read it back and confirm it is ours. It SHALL fail with a clear reason
when no public base address is configured, when Meta cannot verify the address, or when Meta refuses the call.

#### Scenario: Subscribe
- **WHEN** an administrator subscribes a number whose events go nowhere or to the account level
- **THEN** the number's override is set to our address, read back as ours, and the subscription time is recorded

#### Scenario: Address not reachable
- **WHEN** Meta cannot complete the handshake with our address
- **THEN** the action fails with that reason and nothing is recorded as subscribed

### Requirement: Taking over a number named another host requires naming that host
When the number's events currently go to another host, subscribing SHALL be refused unless the request names
exactly that host as the one being replaced, so the administrator knowingly redirects another consumer's
events.

#### Scenario: Takeover without naming
- **WHEN** a subscribe request does not name the current foreign host
- **THEN** it is refused and Meta is not called to change anything

#### Scenario: Takeover with the right host
- **WHEN** the request names the current foreign host
- **THEN** the number is subscribed

### Requirement: Unsubscribing clears only our override
"Unsubscribe" SHALL clear this number's override, which returns its events to the level above, and SHALL
record that the number is no longer subscribed. It SHALL NOT touch any other level.

#### Scenario: Unsubscribe
- **WHEN** an administrator unsubscribes a subscribed number
- **THEN** the number's override is cleared and the state is read back

### Requirement: Subscription actions are administrator-only and leave receipts off
Reading and changing the subscription SHALL be allowed to tenant administrators only. A subscription SHALL
NOT make delivery receipts available: `deliveryReceipts` stays false until statuses are processed.

#### Scenario: A non-administrator
- **WHEN** a user who is not an administrator calls any of these routes
- **THEN** the answer is 403
