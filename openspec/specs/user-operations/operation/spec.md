# user-operations/operation Specification

## Purpose
Gives a user a durable, observable handle on work that runs after the request that started it:
what is running for them, how far it got, how it ended, and its result.

## Requirements

### Requirement: An operation belongs to the user who started it
An operation SHALL be visible only to the user who started it. Reading, listing, cancelling or
downloading the result of another user's operation — in the same tenant or another — SHALL answer
not found. A tenant administrator SHALL have no access to other users' operations.

#### Scenario: Another user of the same tenant
- **WHEN** a user requests an operation started by a colleague
- **THEN** the answer is not found

#### Scenario: An administrator
- **WHEN** a tenant administrator lists operations
- **THEN** only the administrator's own operations are returned

### Requirement: Starting work returns an operation immediately
An endpoint that starts long work SHALL answer `202 Accepted` with the new operation in the
`QUEUED` state without waiting for the work. The operation and the queued work SHALL be created
atomically: either both exist or neither does. Repeating the start request with the same
`Idempotency-Key` SHALL return the same operation and SHALL NOT queue the work again.

#### Scenario: Start
- **WHEN** a user starts an export
- **THEN** the response is 202 with an operation in state QUEUED, and the work is queued once

#### Scenario: Repeated start with the same key
- **WHEN** the same start request is sent again with the same Idempotency-Key
- **THEN** the same operation is returned and no second operation or job exists

### Requirement: The operation reports its state and progress
An operation SHALL move through `QUEUED`, `RUNNING` and exactly one final state: `SUCCEEDED`,
`FAILED` or `CANCELED`. While running it MAY report progress as current and total units and MAY
report a list of steps, each `pending`, `running`, `done`, `failed` or `skipped`. A failed
operation SHALL carry a machine-readable error code, not user-facing text. A final state SHALL
NOT change afterwards.

#### Scenario: Progress during an export
- **WHEN** a running export has written 400 of 1,000 rows
- **THEN** reading the operation shows state RUNNING with progress 400 of 1,000

#### Scenario: A finished operation does not change
- **WHEN** an operation has succeeded and a late update for it arrives
- **THEN** the operation stays SUCCEEDED with its result

### Requirement: The user can list their operations
The user SHALL be able to list their own operations, newest first, with an option to return only
active ones (queued or running).

#### Scenario: Only active operations
- **WHEN** a user with one running and two finished operations asks for active operations
- **THEN** only the running one is returned

### Requirement: An operation can be cancelled
The user SHALL be able to cancel their queued or running operation. A queued operation SHALL
become `CANCELED` at once and its work SHALL not start; a running operation SHALL stop at its next
checkpoint and become `CANCELED`. Cancelling a finished operation SHALL change nothing and answer
with its current state.

#### Scenario: Cancelling a queued operation
- **WHEN** the user cancels an operation that has not started
- **THEN** it is CANCELED immediately and its work never runs

#### Scenario: Cancelling a running operation
- **WHEN** the user cancels an export while rows are being written
- **THEN** the export stops, the operation ends CANCELED, and no result file is offered

#### Scenario: Cancelling a finished operation
- **WHEN** the user cancels an operation that has already succeeded
- **THEN** it stays SUCCEEDED

### Requirement: Changes are pushed to the user's open sessions
Every change of an operation SHALL be announced to the sessions of its owner with the operation id
and a revision number that grows with every change. The announcement SHALL NOT carry the
operation's data; the client SHALL read the operation when the announced revision is newer than
the one it holds. Missing announcements SHALL NOT leave the client with a wrong final state.

#### Scenario: A client misses events
- **WHEN** a client that was offline reconnects
- **THEN** reading its operations gives their current states

### Requirement: Work that stops reporting is failed
A running operation that has made no progress update for 15 minutes SHALL be marked `FAILED`
with the error code `STALLED`, so that it never stays running forever.

#### Scenario: A worker dies mid-export
- **WHEN** an operation has been RUNNING without an update for more than 15 minutes
- **THEN** the sweeper marks it FAILED with STALLED and the owner is notified

### Requirement: The result file is downloaded through the operation
An operation that produced a file SHALL offer a download link valid for a short time, issued only
to the owner and only while the operation is `SUCCEEDED` and not expired. The file SHALL NOT be
reachable through the general files API.

#### Scenario: Owner downloads the export
- **WHEN** the owner asks for the result link of a succeeded export
- **THEN** a short-lived link to the CSV file is returned

#### Scenario: No result
- **WHEN** the owner asks for the result link of a failed operation
- **THEN** the answer is not found

### Requirement: Finished operations are kept for 30 days
A finished operation and its result file SHALL be deleted 30 days after it finished. Deleting a
user SHALL delete that user's operations.

#### Scenario: Retention
- **WHEN** the daily cleanup runs
- **THEN** operations finished more than 30 days ago are gone, together with their result files

#### Scenario: User deleted
- **WHEN** a user is deleted
- **THEN** none of their operations remain

### Requirement: The owner is notified when an operation ends
When an operation succeeds or fails, its owner SHALL receive an in-app notification that names
the operation and leads to its result or explains the failure. A cancelled operation SHALL NOT
notify.

#### Scenario: Export finished
- **WHEN** an export succeeds
- **THEN** its owner gets a notification with a way to download the file

### Requirement: Operations appear in the activity tray
The tenant web application SHALL show the user's active operations in the activity tray together
with uploads, update them live, keep failed ones until dismissed, and offer a download action on a
succeeded operation that has a result file. Operations SHALL be shown after a page reload as long
as they are active.

#### Scenario: Reload during an export
- **WHEN** the user reloads the page while an export is running
- **THEN** the tray shows the export with its current progress

#### Scenario: Export finished while the tray is open
- **WHEN** the export succeeds
- **THEN** its tray row shows completion and a download action
