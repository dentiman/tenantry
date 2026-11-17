# api/idempotency Specification

## Purpose
Lets a client repeat a REST mutation safely: a request that carries an `Idempotency-Key` header is
applied at most once, and a repeat receives the response of the first successful attempt.

## Requirements

### Requirement: A repeated request returns the original response without repeating the effect
An endpoint that supports idempotency keys SHALL apply a request carrying an `Idempotency-Key`
header at most once. A later request by the same user with the same key and the same content
SHALL receive the status and body of the first successful attempt, SHALL cause no further effect
(no second record, activity entry, notification or queued job), and SHALL be marked as a replay
with the response header `Idempotent-Replayed: true`.

#### Scenario: A completed create is repeated
- **WHEN** a user creates a customer with a key and then sends the identical request with the same key
- **THEN** both responses are created with the same customer, exactly one customer exists, and the second response carries `Idempotent-Replayed: true`

#### Scenario: A request without the header
- **WHEN** a user sends the same create request twice without an `Idempotency-Key` header
- **THEN** two records are created, exactly as before this capability existed

#### Scenario: An endpoint that does not support keys
- **WHEN** a request to an endpoint without idempotency support carries the header
- **THEN** the header is ignored and the request is processed normally

### Requirement: Concurrent duplicates produce one effect
When two requests with the same key and content from the same user are in flight at the same
time, the system SHALL apply the effect exactly once and SHALL answer both with the same
successful response; neither request fails because of the other.

#### Scenario: Two identical requests race
- **WHEN** two create requests with the same key arrive at the same time
- **THEN** exactly one record is created, one sequence number is consumed, and both requests succeed with that record

### Requirement: A failed request does not consume its key
A request that ends in an error SHALL leave no trace of its key. A repeat with the same key SHALL
be processed as a new request and receive the answer that is true at that moment.

#### Scenario: A rejected request is repeated after the cause is removed
- **WHEN** a create request with a key is rejected with a conflict, the conflicting record is removed, and the identical request is sent again with the same key
- **THEN** the second request succeeds and creates the record

#### Scenario: A validation error is repeated
- **WHEN** a request with a key fails validation and is sent again unchanged with the same key
- **THEN** it fails validation again and nothing is stored for the key

### Requirement: A key identifies one request
A key SHALL be bound to the request it was first completed with: the HTTP method, the path and
the body. Reusing the key for a different request SHALL be rejected with `422` and the error code
`IDEMPOTENCY_KEY_REUSED`, and SHALL cause no effect.

#### Scenario: Same key, different body
- **WHEN** a user completes a create request with a key and then sends a request with the same key and a different body
- **THEN** the second request is answered `422` with code `IDEMPOTENCY_KEY_REUSED` and no record is created

### Requirement: Keys are private to a user within a tenant
A key SHALL be scoped to the user who sent it and to that user's tenant. The same key value used
by another user, or in another tenant, SHALL be treated as an unrelated key, and a stored response
SHALL never be returned to anyone but the user whose request produced it.

#### Scenario: Two users choose the same key
- **WHEN** two users of one tenant each send a create request with the same key value
- **THEN** each request is processed independently and each user receives their own record

#### Scenario: The same key in another tenant
- **WHEN** a user of another tenant sends a request with a key value already used in the first tenant
- **THEN** the request is processed independently and no data of the first tenant is returned

### Requirement: A malformed key is rejected
The header value SHALL be 1 to 255 visible ASCII characters without spaces. Any other value SHALL be rejected
with `400` before the request is processed.

#### Scenario: An oversized key
- **WHEN** a request to a supporting endpoint carries a key longer than 255 characters
- **THEN** it is answered `400` and nothing is created

### Requirement: An unavailable result is reported, not guessed
When a key is known to have been applied but its response is not available — the first attempt
has committed and its response is still being recorded, or was lost with a crashed process — the
system SHALL answer `409` with code `IDEMPOTENCY_IN_PROGRESS` and a `Retry-After` header, and
SHALL NOT apply the effect again.

#### Scenario: The response of an applied key is missing
- **WHEN** a request arrives with a key that has been applied but has no recorded response
- **THEN** it is answered `409` with code `IDEMPOTENCY_IN_PROGRESS` and `Retry-After`, and no second record is created

### Requirement: Keys are remembered for a bounded time
A completed key SHALL be remembered for at least 24 hours. After it has been removed, a request
with that key SHALL be processed as a new request.

#### Scenario: Old keys are removed
- **WHEN** the nightly cleanup runs
- **THEN** keys completed more than 24 hours ago are deleted and newer ones remain

### Requirement: Creating a customer and a calendar event supports idempotency keys
The endpoints that create a customer and that create a calendar event SHALL support idempotency
keys as described above.

#### Scenario: A calendar event create is repeated
- **WHEN** a user creates a calendar event with a key and repeats the identical request with the same key
- **THEN** one event exists, its attendees are notified once, and both responses carry the same event

### Requirement: The web client protects create requests by itself
The tenant web application SHALL attach an idempotency key to every `POST` request with a JSON
body without any code in the calling screen. It SHALL reuse the same key when an identical
request is sent again while the previous attempt is still in flight or ended without a definite
answer (no response, a timeout, a server error, or `IDEMPOTENCY_IN_PROGRESS`), and SHALL use a new
key once an attempt has received a definite answer. A key set explicitly by the caller SHALL be
kept as is.

#### Scenario: A double submit
- **WHEN** the same create form is submitted twice before the first response arrives
- **THEN** both requests carry the same key and one record is created

#### Scenario: A retry after a lost response
- **WHEN** a create request fails with a network error and the user submits the unchanged form again
- **THEN** the second request carries the same key as the first

#### Scenario: A deliberate second record
- **WHEN** a create request succeeds and the user later submits identical data again
- **THEN** the second request carries a new key and a second record is created

#### Scenario: The form is corrected after a rejection
- **WHEN** a create request is rejected with a validation error and the user changes the data and submits again
- **THEN** the second request carries a new key
