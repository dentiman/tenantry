## ADDED Requirements

### Requirement: An inbound reaction is stored with its emoji and does not open the reply window
A Meta webhook message of type `reaction` SHALL be stored as an inbound message whose payload carries the emoji
(or no emoji, when the customer removed the reaction) and whose body is the placeholder `[reaction]`. The
transcript SHALL render it as "Reacted <emoji>" or "Removed a reaction". Unlike any other inbound message, it
SHALL NOT set or extend the customer's last-message time, so the 24-hour reply window is not opened by it.

#### Scenario: A reaction with an emoji
- **WHEN** a webhook carries a reaction with the emoji 👍
- **THEN** one inbound message is stored with that emoji and the transcript shows "Reacted 👍"

#### Scenario: A removed reaction
- **WHEN** a webhook carries a reaction without an emoji
- **THEN** the transcript shows "Removed a reaction"

#### Scenario: A reaction does not open the window
- **WHEN** a conversation has no earlier inbound message and the customer sends a reaction
- **THEN** the customer's last-message time stays empty
