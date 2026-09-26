# Spec Delta

## MODIFIED Requirements

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
- **WHEN** the user activates the gear button on the Customers list with "Main" active
- **THEN** a panel opens with Shown listing the Main fields in display order, each checked, and
  Hidden listing "Tags", unchecked

#### Scenario: Field declared non-hideable
- **WHEN** a page declares a field as not hideable (e.g. the row-header name field)
- **THEN** that field is always shown and appears in Shown with a locked checkbox that cannot
  be unchecked

#### Scenario: Toggled field moves between sections
- **WHEN** the user unchecks "Phone" in Shown
- **THEN** "Phone" moves to Hidden at its declaration position and the panel stays open

## ADDED Requirements

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
