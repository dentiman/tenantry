# Spec Delta

## REMOVED Requirements

### Requirement: The transcript refreshes on demand, not continuously
**Reason**: CHAT-0.1 had no live channel, so freshness depended on window focus, the user's own
send and a manual refresh action. CHAT-0.2a delivers changes live (`chat/live-updates`), which
makes the manual action redundant and the "visible at the next refresh" behaviour wrong.
**Migration**: Replaced by "The Chat area stays current without a reload" below. The manual
refresh action is removed from the conversation header; refreshing on focus remains only as a
fallback.

## ADDED Requirements

### Requirement: The Chat area stays current without a reload
The Chat area SHALL show changes made elsewhere as they happen: another participant's message
SHALL appear in the open transcript, the conversation list SHALL reflect new previews, ordering,
unread indicators and newly created conversations, and reading a conversation in one tab SHALL
clear its unread indicator in the user's other tabs — all without a reload, a focus change or a
manual refresh action. The area SHALL NOT poll on a timer. When the live channel is unavailable,
the area SHALL still converge to the stored state when the window regains focus or the
connection is restored, and SHALL NOT show the same message twice.

#### Scenario: A colleague posts into the open conversation
- **WHEN** another participant posts a message while the user has that conversation open and
  scrolled to the end
- **THEN** the message appears at the end of the transcript without any action by the user, and
  the conversation is not left marked as unread

#### Scenario: A colleague posts into another conversation
- **WHEN** another participant posts into a conversation that is not open
- **THEN** the conversation list moves it to the top with the new preview and an increased
  unread indicator

#### Scenario: The user sends a message
- **WHEN** the user sends a message and its confirmation and its live notice both arrive
- **THEN** the transcript contains exactly one entry for it, and the conversation list reflects
  the new preview and ordering

#### Scenario: The live channel is unavailable
- **WHEN** the live connection is down and the user sends a message
- **THEN** the message is still confirmed in the transcript, and messages from others appear
  once the window regains focus or the connection returns

#### Scenario: The window is left open and untouched
- **WHEN** the window stays focused and nothing changes in the user's conversations
- **THEN** the client issues no repeated background requests for chat
