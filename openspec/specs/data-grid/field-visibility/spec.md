# data-grid/field-visibility Specification

## Purpose

Lets users of any list built on the shared DataGrid choose which of its fields are shown,
through a gear menu the page can place wherever it fits, with the choice remembered per browser.

## Requirements

### Requirement: Gear menu lists the grid's hideable fields by their business labels
The system SHALL offer a field settings control rendered as a single icon-only gear button
with an accessible name. Activating it SHALL open a panel listing the grid's fields in two
sections: **Shown** — every currently visible field, in the current display order — and
**Hidden** — every hidden field, in the order the page declares the fields. Each field SHALL be
labelled with the same text the table shows as that field's column header and carry a checkbox
that is checked if and only if the field is visible. A non-hideable field SHALL appear in Shown
with a checked, non-interactive (locked) checkbox. The Hidden section SHALL NOT be shown when no
field is hidden.

#### Scenario: User opens the gear menu
- **WHEN** the user activates the gear button on the Customers list with default fields
- **THEN** a panel opens with Shown listing the visible fields in display order, each checked, and
  Hidden listing "Tags", unchecked

#### Scenario: Field declared non-hideable
- **WHEN** a page declares a field as not hideable (e.g. the row-header name field)
- **THEN** that field is always shown and appears in Shown with a locked checkbox that cannot
  be unchecked

#### Scenario: Toggled field moves between sections
- **WHEN** the user unchecks "Phone" in Shown
- **THEN** "Phone" moves to Hidden at its declaration position and the panel stays open

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

### Requirement: Field panel height is bounded and its lists scroll
The field panel SHALL never be taller than the space available in the viewport, and SHALL NOT
exceed a fixed maximum height. When the fields do not fit, only the field lists SHALL scroll; the
section headers (including the search field, when present) and the "Reset to default" action
SHALL stay visible. While a field is dragged near the top or bottom edge of the Shown list, that
list SHALL scroll in that direction.

#### Scenario: Grid with 32 fields
- **WHEN** the user opens the field panel on a grid with 32 fields in a 969 px tall window
- **THEN** the panel fits inside the window, the field lists scroll, and "Reset to default" is
  visible without scrolling

#### Scenario: Dragging past the list edge
- **WHEN** the user drags a shown field toward the bottom edge of the scrolled Shown list
- **THEN** the list scrolls down while the pointer stays near that edge

### Requirement: Grids with many fields get a two-column field panel
When a grid declares more than 20 fields, the field panel SHALL lay out Shown and Hidden side by
side — Shown on the left, Hidden on the right — each with its own header showing its field count
and its own scrolling list, and SHALL keep a width that fits the viewport. Grids with 20 or fewer
fields SHALL keep the single-column panel with Shown above Hidden. A page MAY force either layout.

#### Scenario: Invoices grid (32 fields)
- **WHEN** the user opens the field panel on the invoices grid
- **THEN** Shown (7) is on the left, Hidden (25) on the right, their headers aligned on one line

#### Scenario: Customers grid (7 fields)
- **WHEN** the user opens the field panel on the Customers list
- **THEN** the panel is a single column with Shown above Hidden

### Requirement: Hidden fields can be searched when the grid has many fields
When a grid declares more than 20 fields, the Hidden section header SHALL contain, on the same
line as the section title, a search field whose right-hand part shows the number of hidden fields
(the number matching and the total while a search is active). Typing SHALL filter only the Hidden
list to fields whose label or field id contains the text, case-insensitively, keeping its order;
a "no matching fields" message SHALL be shown when nothing matches. The Shown list SHALL NOT be
filtered and SHALL stay reorderable during a search. Hidden fields SHALL remain toggleable while
filtering. Opening the panel with a pointer SHALL NOT move focus into the search field. The
search SHALL be cleared when the panel closes. Grids with 20 or fewer fields SHALL show no search
field.

#### Scenario: Search by label
- **WHEN** the user types "due" in the Hidden search on the invoices grid
- **THEN** Hidden lists only "Days overdue", the count reads "1 / 25", and Shown still lists all
  seven shown fields

#### Scenario: Search by field id
- **WHEN** the user types "ponum"
- **THEN** Hidden lists "PO number" (field id `poNumber`)

#### Scenario: Toggle while filtering
- **WHEN** the search shows "PO number" in Hidden and the user checks it
- **THEN** the column appears in the table and "PO number" is added to Shown

#### Scenario: Reorder during a search
- **WHEN** a search is active and the user drags a Shown field
- **THEN** the field is reordered as without a search

#### Scenario: Opening with the mouse
- **WHEN** the user clicks the gear to open the panel
- **THEN** focus does not move to the search field

#### Scenario: Small grid
- **WHEN** the user opens the field panel on the Customers list (7 fields)
- **THEN** no search field is shown
