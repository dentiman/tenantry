# Spec Delta

## MODIFIED Requirements

### Requirement: The token usage of each reply is recorded
The system SHALL record, with each reply, the model that produced it and the number of input,
cached-input and output tokens the backend reported for it, in the same write that stores the
reply's final state. Usage SHALL be taken from the attempt that produced the stored content
only. A reply for which the backend reported no usage SHALL be stored with the usage left
empty rather than estimated; the same applies to any usage figure the backend did not report
for an otherwise-usaged reply, including the cached-input count. The built-in test backend
SHALL report usage too, so that anything built on recorded usage can be exercised without
credentials or network access.

#### Scenario: A reply completes on an external backend
- **WHEN** an external backend finishes a reply and reports its token usage in the final part
  of the stream
- **THEN** the stored reply carries that input and output token count and the model the
  backend reports having used

#### Scenario: A reply completes on the built-in test backend
- **WHEN** the built-in test backend finishes a reply
- **THEN** the stored reply carries a non-zero input and output token count and the
  configured model name

#### Scenario: A reply is regenerated after a transient failure
- **WHEN** a reply fails transiently on its first attempt and completes on the next
- **THEN** the stored usage is that of the completing attempt, not a sum and not the failed
  attempt's

#### Scenario: The backend reports no usage
- **WHEN** a reply ends without the backend having reported usage, for example because it
  was stopped by the user
- **THEN** the reply's token counts are left empty and the reply's final state is stored as
  usual

#### Scenario: A reply is served partly from the backend's cache
- **WHEN** an external backend reports that some of a reply's input tokens were served from
  its prompt cache
- **THEN** the stored reply carries that cached-input count alongside its input and output
  counts

#### Scenario: The backend does not report a cache breakdown
- **WHEN** a backend reports input and output tokens for a reply but not how many of the
  input tokens came from its cache
- **THEN** the reply's cached-input count is left empty, and its input and output counts are
  still stored as reported
