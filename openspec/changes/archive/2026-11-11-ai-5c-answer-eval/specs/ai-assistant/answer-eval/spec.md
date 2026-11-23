## ADDED Requirements

### Requirement: Answers are evaluated through the production pipeline
The system SHALL provide a local command that answers every question of a given question set
for every configuration of a given configuration file through the same retrieval and prompt
assembly the assistant uses in production, without creating conversations or messages.

#### Scenario: Two configurations compared
- **WHEN** the operator runs the command with a question set of N questions and two configurations
- **THEN** 2 × N answers are produced and the report shows each configuration's results side by side

#### Scenario: No conversation data touched
- **WHEN** an evaluation runs
- **THEN** no conversation or message rows are written and no user's conversation is read

### Requirement: Answer quality is measured
The system SHALL check every answer for valid citations, citation of an expected page, numbers
grounded in the excerpts or the question, refusal on unanswerable questions, answer language and
truncation, and SHALL score answers with an LLM judge when one is requested.

#### Scenario: Fabricated citation number
- **WHEN** an answer cites a number that does not correspond to a sent excerpt
- **THEN** the answer fails the citation-validity check

#### Scenario: Unanswerable question
- **WHEN** a question has no expected pages and the answer cites documentation
- **THEN** the answer fails the refusal check

### Requirement: Cost per answer is reported and recorded
The system SHALL report the average cost per answer for every configuration from provider-reported
usage, report judge cost separately, record every provider call in the cost ledger as evaluation
spending, and stop before or during a run that would exceed a given budget.

#### Scenario: Budget exceeded during a run
- **WHEN** the reported cost of a run crosses the given limit
- **THEN** the run stops and the partial report is written
