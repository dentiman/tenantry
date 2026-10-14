## ADDED Requirements

### Requirement: The Meta webhook completes the verification handshake
The public webhook address of a WhatsApp (Meta) account SHALL answer the GET handshake: when `hub.mode` is
`subscribe` and `hub.verify_token` equals the account's verify token, it SHALL return `hub.challenge` as plain
text; in every other case, including an unknown or disabled account, it SHALL answer 403 without saying why.

#### Scenario: Meta verifies the address
- **WHEN** Meta sends the handshake with the account's verify token
- **THEN** the challenge is returned as plain text

#### Scenario: Wrong token or unknown account
- **WHEN** the handshake carries another token, or the address belongs to no account
- **THEN** the answer is 403 and nothing is stored

### Requirement: Every Meta webhook is stored as received
A POST to the account's webhook address SHALL be stored unchanged: the exact body bytes as text, the request
headers (without cookies or credentials), the receive time and the outcome of the `X-Hub-Signature-256`
check (valid, invalid, or not checkable when the account has no app secret). Storing SHALL NOT interpret the
body or change any conversation, message, contact or channel. The system SHALL answer 200 for a known
account, including a body that is not valid JSON. A byte-identical repeat SHALL NOT create a second record.

#### Scenario: A status webhook arrives
- **WHEN** Meta posts a delivery status for a message
- **THEN** one record holds the exact body, the headers, the receive time and a valid signature result, and no message changes

#### Scenario: A body that is not JSON
- **WHEN** a signed request carries a body that cannot be parsed
- **THEN** it is stored, marked failed, and answered with 200

#### Scenario: A repeat
- **WHEN** Meta delivers the same bytes again
- **THEN** no second record is created and the answer is 200

### Requirement: Signature enforcement is a setting, recorded by default for Meta in this slice
The system SHALL compute the signature result with the account's app secret over the raw bytes. When
`CHANNEL_WEBHOOK_SIGNATURE` is `enforce` (the default) a request with an invalid or missing signature SHALL be
refused with 401 and stored nowhere; when it is `record` the request SHALL be stored with the result and
answered 200. The Hetzner stand SHALL set `record` until receipts and inbound are built.

#### Scenario: Enforce
- **WHEN** the setting is `enforce` and the signature is wrong
- **THEN** the answer is 401 and no record is stored

#### Scenario: Record
- **WHEN** the setting is `record` and the signature is wrong
- **THEN** the request is stored with an invalid result and answered 200
