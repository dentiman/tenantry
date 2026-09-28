# Spec Delta

## ADDED Requirements

### Requirement: A reply for a retired conversation is never generated
The system SHALL, before generating a reply, check whether the conversation that reply belongs
to has already been retired. If it has, the system SHALL mark that reply as cancelled and SHALL
NOT build a prompt for it or consult the model backend.

#### Scenario: A conversation is retired while its reply is still queued
- **WHEN** a user starts a new conversation (retiring the previous one) while a reply in the
  previous conversation is still pending generation
- **THEN** that reply is marked cancelled without the model backend ever being consulted for it

#### Scenario: A reply for the active conversation is unaffected
- **WHEN** generation begins for a reply whose conversation is still active
- **THEN** generation proceeds normally and the model backend is consulted
