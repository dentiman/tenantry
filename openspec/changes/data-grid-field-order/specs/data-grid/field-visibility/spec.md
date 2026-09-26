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
