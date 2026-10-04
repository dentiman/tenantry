## ADDED Requirements

### Requirement: Runtime AI settings managed by the superadmin

The system SHALL let a platform operator set the provider, base URL, model and API key of the
assistant, and SHALL apply a saved change to subsequent replies without restarting any process.
Values not set by the operator SHALL fall back to the deployment environment.

#### Scenario: Model change applies without restart

- **WHEN** the operator saves a different model
- **THEN** the next generated reply uses that model and records it

#### Scenario: Fresh installation

- **WHEN** no operator settings exist
- **THEN** the assistant behaves exactly as configured by the environment

### Requirement: Encrypted API key with audited reveal

The system SHALL store the API key only encrypted, SHALL return it masked on every ordinary read,
and SHALL return the plaintext only through an explicit reveal action that is recorded with the
operator and time.

#### Scenario: Reading settings

- **WHEN** the operator opens the settings
- **THEN** the key is shown masked and the response contains no plaintext key

#### Scenario: Revealing the key

- **WHEN** the operator reveals the key
- **THEN** the plaintext is returned and a reveal event naming the operator is stored

### Requirement: Three-level availability

The assistant SHALL be available to a tenant's users only when the installation enables it, the
platform switch is on, the platform allows that tenant, and the tenant administrator has it on.

#### Scenario: Tenant administrator switches the assistant off

- **WHEN** a tenant administrator turns the assistant off
- **THEN** that tenant's users no longer see the assistant and assistant requests are refused

#### Scenario: Platform withdraws a tenant's permission

- **WHEN** the operator disallows a tenant
- **THEN** the tenant administrator cannot turn the assistant on and queued replies are cancelled without a model call
