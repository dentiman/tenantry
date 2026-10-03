# ai-assistant/knowledge-citations Specification

## Purpose
Defines retrieval-grounded assistant answers: excerpts retrieved from the published index for the user's role, citations limited to excerpts actually given to the model, and re-authorized access to a citation's text.

## Requirements

### Requirement: Retrieval-grounded answers

In postgres knowledge mode the system SHALL answer from excerpts retrieved from the published
index of the configured product, filtered by the user's role and tenant.

#### Scenario: Relevant excerpts found

- **WHEN** a user asks a question covered by visible documentation
- **THEN** the prompt contains at most the configured number of excerpts within the token budget, and no static corpus

#### Scenario: Nothing visible

- **WHEN** no published excerpt is visible to the user's role
- **THEN** the prompt states that no documentation matched and the answer says so instead of guessing

#### Scenario: Embedding unavailable

- **WHEN** the question embedding fails
- **THEN** the reply fails with a provider error and no generation happens

### Requirement: Verified citations

The system SHALL show only citations that refer to excerpts actually given to the model for
that reply.

#### Scenario: Invented reference

- **WHEN** the answer contains a citation number that was not supplied
- **THEN** that number is not listed as a citation

### Requirement: Re-authorized citation access

The system SHALL return a citation's text only to the reply owner and only while the excerpt is
still published and visible to the owner's current role.

#### Scenario: Revoked access

- **WHEN** the excerpt was unpublished or its audience no longer includes the user's role
- **THEN** opening the citation returns not found
