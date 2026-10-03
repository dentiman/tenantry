## ADDED Requirements

### Requirement: Offline source preview

The system SHALL preview a configured Markdown source without database writes or remote API calls.

#### Scenario: Preview a checkout

- **WHEN** an operator supplies an existing root and valid manifest
- **THEN** the report lists admitted documents, rejected paths with reasons, content hashes,
  chunk counts and token counts for the configured embedding profile

### Requirement: Explicit publication and audience admission

The system SHALL reject unpublished, unknown-language, unknown-audience and disallowed-path documents.

#### Scenario: Draft without exact approval

- **WHEN** the default current-or-approved policy applies and a document is draft without an unexpired approval matching its path and content hash
- **THEN** it is rejected

#### Scenario: Symlink inside a source

- **WHEN** a discovered entry is a symbolic link
- **THEN** it is rejected without reading or following its target

### Requirement: Deterministic bounded chunks

Each chunk SHALL fit the configured token budget including its heading prefix and preserve Unicode text.

#### Scenario: Repeated preview

- **WHEN** source content and manifest are unchanged on the same approval date
- **THEN** chunk hashes, source revision and token totals are identical

### Requirement: Explicit test corpus policy

The system SHALL allow an explicit all-for-testing status policy without changing the default current-or-approved policy. Language, document type, path, audience and publication checks SHALL remain enforced.

#### Scenario: Business corpus across statuses

- **WHEN** the FMS test manifest selects all-for-testing
- **THEN** current, draft, historical, other and absent statuses and the draft flag do not exclude documents
- **AND** Russian translations, engineering, workbench and non-business document types are excluded
- **AND** the test corpus maps its known audiences explicitly to ADMIN

#### Scenario: Test mode does not publish forbidden content

- **WHEN** a document has publish false or fails language, document type, path or audience admission
- **THEN** it remains rejected under all-for-testing
