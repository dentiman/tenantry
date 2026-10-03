## ADDED Requirements

### Requirement: Atomic tenant-scoped ingestion

The system SHALL stage documents and embeddings under tenant RLS and publish only a complete snapshot.

#### Scenario: Embedding failure

- **WHEN** embedding generation fails
- **THEN** the previously published revision remains searchable

#### Scenario: Superseded run

- **WHEN** a newer import claims the same source
- **THEN** the older run cannot write or publish its staging revision

### Requirement: Reuse embeddings

The system SHALL reuse same-source same-profile content hashes without crossing tenants.

#### Scenario: Unchanged import

- **WHEN** the active revision matches the requested snapshot
- **THEN** no embedding API is called

### Requirement: Text vector search

The system SHALL embed a bounded question and return published product/role-filtered citations from PostgreSQL.

#### Scenario: No access

- **WHEN** the selected role has no permitted documents
- **THEN** no document content is returned
