# Spec Delta

## Purpose

Lets a list page offer named, task-oriented sets of visible fields as tabs, and keeps a user's
own field edits in a single remembered Custom set instead of silently altering a preset.

## ADDED Requirements

### Requirement: Pages offer named field sets shown as tabs
The system SHALL let a list page offer an ordered set of named field sets, each a label and the
list of fields it shows. The first offered set SHALL be the default. The grid SHALL render the
sets as tabs labelled with their names, in the offered order, with the active set's tab
selected. A page that offers no field sets SHALL show no field-set tabs.

#### Scenario: First visit to a list with field sets
- **WHEN** a user with no stored preference opens a list whose page offers field sets "Main"
  and "Sales"
- **THEN** tabs "Main" and "Sales" are shown, "Main" is selected, and the table shows exactly
  the fields of "Main" plus any non-hideable fields

#### Scenario: Field-set tabs are keyboard-operable
- **WHEN** the user focuses the field-set tabs and uses the arrow keys and Enter/Space
- **THEN** focus moves between tabs and the chosen tab becomes the active field set

#### Scenario: Tabs sit directly above the table on tenant lists
- **WHEN** the user opens the Customers or Users list
- **THEN** the field-set tabs are the last element before the table, below the filter toolbar,
  adjoining the table's header

### Requirement: Switching a field set changes only the visible fields
The system SHALL, on selecting a field-set tab, show exactly that set's fields (non-hideable
fields always included) in the page's declared field order, without refetching data and
without changing search, filters, sort, page, page size, or row selection.

#### Scenario: User switches from Main to Sales
- **WHEN** the user selects the "Sales" tab while on page 3 filtered by status
- **THEN** the table shows the Sales fields and stays on page 3 with the same filter, sort and
  selection

#### Scenario: Set lists fields in a different order than the page
- **WHEN** a field set lists its fields in an order different from the page's field declaration
- **THEN** the table shows those fields in the page's declared order

### Requirement: Editing fields on a preset moves the user to a single Custom set
Offered field sets are presets and SHALL NOT be modified by the user. When the user toggles a
field in the gear menu while a preset is active, the system SHALL create (or replace) one
Custom set for that grid, starting from the active preset's fields with the toggle applied,
make Custom the active set, and show a "Custom" tab after the preset tabs. While Custom is
active, further toggles SHALL update Custom in place.

#### Scenario: First edit on a preset
- **WHEN** "Sales" is active and the user unchecks "Tags" in the gear menu
- **THEN** a "Custom" tab appears and becomes selected, the table shows the Sales fields
  without Tags, and the Sales preset itself is unchanged

#### Scenario: Further edits on Custom
- **WHEN** Custom is active and the user checks "Phone"
- **THEN** Phone is added to the Custom set and Custom stays selected

#### Scenario: Editing a preset replaces an earlier Custom
- **WHEN** a Custom set exists, the user selects "Main" and then toggles a field
- **THEN** Custom is rebuilt from Main's fields with that toggle applied and becomes active

#### Scenario: Custom made identical to a preset
- **WHEN** the user's edits make Custom's fields identical to a preset's
- **THEN** Custom stays the active set; the system does not switch tabs on its own

### Requirement: Custom set is remembered alongside presets
The system SHALL keep the Custom set available as a tab after the user switches to a preset,
and SHALL restore Custom's fields unchanged when its tab is selected again.

#### Scenario: Round trip between Custom and a preset
- **WHEN** Custom is active, the user selects "Main", then selects "Custom" again
- **THEN** the table shows the Custom fields exactly as they were before

### Requirement: Reset returns to the default set and discards Custom
Choosing "Reset to default" in the gear menu on a grid with field sets SHALL activate the
default (first) set and remove the Custom set and its tab.

#### Scenario: Reset with a Custom set
- **WHEN** Custom is active and the user chooses "Reset to default"
- **THEN** the first field set is selected, its fields are shown, and the Custom tab is gone

### Requirement: Active set and Custom persist per browser per grid
The system SHALL remember which set is active and the Custom set's fields in the browser per
grid and restore them on the next visit. For a remembered preset only its identity SHALL be
stored: its fields SHALL always come from the page's current definition. A remembered set the
page no longer offers SHALL fall back to the default set. Set field ids the page does not
declare SHALL be ignored.

#### Scenario: Active preset survives reload
- **WHEN** the user selects "Sales" and reloads the page
- **THEN** "Sales" is selected and its fields are shown

#### Scenario: Preset contents change in a new release
- **WHEN** "Sales" was remembered and a new release changes which fields Sales shows
- **THEN** after reload "Sales" is selected and shows the new release's fields

#### Scenario: Custom survives reload
- **WHEN** the user has an active Custom set and reloads the page
- **THEN** the "Custom" tab is shown, selected, with the same fields

#### Scenario: Remembered set was removed from the page
- **WHEN** the remembered set id is not among the page's offered field sets
- **THEN** the default set is selected and the list renders without error
