## ADDED Requirements

### Requirement: Selectable search mode

The system SHALL retrieve excerpts in the configured mode: vector, full-text or hybrid, always
under tenant RLS with product, publication and role filters.

#### Scenario: Full-text mode

- **WHEN** the mode is full-text
- **THEN** no embedding request is made and excerpts sharing terms with the question are returned

#### Scenario: Hybrid degradation

- **WHEN** the mode is hybrid and the embedding request fails
- **THEN** full-text results are used and the degradation is logged

### Requirement: Relevance threshold

The system SHALL drop vector candidates farther than the configured maximum distance.

#### Scenario: Unrelated question

- **WHEN** no candidate is within the threshold and no text matches
- **THEN** the prompt receives the explicit "nothing found" block

### Requirement: Retrieval evaluation

The system SHALL provide an operator command that evaluates retrieval modes on a versioned
question set and reports recall, rank, abstention and latency.

#### Scenario: Mode comparison

- **WHEN** the operator runs the evaluation
- **THEN** every configured mode is measured on the same questions and the results are reported side by side
