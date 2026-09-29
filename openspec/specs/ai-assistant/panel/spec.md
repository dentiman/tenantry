# ai-assistant/panel Specification

## Purpose

Gives the tenant portal a persistent, non-modal AI assistant column that a user can keep open
while they work, so asking the assistant never costs them their place in the application, and
makes it unmistakable in the interaction itself that the answers come from an AI.

## Requirements

### Requirement: AI panel is a persistent shell column, not an overlay
The system SHALL render the AI panel as the rightmost column of the tenant app shell, to the
right of the Context Panel. When open it SHALL reduce the width available to the main content
rather than covering it, and SHALL NOT dim, block, or otherwise make the rest of the
application unusable.

#### Scenario: User opens the AI panel while working on a page
- **WHEN** the user opens the AI panel from a page with interactive content
- **THEN** the panel appears at the right edge of the window, the page content reflows into
  the remaining width, and every control on that page stays visible and clickable

#### Scenario: AI panel and Context Panel are open together
- **WHEN** the Context Panel is already open and the user opens the AI panel
- **THEN** both panels are shown side by side, with the AI panel outermost, and neither
  closes the other

### Requirement: AI panel survives navigation
The system SHALL keep the AI panel's open/closed state and its on-screen conversation
independent of the current route, so that moving between areas neither closes the panel nor
clears what is displayed in it.

#### Scenario: User navigates to another area with the panel open
- **WHEN** the user has the AI panel open with messages visible and navigates to a different
  area of the application
- **THEN** the panel is still open after the navigation and still shows the same messages

#### Scenario: Panel state survives a reload
- **WHEN** the user reloads the browser with the AI panel open
- **THEN** the panel is open after the reload and shows the current conversation's transcript

### Requirement: AI panel is toggled from a dedicated header control
The system SHALL provide a control in the application header, separate from the Context Panel
control, that opens and closes the AI panel.

#### Scenario: User toggles the panel
- **WHEN** the user activates the AI panel control in the header
- **THEN** the panel opens if it was closed and closes if it was open, without navigating away
  from the current page

### Requirement: AI panel discloses that answers come from an AI
The system SHALL show, within the AI panel itself, a persistently visible statement that the
user is interacting with an AI assistant and that its answers can be wrong. This disclosure
SHALL NOT be satisfied by documentation, terms, or a one-time dismissible notice.

#### Scenario: User opens the panel for the first time
- **WHEN** the user opens the AI panel
- **THEN** the disclosure is visible without scrolling, both when the conversation is empty
  and when it contains messages

### Requirement: Assistant answers are rendered as safe formatted text
The system SHALL render assistant answers as formatted text (at minimum paragraphs, lists,
inline code, and code blocks) and SHALL NOT execute or render raw HTML or scripts contained in
a model's answer.

#### Scenario: Answer contains markup that would execute if trusted
- **WHEN** an assistant answer contains raw HTML or a script fragment
- **THEN** it is displayed as literal text and nothing from the answer executes in the browser

### Requirement: AI panel is absent when the assistant is disabled
The system SHALL NOT render the AI panel or its header control when the AI assistant is
disabled for the installation.

#### Scenario: Assistant disabled for the installation
- **WHEN** the AI assistant is disabled and the user loads the application
- **THEN** no AI panel control appears in the header and no AI panel can be opened

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
