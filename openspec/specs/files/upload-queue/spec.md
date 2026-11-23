# files/upload-queue Specification

## Purpose
Defines how a file upload behaves in the tenant web app after the user starts it: it belongs to
the application session rather than to the screen that started it.

## Requirements

### Requirement: An upload continues when the user leaves the screen that started it
An upload SHALL keep running when the user navigates to another page of the application or closes
the dialog it was started from, and SHALL reach its final state without that screen being open.

#### Scenario: Navigation during an upload
- **WHEN** the user starts an upload and opens another page before it finishes
- **THEN** the upload completes and is shown as finished in the activity tray

### Requirement: Uploads are transferred a few at a time
The application SHALL transfer at most three files at the same time. Further uploads SHALL wait
in the order they were started and begin automatically as earlier ones finish, fail or are
cancelled.

#### Scenario: More files than the limit
- **WHEN** five uploads are started together
- **THEN** three are transferring and two are waiting, and a waiting one starts as soon as one of the three ends

### Requirement: An upload can be cancelled
The user SHALL be able to cancel an upload that is waiting or in progress. A cancelled upload
SHALL stop transferring immediately, SHALL NOT be reported as an error, and SHALL free its place
in the queue.

#### Scenario: Cancelling a transfer
- **WHEN** the user cancels an upload while its bytes are being sent
- **THEN** the transfer stops, the item is shown as cancelled, and the next waiting upload starts

#### Scenario: Cancelling a waiting upload
- **WHEN** the user cancels an upload that has not started
- **THEN** it is removed from the queue and nothing is sent

### Requirement: A failed upload can be retried
An upload that failed SHALL stay visible with its error and SHALL offer a retry. A retry SHALL
start the upload from the beginning with the same file.

#### Scenario: Retry after a network failure
- **WHEN** an upload fails because the connection dropped and the user chooses retry
- **THEN** the same file is uploaded again from the start and can complete

### Requirement: Leaving the application during an upload asks for confirmation
While at least one upload is waiting or in progress, closing or reloading the browser tab SHALL
trigger the browser's leave-page confirmation. With no active uploads it SHALL NOT.

#### Scenario: Closing the tab mid-upload
- **WHEN** the user closes the tab while an upload is in progress
- **THEN** the browser asks to confirm leaving

#### Scenario: Closing the tab when idle
- **WHEN** the user closes the tab with no active uploads
- **THEN** no confirmation is shown

### Requirement: Existing upload screens keep working unchanged
A screen that uploads one file and waits for it (the avatar dialogs) SHALL behave as before: it
shows the progress of its own upload, receives the uploaded file when it is ready, and shows the
error when it fails.

#### Scenario: Changing an avatar
- **WHEN** the user picks an image in the avatar dialog
- **THEN** the dialog shows the upload progress and saves the new avatar when the upload is ready
