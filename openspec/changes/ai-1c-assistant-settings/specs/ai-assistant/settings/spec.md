# Spec Delta

## Purpose

Defines how an organization configures its AI assistant: the persona and instructions an
administrator can set, who may read and change them, their limits, where they sit in what the
model receives, and the guarantee that no organization text can remove the assistant's fixed
boundaries.

## ADDED Requirements

### Requirement: Administrators configure the assistant's persona and instructions
The system SHALL keep, per organization, an assistant persona of at most 500 characters and
assistant instructions of at most 4000 characters, both plain text trimmed of surrounding
whitespace, where an empty value means "not set". An organization that never saved them SHALL
read as both empty. Only a user with the ADMIN role SHALL be able to read or change them —
no screen outside the administrator's editor needs them, and administrators may put internal
wording there. Every change SHALL be
recorded in the organization settings activity without copying the text into the record.

#### Scenario: Administrator saves assistant settings
- **WHEN** an administrator saves a persona and instructions within the limits
- **THEN** reading the assistant settings returns the saved, trimmed values
- **AND** the settings activity shows that the assistant settings were updated

#### Scenario: Regular user tries to change assistant settings
- **WHEN** a user without the ADMIN role tries to save assistant settings
- **THEN** the request is refused as forbidden and the stored values do not change

#### Scenario: Regular user tries to read assistant settings
- **WHEN** a user without the ADMIN role tries to read assistant settings
- **THEN** the request is refused as forbidden

#### Scenario: Text exceeds a limit
- **WHEN** an administrator saves a persona longer than 500 characters or instructions
  longer than 4000 characters
- **THEN** the request is rejected with a validation error naming the offending field and
  nothing is stored

#### Scenario: Organization has never configured the assistant
- **WHEN** an administrator of an organization without saved assistant settings reads them
- **THEN** both persona and instructions are returned empty

#### Scenario: Assistant settings of another organization
- **WHEN** an administrator of one organization reads or saves assistant settings
- **THEN** only their own organization's settings are read or changed

### Requirement: The assistant's fixed boundaries always come first and cannot be removed
The system SHALL send the model the assistant's fixed boundaries — that it has no access to the
user's business data, cannot perform actions, must not invent answers the documentation does not
support, and answers in the language the user wrote in — as the first part of every prompt,
regardless of the organization's settings. Organization persona and instructions SHALL only be
added after the boundaries, clearly separated from them and marked as subordinate, so that no
organization text can replace, precede or remove them.

#### Scenario: Organization text tries to override the boundaries
- **WHEN** the organization's instructions say to ignore all previous instructions and to
  answer questions about the user's customers
- **THEN** the model still receives the unchanged boundaries first
- **AND** the organization text reaches the model only inside the separated organization part
  that states the boundaries take precedence

#### Scenario: Organization text imitates the separator
- **WHEN** the organization's text contains the markers that delimit the organization part
- **THEN** those markers are not passed through, and the organization part still ends where
  the system placed its end

### Requirement: Organization instructions reach every reply in a stable position
When an organization has a non-empty persona or instructions, the system SHALL include them in
the prompt of every assistant reply for that organization, after the fixed boundaries and before
the product documentation, the user context, the conversation history and the question. The
settings in effect when the reply is generated SHALL be used. When both are empty, the prompt
SHALL be exactly what it is without this feature.

#### Scenario: Reply is generated with organization instructions
- **WHEN** a user of an organization with a saved persona asks a question
- **THEN** the backend receives the fixed boundaries first, then the organization's persona and
  instructions, then the documentation, the user context, the history, and the question last

#### Scenario: Organization has no assistant settings
- **WHEN** a user of an organization without persona or instructions asks a question
- **THEN** the backend receives the same prompt as before assistant settings existed

#### Scenario: Stored settings are unreadable
- **WHEN** the organization's stored assistant settings are malformed
- **THEN** the reply is still generated, with the fixed boundaries only

### Requirement: Organization instructions carry no user or business data
The organization's persona and instructions SHALL be the only organization-authored text added
to the prompt; adding them SHALL NOT add any user identity, organization name or business
record to what the model receives. The settings screen SHALL tell the administrator, on the
screen itself, that this text is sent to the AI provider with every question.

#### Scenario: Administrator opens the assistant settings screen
- **WHEN** an administrator opens the assistant settings screen
- **THEN** the screen states that the persona and instructions are sent to the external AI
  provider together with every question

#### Scenario: Prompt for an organization with instructions
- **WHEN** a reply is generated for an organization with saved instructions
- **THEN** the user context in the prompt still contains only the user's role and language
