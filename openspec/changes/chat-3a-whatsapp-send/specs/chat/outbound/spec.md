# chat/outbound Specification

## MODIFIED Requirements

### Requirement: Freeform replies are limited to the provider's window
When the provider restricts freeform messages to a period after the customer's last message, the
system SHALL refuse a freeform reply once that period has passed, measured from the provider's
timestamp of the customer's last message, with a distinct error code that the client can explain.
When the customer has never written and the provider's window is enforced by the system, the reply
SHALL be refused the same way. When the customer has never written and the provider enforces the
window itself, the system SHALL NOT refuse the reply: it SHALL queue it and let the provider's answer
decide, and a provider's window-closed answer SHALL fail the message with the window-closed class.
Once the customer's last message is known, the local rule applies for every provider. The system SHALL
check the window again in the worker immediately before sending a freeform reply under the same rule.
A template message SHALL be exempt from the window.

#### Scenario: Inside the window
- **WHEN** the customer wrote 23 hours ago and an agent replies
- **THEN** the reply is accepted

#### Scenario: Outside the window
- **WHEN** the customer wrote 25 hours ago and an agent replies
- **THEN** the system answers unprocessable with the window-closed error code and stores nothing

#### Scenario: The window closes while the message waits
- **WHEN** a reply accepted inside the window is picked up by the worker after the window ended
- **THEN** it is not sent and is marked failed with the window-closed class

#### Scenario: A provider without a window
- **WHEN** the channel's provider declares no freeform window
- **THEN** a reply is never refused for that reason

#### Scenario: A provider-enforced window and no known inbound message
- **WHEN** the customer has never written on a channel whose provider enforces the window, and an agent replies with text
- **THEN** the reply is accepted and queued, and the provider decides

#### Scenario: The provider says the window is closed
- **WHEN** the provider rejects such a reply as outside the window
- **THEN** the message fails with the window-closed class and the agent can send a template

#### Scenario: A template outside the window
- **WHEN** the freeform window is closed or unknown and an agent sends a template
- **THEN** the template is accepted
