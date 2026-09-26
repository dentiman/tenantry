# Spec Delta

## Purpose

Lets users of any list built on the shared DataGrid choose which of its fields are shown,
through a gear menu the page can place wherever it fits, with the choice remembered per browser.

## ADDED Requirements

### Requirement: Gear menu lists the grid's hideable fields by their business labels
The system SHALL offer a field settings control rendered as a single icon-only gear button
with an accessible name. Activating it SHALL open a dropdown containing one checkbox item per
hideable field, in the order the page declares the fields, labelled with the same text the
table shows as that field's column header. A checked item SHALL mean the field is visible.

#### Scenario: User opens the gear menu
- **WHEN** the user activates the gear button on the Customers list
- **THEN** a dropdown opens listing a checkbox for each hideable field, labelled as in the
  table header (e.g. "Phone", "Owner", "Tags"), each checked if and only if that field is
  currently shown

#### Scenario: Field declared non-hideable
- **WHEN** a page declares a field as not hideable (e.g. the row-header name field)
- **THEN** that field is always shown and does not appear as an item in the gear menu

### Requirement: Toggling a field item shows or hides that field immediately
The system SHALL show or hide the corresponding table column as soon as its checkbox item is
toggled, without closing the menu, without refetching data, and without changing the current
search, filters, sort, page, page size, or row selection.

#### Scenario: User hides a field
- **WHEN** the user unchecks "Tags" in the gear menu
- **THEN** the Tags column disappears from the header and every row, the menu stays open, and
  the list's page, filters, sort and selection are unchanged

#### Scenario: Sorted field is hidden
- **WHEN** the list is sorted by "Created" and the user hides the Created field
- **THEN** the list keeps its current sort order

#### Scenario: Empty-state row spans the visible columns
- **WHEN** some fields are hidden and the list has no rows
- **THEN** the empty-state message spans the full width of the remaining columns

### Requirement: At least one field stays visible
The system SHALL prevent hiding the last visible field. When only one field remains visible,
its checkbox item SHALL be disabled.

#### Scenario: User tries to hide the last visible field
- **WHEN** every other field is hidden and one hideable field remains
- **THEN** that field's checkbox item is disabled and the field stays visible

### Requirement: Selection and row-action columns are not configurable
The system SHALL keep the row-selection checkbox column and the row-actions column outside the
field settings: they SHALL render whenever the page enables them, regardless of which fields
are hidden, and SHALL NOT appear in the gear menu.

#### Scenario: Hiding fields on a selectable list
- **WHEN** the user hides several fields on the Users list, which has row selection and row
  actions
- **THEN** the selection checkboxes and the row-actions menu remain in every row

### Requirement: The gear control can be placed anywhere around the grid
The system SHALL let a page place the field settings control at any position within the
grid's scope — in the header cell of the row-actions column, in the list toolbar, in the page
header, or elsewhere — with identical behaviour in every position. The grid SHALL NOT render
the control unless the page places it.

#### Scenario: Gear in the table's actions header cell
- **WHEN** a page asks the table to render the gear in its row-actions header cell
- **THEN** the gear appears in that header cell, right-aligned above the row-action menus

#### Scenario: Gear outside the table
- **WHEN** a page places the gear in its page header instead
- **THEN** the gear controls the same table's fields exactly as it would inside the table

#### Scenario: Page does not place the gear
- **WHEN** a grid page does not place the field settings control
- **THEN** no gear appears and all declared columns render as before this change

### Requirement: Manual edits form the Custom state; Reset restores defaults
Any toggle in the gear menu SHALL put the grid into a single Custom state holding the user's
visibility choice. The gear menu SHALL contain a "Reset to default" item that discards Custom
and restores the page's default field set (the first declared field set if the page offers
field sets, otherwise every field not declared as hidden by default).

#### Scenario: Edit on a grid without field sets
- **WHEN** the page offers no field sets and the user shows a field hidden by default
- **THEN** the field appears and stays visible after reload

#### Scenario: User resets after hiding fields
- **WHEN** the user has hidden fields and chooses "Reset to default"
- **THEN** the table shows exactly the page's default field set

### Requirement: Field choices persist per browser per grid
The system SHALL remember the user's field choices in the browser, separately for each grid
identified by the page, and restore them on the next visit. Stored entries referring to fields
the page no longer declares SHALL be ignored; fields the page declares but the stored choice
does not mention SHALL take their default visibility. Stored data in an unrecognised format
SHALL be ignored. If browser storage is unavailable, the feature SHALL keep working for the
current page session without persisting.

#### Scenario: Choice survives reload
- **WHEN** the user hides "Phone" on the Users list and reloads the page
- **THEN** the Users list is shown without the Phone column

#### Scenario: Grids do not share choices
- **WHEN** the user hides "Phone" on the Users list
- **THEN** the Customers list's Phone column is unaffected

#### Scenario: Page adds a new field after a choice was stored
- **WHEN** a stored choice exists and a new release adds a field to that list
- **THEN** the new field appears according to its declared default visibility and the stored
  choices for the other fields still apply

#### Scenario: Stored choice references a removed field
- **WHEN** the stored choice mentions a field id the page no longer declares
- **THEN** that entry is ignored and the list renders without error

#### Scenario: Storage is blocked
- **WHEN** reading or writing browser storage throws
- **THEN** the gear menu still shows and hides fields for the current session
