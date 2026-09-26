# Spec Delta

## MODIFIED Requirements

### Requirement: Switching a field set changes only the visible fields
The system SHALL, on selecting a field-set tab, show exactly that set's fields (non-hideable
fields always included) in the order the set lists them, with pinned fields first and any
non-hideable field the set does not list placed at its declaration position, without
refetching data and without changing search, filters, sort, page, page size, or row selection.

#### Scenario: User switches from Main to Sales
- **WHEN** the user selects the "Sales" tab while on page 3 filtered by status
- **THEN** the table shows the Sales fields and stays on page 3 with the same filter, sort and
  selection

#### Scenario: Set lists fields in a different order than the page
- **WHEN** a field set lists its fields in an order different from the page's field declaration
- **THEN** the table shows those fields in the order the set lists them
