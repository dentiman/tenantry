# Spec Delta

## ADDED Requirements

### Requirement: A participant can announce that they are viewing a conversation
A connected user SHALL be able to announce that a conversation is open in front of them, and
to withdraw that announcement. The announcement SHALL be accepted only for a conversation the
user is an active participant of, by the same rule that governs reading it: a conversation that
does not exist, belongs to another tenant, or that the user does not or no longer takes part in
SHALL be refused identically, so that the answer never confirms the conversation exists. An
announcement SHALL affect only the connection that made it, SHALL NOT change which message and
conversation notices the user receives, and SHALL be withdrawable at any time, including for a
conversation that was never announced. A single connection SHALL be limited to a small number of
announced conversations; a further one SHALL be refused.

#### Scenario: A participant announces a conversation
- **WHEN** an active participant announces that they are viewing a conversation
- **THEN** the announcement is accepted and the connection counts as viewing that conversation

#### Scenario: A non-participant of the same tenant announces it
- **WHEN** a user who does not take part in a conversation announces it
- **THEN** the request is refused exactly as for a conversation that does not exist, and the
  connection does not count as viewing it

#### Scenario: A user of another tenant announces it
- **WHEN** a user of a different tenant announces a conversation identifier from this tenant
- **THEN** the request is refused exactly as for a conversation that does not exist

#### Scenario: A former participant announces it
- **WHEN** a user who has left a conversation announces it
- **THEN** the request is refused exactly as for a conversation that does not exist

#### Scenario: The announcement is withdrawn
- **WHEN** a user withdraws the announcement, or withdraws one they never made
- **THEN** the request succeeds and the connection no longer counts as viewing that conversation

#### Scenario: Announcing does not gate messages
- **WHEN** a participant has not announced a conversation and another participant posts into it
- **THEN** the participant still receives the message notice and the conversation changes

#### Scenario: Too many conversations are announced from one connection
- **WHEN** a connection that already holds the maximum number of announced conversations announces
  another
- **THEN** the request is refused and the connection's existing announcements are unaffected

### Requirement: Typing indications are ephemeral and reach only viewers
A connection that is viewing a conversation SHALL be able to signal that its user is typing. The
signal SHALL be relayed to the other connections viewing the same conversation, identifying the
conversation, the user and the moment the indication lapses, and SHALL NOT be delivered to
anyone who is not viewing it, including participants who have not announced it. A signal from a
connection that is not viewing the conversation SHALL be refused. A typing indication SHALL NOT be
stored: it leaves no trace in the transcript, the conversation, the unread counts or any record
that survives a reload, and it SHALL lapse on its own if not renewed. Signals sent more often
than the published limit SHALL be dropped without affecting the connection.

#### Scenario: A viewer sees that a colleague is typing
- **WHEN** one participant who is viewing a conversation signals typing
- **THEN** the other participants viewing it receive an indication naming the typist

#### Scenario: A participant who is not viewing the conversation
- **WHEN** a participant has the application open but has not announced the conversation and
  another participant signals typing in it
- **THEN** that participant receives no indication

#### Scenario: A signal from a connection that is not viewing
- **WHEN** a connection signals typing in a conversation it has not announced
- **THEN** the signal is refused and nobody receives an indication

#### Scenario: Typing leaves no trace
- **WHEN** a participant signals typing and then sends nothing
- **THEN** the transcript, the conversation preview and every unread count are unchanged, and a
  reload shows nothing about the signal

#### Scenario: The indication lapses
- **WHEN** a typing signal is not renewed
- **THEN** it carries a lapse time after which clients stop showing it, without a further message

#### Scenario: A flood of signals
- **WHEN** a connection sends typing signals faster than the limit allows
- **THEN** the excess signals are dropped and the connection stays usable

### Requirement: The read position can be reported over the live connection
A connected user SHALL be able to report how far they have read a conversation over the live
connection, with exactly the effect and restrictions of reporting it by request: the position
moves only towards newer messages, only for the reporting user, only for a conversation they take
part in, and a stale position succeeds without moving it. The user's other open tabs and devices
SHALL be told when the position really moved, and SHALL NOT be told when it did not. The
outcome SHALL be acknowledged to the reporting connection.

#### Scenario: A participant reports a position live
- **WHEN** a participant reports a newer position over the live connection
- **THEN** the position and unread count change exactly as if it had been reported by request,
  the report is acknowledged, and the user's other tabs are told

#### Scenario: A stale position is reported live
- **WHEN** a participant reports a position older than the recorded one
- **THEN** the report succeeds, nothing moves and no tab is told

#### Scenario: A non-participant reports a position
- **WHEN** a user who does not take part in a conversation reports a position for it
- **THEN** the report is refused exactly as for a conversation that does not exist and nothing
  changes

### Requirement: Invalid or excessive live requests are refused without side effects
Every request a client makes over the live connection SHALL be checked before anything is done:
a request whose content does not match its published shape SHALL be refused, a connection that
exceeds the published rate for an event SHALL have the excess refused, and any other failure SHALL
be refused with a closed set of machine-readable reasons that disclose no internal detail. A
refused request SHALL change nothing, and a connection SHALL remain usable after one. Every
request SHALL run with the connected user's identity and tenant, never with one supplied by the
client.

#### Scenario: A malformed request
- **WHEN** a client sends a request with a missing or wrongly typed field
- **THEN** it is refused as invalid, nothing changes and the connection stays open

#### Scenario: A request for another tenant
- **WHEN** a client names a conversation of another tenant in any live request
- **THEN** it is refused exactly as for a conversation that does not exist

#### Scenario: A burst beyond the limit
- **WHEN** a connection exceeds the rate limit for an event
- **THEN** the excess requests are refused as rate limited and the earlier ones keep their effect

#### Scenario: An unexpected failure
- **WHEN** handling a request fails for a reason the client did not cause
- **THEN** the client receives a generic refusal without internal detail, and the failure is
  recorded on the server
