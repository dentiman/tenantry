# customers/export Specification

## Purpose
Lets a user take the customer list they are looking at out of the product as a CSV file, without
waiting on the page for it to be built.

## Requirements

### Requirement: Export uses the filters of the customer grid
A user SHALL be able to export customers with the same filters and sort the customer list accepts
(status, kind, owner, tag, search, archived, sort). The export SHALL contain every matching
customer, not only the current page, and SHALL run as a user operation.

#### Scenario: Export of a filtered list
- **WHEN** a user exports with the filter status ACTIVE and the search "Acme"
- **THEN** the file contains exactly the customers the list shows for that filter, across all pages

### Requirement: The file is safe to open in a spreadsheet
The file SHALL be UTF-8 CSV with a header row and a byte-order mark, so spreadsheet software reads
non-Latin text correctly. A cell whose value starts with `=`, `+`, `-`, `@`, a tab or a carriage
return SHALL be written so that a spreadsheet treats it as text, not as a formula.

#### Scenario: A name that looks like a formula
- **WHEN** a customer is named `=HYPERLINK("http://example.com")`
- **THEN** the exported cell is shown as that text and is not evaluated

### Requirement: The columns describe the customer as the list does
The file SHALL contain, per customer: number as displayed, name, kind, status, email, phone,
owner email, tags and creation time in UTC ISO 8601. Column headers SHALL be English.

#### Scenario: Header row
- **WHEN** the file is opened
- **THEN** the first row names the columns listed above

### Requirement: Exports have an upper bound
An export SHALL contain at most 50,000 customers. A request whose filter matches more SHALL be
refused before any work is queued, with a validation error that states the limit.

#### Scenario: Too many customers
- **WHEN** a filter matches 60,000 customers
- **THEN** the request is rejected with a validation error and no operation is created

### Requirement: Export respects who may see customers
The export SHALL contain only customers the user may see in the list.

#### Scenario: Another tenant's customers
- **WHEN** a user exports without filters
- **THEN** no customer of another tenant is in the file
