# chat/whatsapp-send Specification

## Purpose
Defines what sending through a real WhatsApp number means in the slice without webhooks: the kinds
of message, what a successful response proves, and how provider errors are classified.

## Requirements

### Requirement: Text and approved templates can be sent
Through a WhatsApp channel the system SHALL send a plain text message, and SHALL send an approved
message template identified by its name and language. A template send SHALL carry no variables in
this slice; a template that requires variables SHALL fail as a permanent error with the provider's
reason shown. A text SHALL be limited to the length the provider accepts.

#### Scenario: Sending a text
- **WHEN** an agent replies with text on a WhatsApp channel and the provider accepts it
- **THEN** the message is marked sent and carries the provider's message identifier

#### Scenario: Sending a template
- **WHEN** an agent sends the template "hello_world" in "en_US"
- **THEN** the provider receives that template and the message is marked sent with its identifier

#### Scenario: A template that needs variables
- **WHEN** an agent sends a template whose body has placeholders
- **THEN** the message fails with the permanent class and the provider's reason

### Requirement: Acceptance by the provider is not delivery
A successful provider response SHALL mark the message sent and nothing further. The system SHALL NOT
mark a WhatsApp message delivered or read in this slice, because the provider reports those only by
webhook. The interface SHALL tell the user that delivery receipts are not available until the webhook
is connected, and a later failure that the provider reports only by webhook SHALL NOT be reflected.

#### Scenario: A sent message
- **WHEN** a message was accepted by the provider
- **THEN** it shows as sent and never advances, and the conversation explains that receipts need the webhook

#### Scenario: Our own response parsing
- **WHEN** the provider's success response has no status field (as for a text)
- **THEN** the message is still treated as accepted because a message identifier was returned

### Requirement: Provider errors are mapped to the delivery classes
The adapter SHALL translate each provider error into exactly one of the delivery classes (window
closed, permanent, policy, rate limited, authentication, transient, needs a human) from the provider's
error code, and SHALL keep the provider's code and a human-readable title on the failed message. An
unknown code on a client error SHALL be permanent; an unknown code on a server error, a network error or
a timeout SHALL be transient. The request for a recipient that is not on a test account's allowed list
SHALL be permanent with a title that says so.

#### Scenario: The window is closed
- **WHEN** the provider rejects a text because the customer's window is closed
- **THEN** the message fails with the window-closed class

#### Scenario: Authentication fails
- **WHEN** the provider rejects the token
- **THEN** the message fails with the authentication class and the account becomes "needs re-authentication"

#### Scenario: Rate limiting
- **WHEN** the provider reports a rate limit
- **THEN** the delivery is retried within the existing bound

#### Scenario: A recipient not allowed on a test account
- **WHEN** the provider refuses a recipient that is not on the allowed list
- **THEN** the message fails permanently with a title naming the allowed list

#### Scenario: An unknown server error
- **WHEN** the provider answers with an unmapped code on a server error
- **THEN** it is treated as transient

### Requirement: The recipient's own number is the only address used
A send SHALL be addressed to the contact's stored phone number in the provider's format (digits with
the country code, no plus sign). A message SHALL be sent through the channel of its conversation, never
through another channel of the account.

#### Scenario: Addressing
- **WHEN** a reply is delivered for a conversation on a given channel
- **THEN** the provider call uses that channel's provider identifier and the contact's number in digits
