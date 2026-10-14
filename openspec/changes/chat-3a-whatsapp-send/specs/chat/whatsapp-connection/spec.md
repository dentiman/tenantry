# chat/whatsapp-connection Specification

## Purpose

Defines how a tenant administrator connects a WhatsApp Business account, what the system checks
before trusting it, how its phone numbers become channels, and what is never revealed.

## ADDED Requirements

### Requirement: An administrator connects a WhatsApp Business account with a verified token
A tenant administrator SHALL be able to connect a WhatsApp Business account by giving its account
identifier and an access token, and optionally the application identifier and application secret.
Before storing anything the system SHALL verify the token with the provider: that it is valid and
that it can read the given account. When the application identifier and secret are given, the system
SHALL additionally read the token's type, expiry and permissions from the provider and SHALL require
both the account-management and the messaging permission; without them it SHALL report the type and the
permissions as unverified. A failed verification SHALL store nothing and SHALL say which check failed.
Only a tenant administrator SHALL be able to connect or change an account.

#### Scenario: A valid token
- **WHEN** an administrator connects an account with a valid token that has both permissions and can read the account
- **THEN** the account is stored as connected with the token kind, expiry and permissions the provider reported

#### Scenario: A token without a required permission
- **WHEN** the application identifier and secret are given and the token lacks the messaging permission
- **THEN** nothing is stored and the answer names the missing permission

#### Scenario: Connecting without the application secret
- **WHEN** an administrator connects with only the account identifier and a token that can read the account
- **THEN** the account is stored as connected with the token kind and permissions reported as unverified

#### Scenario: A token that cannot read the account
- **WHEN** the token is valid but the provider refuses access to the given account
- **THEN** nothing is stored and the answer says the token has no access to that account

#### Scenario: An invalid or expired token
- **WHEN** the provider reports the token invalid
- **THEN** nothing is stored and the answer says so, without echoing the token

#### Scenario: A non-administrator
- **WHEN** a user who is not an administrator tries to connect an account
- **THEN** the system refuses the request

### Requirement: Credentials are encrypted and never revealed
The access token and the application secret SHALL be stored encrypted. They SHALL NOT appear in any
response, in any log entry, in any error message, or in the call log. A response SHALL show only
whether each is set and, for the token, the last four characters as a mask and the verified kind,
expiry and permissions.

#### Scenario: Reading the account after connecting
- **WHEN** an administrator reads the account
- **THEN** the token appears only as set, its mask, kind, expiry and permissions, and the secret only as set

#### Scenario: A provider error mentions the token
- **WHEN** a call fails and the provider's message contains part of the token
- **THEN** the stored and returned error text does not contain it

### Requirement: A temporary token is accepted and labelled
When the verified token is a short-lived user token, the system SHALL accept it, mark the account's
token as temporary, and show the remaining validity. When it expires, the account SHALL become
"needs re-authentication" and sending SHALL fail with the authentication class until a new token is
saved.

#### Scenario: Connecting with a temporary token
- **WHEN** the provider reports an expiry for the token
- **THEN** the account shows the token as temporary with the time left

#### Scenario: A token that has expired
- **WHEN** a send is attempted and the provider rejects the token
- **THEN** the account becomes "needs re-authentication" and the message fails with the authentication class

### Requirement: Re-authenticating replaces the token without losing anything
An administrator SHALL be able to save a new token for a connected account. The new token SHALL be
verified exactly like the first one, and only a successful verification SHALL replace the stored one
and return the account to connected. Conversations, contacts, channels and messages SHALL be unaffected.

#### Scenario: Saving a new token
- **WHEN** an administrator saves a valid new token for an account that needed re-authentication
- **THEN** the account is connected again and its channels and conversations are unchanged

#### Scenario: A bad replacement
- **WHEN** the new token fails verification
- **THEN** the previous token stays and the account status is unchanged

### Requirement: Phone numbers are synchronised from the provider
After connecting, and whenever an administrator asks, the system SHALL read all phone numbers of the
account from the provider, following pagination, and create or update one channel per number with its
display number, verified name, quality rating, mode and status. A newly seen number SHALL start
disabled. A number that no longer exists at the provider SHALL be marked missing and SHALL NOT be
deleted, and conversations that use it SHALL remain. A number that is already in use by another tenant
SHALL NOT be added to this one.

#### Scenario: First synchronisation
- **WHEN** an account with two numbers is connected
- **THEN** two channels exist, both disabled, with their display numbers and ratings

#### Scenario: A number disappears
- **WHEN** a later synchronisation no longer lists a number that has conversations
- **THEN** the channel is marked missing, still exists, and its conversations are intact

#### Scenario: A number belongs to another tenant
- **WHEN** a listed number is already registered as a channel of a different tenant
- **THEN** it is skipped and the skip is reported to the administrator

#### Scenario: A repeated synchronisation
- **WHEN** nothing changed at the provider
- **THEN** the channels are unchanged and no duplicates appear

### Requirement: An administrator enables numbers and chooses a default
An administrator SHALL be able to enable and disable each synchronised number and to mark exactly one
enabled number as the default. A disabled or missing number SHALL NOT be offered for new
conversations or accept sends. Disabling SHALL NOT affect existing conversations' history.

#### Scenario: Enabling a number
- **WHEN** an administrator enables a synchronised number
- **THEN** it can be chosen when starting a conversation

#### Scenario: Two defaults
- **WHEN** an administrator marks a second number as default
- **THEN** the first stops being the default

#### Scenario: A disabled number
- **WHEN** an agent tries to send through a disabled number
- **THEN** the system refuses and nothing is queued

### Requirement: An administrator can disconnect the account
An administrator SHALL be able to disconnect the account. Disconnecting SHALL delete the stored token
and secret and mark the account disabled, SHALL keep its channels, contacts, conversations and
messages, and SHALL make every send through it fail with the authentication class until a token is
saved again.

#### Scenario: Disconnecting
- **WHEN** an administrator disconnects the account
- **THEN** the credentials are gone, the history is intact, and new sends fail as unauthenticated
