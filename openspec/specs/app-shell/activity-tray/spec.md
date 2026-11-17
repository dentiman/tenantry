# app-shell/activity-tray Specification

## Purpose
Gives the user one place in the application shell to see everything that is currently being done
for them, at which stage it is, and to act on it.

## Requirements

### Requirement: The shell shows work in progress in one place
The application header SHALL show an activity indicator whenever there is at least one tracked
item, and SHALL show nothing when there is none. While items are active the indicator SHALL show
how many are active and their combined progress as a percentage; when only failed items remain it
SHALL indicate that attention is needed.

#### Scenario: Nothing is running
- **WHEN** there are no tracked items
- **THEN** the header contains no activity indicator

#### Scenario: Several uploads are active
- **WHEN** three uploads are in progress
- **THEN** the indicator shows three active items and their combined percentage

#### Scenario: Only a failure is left
- **WHEN** all items have finished and one of them failed
- **THEN** the indicator stays visible and marks that an item failed

### Requirement: The tray lists each item with its progress and actions
Opening the indicator SHALL list the tracked items, newest first, each with its name and state.
An active item SHALL offer cancel, a failed item SHALL show its error and offer retry and dismiss,
and a cancelled item SHALL offer dismiss.

#### Scenario: Acting on a failed item
- **WHEN** the user opens the tray with a failed upload in it
- **THEN** the item shows the error text and the actions retry and dismiss

### Requirement: Finished items leave the tray by themselves
An item that completed successfully SHALL remain in the tray briefly as completed and then be
removed without user action. Failed and cancelled items SHALL remain until the user retries or
dismisses them.

#### Scenario: A successful upload
- **WHEN** an upload completes
- **THEN** it is shown as completed and disappears from the tray a few seconds later

### Requirement: An item made of stages shows them as steps
An item that consists of stages SHALL be expandable into an ordered list of its steps. Each step
SHALL show one of the states pending, running, done, failed or skipped; a running step that
reports measurable progress SHALL show a progress bar; the state of a step SHALL be conveyed by
more than colour alone and SHALL be available to assistive technology as text.

#### Scenario: An upload expanded into steps
- **WHEN** the user expands an upload whose bytes are being sent
- **THEN** the first step is done, the transfer step is running with a progress bar, and the verification step is pending

#### Scenario: A step fails
- **WHEN** the verification step of an upload fails
- **THEN** that step is shown as failed and the earlier steps remain done
