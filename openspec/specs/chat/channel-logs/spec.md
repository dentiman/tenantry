# chat/channel-logs Specification

## Purpose
Defines the call log of a messaging account: what is recorded about calls to the provider, what is
deliberately left out, how long it is kept and who can read it.

## Requirements

### Requirement: Every call to the provider is recorded without secrets or content
For each call to the provider — verification, synchronisation, send — the system SHALL record the time,
the operation, the outcome, the HTTP status, the duration and, on failure, the provider's error code and
title. A send entry SHALL reference the message by its identifier. The entry SHALL NOT contain the
access token, the application secret, an authorization header, the text of a message, a template's
content, or a full phone number (only its last four digits). The provider's own identifiers of a message
MAY be recorded.

#### Scenario: A successful send
- **WHEN** a message is sent
- **THEN** one entry records the send, its status and duration, the message identifier and the masked recipient

#### Scenario: A failed call
- **WHEN** the provider rejects a call
- **THEN** the entry records the provider's error code and title and no secret

#### Scenario: Secrets never appear
- **WHEN** any entry is inspected
- **THEN** it contains neither the token, the secret, an authorization header nor message text

### Requirement: Entries are kept for a limited time
Log entries SHALL be deleted automatically after a fixed retention period, so that the log does not
grow without bound.

#### Scenario: An old entry
- **WHEN** an entry is older than the retention period
- **THEN** the daily purge removes it and keeps newer ones

### Requirement: A tenant administrator reads the recent log of the account
A tenant administrator SHALL be able to read the most recent entries of the account, newest first, with
paging. Entries SHALL be isolated by tenant like all tenant data; a user who is not an administrator
SHALL NOT read them.

#### Scenario: Reading the log
- **WHEN** an administrator requests the log of the account
- **THEN** the latest entries are returned newest first

#### Scenario: Another tenant
- **WHEN** a user of another tenant requests the log
- **THEN** no entry of this tenant is visible

#### Scenario: A non-administrator
- **WHEN** a user who is not an administrator requests the log
- **THEN** the system refuses the request
