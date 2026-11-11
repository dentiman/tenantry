# Spec Delta

## Purpose

Defines what an unauthenticated visitor sees and can do on the sign-in pages of the tenant portal
and the platform control plane, including the demo-account shortcuts used on the demo stand.

## ADDED Requirements

### Requirement: Tenant sign-in field order
The tenant sign-in form SHALL present its fields in the order Email, Password, Organization
(optional). The Organization field SHALL keep its label and meaning: empty means the default
tenant of the installation. The submit button and the "Forgot password?" link SHALL follow the
fields.

#### Scenario: Organization is the last field
- **WHEN** a visitor opens the tenant sign-in page
- **THEN** the first field is Email, the second is Password and the last is "Organization (optional)"

### Requirement: Demo accounts are offered on the sign-in pages
While demo sign-in is enabled, each sign-in page SHALL show a "Demo accounts" block listing the
demo accounts of its plane, and SHALL open with the form prefilled with the first demo account.
On the tenant portal the accounts SHALL be grouped by tenant, the tenant name shown as the group
caption, and each entry SHALL read `<role label> · <name>`. On the platform console the block
SHALL list the single demo operator. The listed accounts and credentials SHALL come from the one
shared demo-account list that the demo seed also uses.

#### Scenario: Tenant form is prefilled with the flagship account
- **WHEN** a visitor opens the tenant sign-in page with demo sign-in enabled
- **THEN** Email, Password and Organization already contain the first demo account (tenant
  `northwind`), and the visitor can sign in by pressing Sign in without typing

#### Scenario: Platform form is prefilled with the demo operator
- **WHEN** a visitor opens the platform sign-in page with demo sign-in enabled
- **THEN** Email and Password already contain the demo operator, and a single "Operator" entry is
  listed under Demo accounts

### Requirement: One-click demo sign-in uses the normal sign-in
Choosing a demo account SHALL fill the form with that account and submit it immediately through
the same sign-in request and error handling as a manual sign-in. There SHALL be no separate
backend path for demo sign-in; a demo account that does not exist in the database SHALL fail
exactly like wrong credentials typed by hand.

#### Scenario: Clicking an existing demo account signs in
- **WHEN** a visitor clicks the "Default Tenant" demo entry and that account exists
- **THEN** the visitor is signed in and lands on the workspace

#### Scenario: Clicking a missing demo account shows the normal error
- **WHEN** a visitor clicks a demo entry whose account is not seeded
- **THEN** the form shows the same invalid-credentials error as a manual sign-in and the visitor
  stays on the sign-in page

### Requirement: Demo sign-in can be switched off without code changes
Setting the build-time variable `VITE_DEMO_LOGINS` to `false` SHALL remove the Demo accounts
block and the prefill from both sign-in pages, leaving an empty form. Any other value, or no
value, SHALL keep demo sign-in enabled.

#### Scenario: Demo sign-in disabled
- **WHEN** a frontend is built with `VITE_DEMO_LOGINS=false` and a visitor opens its sign-in page
- **THEN** no Demo accounts block is shown and every field of the form is empty
