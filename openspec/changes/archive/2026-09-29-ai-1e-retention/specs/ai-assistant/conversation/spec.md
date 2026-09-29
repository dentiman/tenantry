# Spec Delta

## ADDED Requirements

### Requirement: Conversations older than the retention window are purged automatically
The system SHALL periodically and permanently delete every AI conversation, across every
tenant, whose most recent activity is older than a configured retention period, along with
that conversation's messages. The retention period SHALL default to 90 days and SHALL be
configurable for the installation. This deletion SHALL be a hard delete: no soft-delete marker
or archived copy SHALL remain.

#### Scenario: A conversation past the retention window is purged
- **WHEN** the periodic purge runs and a conversation's most recent activity is older than the
  configured retention period
- **THEN** that conversation and its messages are permanently removed

#### Scenario: A recently active conversation is not purged
- **WHEN** the periodic purge runs and a conversation's most recent activity is within the
  configured retention period
- **THEN** that conversation and its messages are left untouched

#### Scenario: The purge is not limited to one tenant
- **WHEN** more than one tenant has conversations past the retention window at the same time
- **THEN** every one of them is purged by the same run, not only the first tenant found

### Requirement: A user can permanently delete all of their own conversations
The system SHALL let a user immediately and permanently delete all of their own AI
conversations and messages in a single action, without involving any background job. This
deletion SHALL be scoped to the requesting user within their tenant: it SHALL NOT delete any
conversation belonging to another user, including another user in the same tenant, and SHALL
NOT delete any conversation belonging to another tenant.

#### Scenario: User deletes their conversation history
- **WHEN** a user requests deletion of all of their conversations
- **THEN** all of that user's conversations and messages are permanently removed immediately,
  and the request does not need to wait for a background job

#### Scenario: Deleting does not affect another user in the same tenant
- **WHEN** a user requests deletion of all of their conversations
- **THEN** conversations belonging to any other user in the same tenant are left untouched

#### Scenario: Deleting does not affect another tenant
- **WHEN** a user requests deletion of all of their conversations
- **THEN** conversations belonging to users of any other tenant are left untouched

#### Scenario: A new conversation is created on demand after deleting
- **WHEN** a user who just deleted all of their conversations asks a question or opens the
  assistant afterwards
- **THEN** the system creates a fresh, empty active conversation for them, the same way it
  would for a user who has never used the assistant
