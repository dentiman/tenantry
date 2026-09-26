# data-grid/field-order Specification

## Purpose

Lets users arrange the fields a DataGrid list shows — from the field panel or by dragging table
column headers — with the order kept per field set, edits forming the Custom set, and the result
remembered per browser.

## Requirements

### Requirement: Shown fields can be reordered from the field panel
The system SHALL give every reorderable field in the Shown section of the field panel a drag
handle. Dragging a handle SHALL move the field within Shown, with the rows making room live
while dragging, and dropping SHALL apply the new order to the table immediately. Hidden fields
SHALL NOT be draggable.

#### Scenario: User drags a field up
- **WHEN** Shown lists No., Customer, Phone, Status and the user drags "Status" above "Phone"
- **THEN** the table columns read No., Customer, Status, Phone and the panel stays open

#### Scenario: Hidden fields have no handle
- **WHEN** the user opens the field panel while "Tags" is hidden
- **THEN** "Tags" in Hidden has no drag handle

### Requirement: Reordering from the panel is keyboard-operable
Each drag handle SHALL be focusable with an accessible name naming its field. While a handle is
focused, Arrow Up and Arrow Down SHALL move that field one position among reorderable shown
fields, keep focus on the moved handle, and announce the new position through a live region.

#### Scenario: Keyboard move
- **WHEN** focus is on the handle of "Status" (third of four) and the user presses Arrow Up
- **THEN** "Status" becomes second, focus stays on its handle, and "Status, position 2 of 4" (or
  its localised equivalent) is announced

### Requirement: Table columns can be reordered by dragging their headers
The system SHALL let the user drag a reorderable column's header horizontally. While dragging it
SHALL show a translucent ghost of the header following the pointer and a vertical insertion line
spanning the table at the drop position; columns SHALL NOT shift until the drop. Dropping SHALL
apply the order; pressing Escape SHALL cancel without change. A press-and-release without
movement beyond a small threshold SHALL keep its current meaning (e.g. sort).

#### Scenario: User drags a header
- **WHEN** the user drags the "Owner" header and releases it between "Customer" and "Phone"
- **THEN** during the drag an insertion line appears at that boundary, and after release the
  columns read No., Customer, Owner, Phone, Status, Created

#### Scenario: Click still sorts
- **WHEN** the user clicks the sortable "Status" header without moving the pointer
- **THEN** the list is sorted by Status and no reordering happens

#### Scenario: Escape cancels
- **WHEN** the user is dragging a header and presses Escape
- **THEN** the ghost and insertion line disappear and the order is unchanged

### Requirement: Pinned and service columns do not move
A field the page marks as not reorderable SHALL stay at the start, in declaration order among
pinned fields, and SHALL have neither a drag handle nor a draggable header. The row-selection and
row-action columns SHALL never move and SHALL NOT be drop targets that place a field outside
them. No field SHALL be dropped before a pinned field.

#### Scenario: Drop before a pinned field
- **WHEN** "User" is pinned on the Users list and the user drags "Role" toward the start
- **THEN** the insertion line stops right after "User" and "Role" lands after it

### Requirement: Reordering on a preset moves the user to Custom
Reordering while a preset field set is active SHALL create (or replace) the Custom set from the
preset's visible fields and order with the move applied, and select the Custom tab; the preset
SHALL stay unchanged. Reordering while Custom is active SHALL update Custom in place. On a grid
without field sets, reordering SHALL form the Custom state the same way.

#### Scenario: First reorder on Main
- **WHEN** "Main" is active and the user moves "Status" before "Phone"
- **THEN** the "Custom" tab appears and is selected with the new order, and selecting "Main"
  shows Main's original order

### Requirement: Hidden fields keep their position
The system SHALL remember the position of every field in the Custom order, including hidden
ones. A field turned back on SHALL appear at its remembered position among the shown fields. A
field that has never been positioned (e.g. added by a new release) SHALL appear right after the
field that precedes it in the page's declaration.

#### Scenario: Re-showing a field
- **WHEN** in Custom the order is No., Customer, Phone, Status and the user hides then re-shows
  "Phone"
- **THEN** "Phone" returns between Customer and Status

#### Scenario: New field from a release
- **WHEN** a stored Custom order exists and a new release declares "Website" right after "Phone"
- **THEN** if "Website" is visible it appears right after "Phone"

### Requirement: Reset restores the default order
"Reset to default" SHALL restore the default field set's order together with its visibility.

#### Scenario: Reset after reordering
- **WHEN** the user reordered fields into Custom and chooses "Reset to default"
- **THEN** the first field set is active with its own order and the Custom tab is gone

### Requirement: Order persists per browser per grid
The system SHALL persist the Custom order together with the Custom visibility per grid and
restore it on the next visit. Stored order entries for fields the page no longer declares SHALL
be ignored. Choices stored by the previous format (visibility without order) SHALL be kept, with
the order derived from the page's declaration.

#### Scenario: Order survives reload
- **WHEN** the user reorders fields into Custom and reloads the page
- **THEN** Custom is selected with the same order

#### Scenario: Previous-format data
- **WHEN** the browser holds a Custom visibility stored before order existed
- **THEN** the list shows that visibility in declaration order and no error occurs
