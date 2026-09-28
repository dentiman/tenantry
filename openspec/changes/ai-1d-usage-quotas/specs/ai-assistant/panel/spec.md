# Spec Delta

## ADDED Requirements

### Requirement: A quota rejection is shown as its own distinguishable state
When a question is rejected because a usage quota was exceeded, the panel SHALL present that
outcome as its own clearly labelled state, distinguishable from a generic error, rather than
folding it into the panel's generic error handling for a failed request.

#### Scenario: A user's question is rejected for exceeding a quota
- **WHEN** the panel receives a quota-exceeded rejection in response to a submitted question
- **THEN** it shows a state that specifically communicates the quota was reached, distinct
  from how it presents an unrelated failed request

#### Scenario: A question fails for an unrelated reason
- **WHEN** a question fails for a reason other than a usage quota
- **THEN** the panel's existing generic error handling applies, unchanged
