# Spec Delta

## MODIFIED Requirements

### Requirement: The shell shows work in progress in one place
The application SHALL show an activity dock attached to the bottom edge, in the bottom-right
corner of the work area, whenever there is at least one tracked item, and SHALL show nothing when
there is none. The dock SHALL overlay the page without moving its content and SHALL stay clear of
the side panels opened to the right of the work area. Its header SHALL summarise the items in one
line: while items are active, how many are active and their combined progress as a percentage;
when none is active and some failed, how many failed; otherwise how many completed.

#### Scenario: Nothing is running
- **WHEN** there are no tracked items
- **THEN** no activity dock is shown

#### Scenario: Several uploads are active
- **WHEN** three uploads are in progress
- **THEN** the dock header says three items are uploading and shows their combined percentage

#### Scenario: Only a failure is left
- **WHEN** all items have finished and one of them failed
- **THEN** the dock stays visible and its header says one item failed

#### Scenario: A side panel is open
- **WHEN** the assistant or the context panel is open on the right
- **THEN** the dock sits to the left of it and does not cover it

### Requirement: The tray lists each item with its progress and actions
The dock SHALL list the tracked items, newest first, each with its name and a mark of its state.
The actions of an item SHALL be reachable by pointer hover, keyboard focus and on touch devices:
an active item SHALL offer cancel, a failed item SHALL show its error and offer retry (where the
source allows it) and dismiss, a finished or cancelled item SHALL offer dismiss, and an item with
a result SHALL offer its result action.

#### Scenario: Acting on a failed item
- **WHEN** the user points at a failed upload in the dock
- **THEN** the item shows the error text and the actions retry and dismiss

#### Scenario: A finished export
- **WHEN** the user points at a finished export
- **THEN** the item offers download and dismiss

### Requirement: Finished items leave the tray by themselves
Finished items SHALL remain in the dock until the user dismisses them or closes the dock; they
SHALL NOT disappear on a timer. Closing the dock SHALL remove every item. If any item is still
active, closing SHALL first ask for confirmation, and confirming SHALL cancel the active items.

#### Scenario: A successful upload
- **WHEN** an upload completes
- **THEN** it stays in the dock as completed until dismissed or the dock is closed

#### Scenario: Closing while idle
- **WHEN** the user closes the dock with no active items
- **THEN** the dock disappears with all its items

#### Scenario: Closing during uploads
- **WHEN** the user closes the dock while uploads are in progress and confirms
- **THEN** the uploads are cancelled and the dock disappears

#### Scenario: Declining the confirmation
- **WHEN** the user closes the dock during uploads and declines the confirmation
- **THEN** the uploads continue and the dock stays

## ADDED Requirements

### Requirement: The dock can be collapsed
The user SHALL be able to collapse the dock to its header line and expand it again. The collapsed
state SHALL be remembered across page reloads. Work the user starts SHALL expand a collapsed dock;
items restored after a page reload SHALL NOT.

#### Scenario: Collapsing
- **WHEN** the user collapses the dock
- **THEN** only the header line with the summary remains at the bottom edge

#### Scenario: A new upload while collapsed
- **WHEN** the dock is collapsed and the user starts an upload
- **THEN** the dock expands and shows the new item
