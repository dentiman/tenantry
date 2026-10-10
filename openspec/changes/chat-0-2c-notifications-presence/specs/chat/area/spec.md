# Spec Delta

## ADDED Requirements

### Requirement: A direct conversation shows whether the other person is online
In a conversation with exactly two participants, the conversation list and the open conversation
SHALL show an online indicator for the other participant while they are online. An offline or
unknown presence SHALL show no indicator, and a conversation with more than two participants SHALL
show none. The indicator SHALL follow presence changes without a reload.

#### Scenario: The other person is online
- **WHEN** the user views a two-person conversation whose other participant is online
- **THEN** the list entry and the conversation header show the online indicator

#### Scenario: The other person goes offline
- **WHEN** the other participant disconnects while the user is looking at the conversation
- **THEN** the indicator disappears without a reload

#### Scenario: Presence is unknown
- **WHEN** the presence service is unavailable
- **THEN** no indicator is shown, rather than a state that reads as offline

#### Scenario: A group conversation
- **WHEN** the user views a conversation with more than two participants
- **THEN** no online indicator is shown for it
