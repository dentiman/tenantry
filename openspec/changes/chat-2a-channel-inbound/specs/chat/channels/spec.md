# chat/channels Specification

## Purpose

Defines the tenant's messaging account and the channels (phone numbers) of that account that
customer conversations arrive on.

## ADDED Requirements

### Requirement: A tenant has at most one messaging account per provider
The system SHALL allow a tenant at most one messaging account for a given provider. An account
SHALL carry a provider, a display name, a status, an externally visible public webhook key that is
unique across tenants, and encrypted credentials. The credentials SHALL NOT appear in any response
or log in clear; a response SHALL show only whether each credential is set.

#### Scenario: An admin reads the account
- **WHEN** a tenant administrator requests the messaging account
- **THEN** the provider, name, status and webhook address are returned, and each credential is
  reported only as set or not set

#### Scenario: A second account for the same provider
- **WHEN** an attempt is made to create a second account of a provider the tenant already has
- **THEN** the system refuses it with a conflict and the existing account is unchanged

### Requirement: A channel is one phone number of the account
A channel SHALL belong to exactly one account and SHALL have a type, a provider, an identifier
assigned by the provider, a display number and an enabled flag. The pair (provider, provider
identifier) SHALL be unique across all tenants, so one number cannot receive for two tenants. A
channel that is not enabled SHALL NOT accept inbound messages.

#### Scenario: Listing channels
- **WHEN** an active user of the tenant requests the channels
- **THEN** the channels of the tenant's account are returned with their display number, enabled
  state and default flag, and no channel of another tenant

#### Scenario: The same provider number in two tenants
- **WHEN** a second tenant tries to register a channel with a provider identifier already in use
- **THEN** the system refuses it

#### Scenario: A disabled channel receives a message
- **WHEN** the provider delivers a message for a channel that is disabled
- **THEN** nothing is added to any conversation and the delivery is recorded as unroutable

### Requirement: The account shows where deliveries must be sent and whether any arrived
For each account the system SHALL show a tenant administrator the public address at which the
provider must deliver, the verify token, whether the signing secret is set, the time of the most
recent delivery received, and the counts of deliveries received in the last day by outcome
(processed, failed, unroutable). When the deployment has no public base address configured, the
address SHALL be reported as unavailable rather than guessed. Whether the provider itself has been
told to use the address (a subscription) is outside this requirement and belongs to the provider's
own change.

#### Scenario: A delivery has arrived
- **WHEN** an administrator opens the account after a delivery was received
- **THEN** the address, the verify token, the time of the last delivery and the daily counts are shown

#### Scenario: Nothing has arrived yet
- **WHEN** no delivery has ever been received
- **THEN** the last-delivery time is empty and the counts are zero

#### Scenario: No public base address is configured
- **WHEN** the deployment has no public base address
- **THEN** the address is reported as unavailable

#### Scenario: A user who is not an administrator
- **WHEN** a non-administrator requests the account
- **THEN** the verify token and address are not returned

### Requirement: A development provider can be set up without credentials
In an environment where development tooling is enabled, a tenant administrator SHALL be able to
create a messaging account and a channel for the `fake` provider with one action. In any other
environment the action SHALL NOT exist.

#### Scenario: Setting up the fake provider
- **WHEN** an administrator in a development environment creates the fake channel
- **THEN** an account and a channel exist, and the webhook address and signing secret needed by the
  simulator are available to that administrator, and deliveries to that address work without any
  external service

#### Scenario: Production
- **WHEN** the same action is requested where development tooling is disabled
- **THEN** the system answers as if the route did not exist
