# app-shell/navigation Specification

## Purpose

Defines the navigation a signed-in user sees in the tenant portal and the platform control plane —
the areas of the rail and the items of an area's menu — in what order, which area is active, and
guarantees that what the navigation offers matches the pages the user is allowed to open.

## Requirements

### Requirement: Navigation shows only what the user may open
The system SHALL show a rail area or a menu item only when the current user is allowed to open the
page it leads to. The same rule SHALL decide both the visibility of the entry and whether direct
navigation to its page is admitted, so that no visible entry leads to a page that turns the user
away and no admitted page is hidden by a stricter navigation rule.

#### Scenario: Regular user does not see organization settings
- **WHEN** a tenant user with role USER is signed in
- **THEN** the rail does not show the Settings area and no menu shows a link to any `/settings`
  page

#### Scenario: Admin sees organization settings
- **WHEN** a tenant user with role ADMIN is signed in
- **THEN** the rail shows the Settings area and its menu shows General, Calendar, Numbering, AI
  assistant and Activity

#### Scenario: Visible entry always opens
- **WHEN** any signed-in user clicks any rail area or menu item that is visible to them
- **THEN** the target page opens and the user is not redirected elsewhere

### Requirement: An area whose menu is empty for the user is hidden
The system SHALL hide from the rail an area whose second column is a menu when none of that menu's
items is visible to the current user, even if the area's own home page would admit them. Areas
whose second column is not a menu (conversations, calendar, guide contents) SHALL be governed by
their home page alone.

#### Scenario: Every item of a menu area is restricted
- **WHEN** all items of a menu area lead to pages the current user may not open
- **THEN** the rail does not show that area

### Requirement: A page the user may not open redirects to the portal home
The system SHALL redirect a signed-in user who navigates directly (typed URL, bookmark, link) to a
page they are not allowed to open to the home of the portal, and SHALL redirect a guest to the
sign-in page. The backend remains the enforcing boundary; this redirect is a usability guarantee.

#### Scenario: Regular user opens a settings URL directly
- **WHEN** a tenant user with role USER opens `/settings/numbering` by URL
- **THEN** the user lands on `/workspace` and no settings content is rendered

#### Scenario: Restriction on a parent page applies to its children
- **WHEN** a page is restricted and a user who may not open it opens one of its descendant pages
  by URL
- **THEN** the user is redirected exactly as for the restricted page itself

### Requirement: Rail areas and menu items appear in a stable, defined order
The system SHALL render rail areas and each menu's items in an order defined per entry, and SHALL
resolve equal positions deterministically, so the same build always shows the same order.
Migrating to this capability SHALL NOT change the order of any existing rail or menu.

#### Scenario: Tenant rail order
- **WHEN** a signed-in tenant ADMIN looks at the rail
- **THEN** it shows Workspace, Calendar, Chat, Settings, Playground, Guide in that order

#### Scenario: Workspace menu order
- **WHEN** a signed-in tenant user opens the Workspace area
- **THEN** its menu shows Dashboard, Users, Customers in that order

#### Scenario: Personal settings menu order
- **WHEN** a signed-in tenant user opens User settings
- **THEN** its menu shows Profile, Account, Security, Notifications, Appearance in that order

### Requirement: An area may be reachable without a rail entry
The system SHALL support areas that have no rail entry and are reached only from another control,
while still showing their own second column and header when open.

#### Scenario: User settings opened from the avatar menu
- **WHEN** a signed-in user opens User settings from the avatar menu
- **THEN** the second column shows the User settings menu, the rail shows no User settings entry
  and no rail area is highlighted

### Requirement: The active area follows the URL
The system SHALL determine the active area solely from the current URL — the area whose prefix
contains the path — so that reload, back/forward and external links show the same navigation as a
click. A path that belongs to no area SHALL highlight no rail entry and show the portal's default
area in the second column.

#### Scenario: Deep link into an area
- **WHEN** the user opens `/settings/calendar` by URL
- **THEN** Settings is highlighted in the rail and the second column shows the Settings menu

#### Scenario: Path outside every area
- **WHEN** the user opens a path that belongs to no area
- **THEN** no rail entry is highlighted and the second column shows the Workspace menu

### Requirement: The active menu item is highlighted
The system SHALL highlight the menu item matching the current page: an area's index item only on
the area's own home page, and any other item on its page and every page beneath it.

#### Scenario: Index item on a child page
- **WHEN** the user is on `/workspace/customers/<id>`
- **THEN** Customers is highlighted and Dashboard (`/workspace`) is not

### Requirement: Navigation reflects the modules present in the build
The system SHALL compose the rail and every menu from the modules included in the build, so that a
module removed from a fork disappears from the rail and from every menu it contributed to, without
leaving an entry that leads to a missing page and without affecting the remaining entries.

#### Scenario: Chat module removed from a fork
- **WHEN** the chat module is removed from the build
- **THEN** the rail shows Workspace, Calendar, Settings, Playground, Guide and no Chat entry

#### Scenario: Calendar module removed from a fork
- **WHEN** the calendar module is removed from the build
- **THEN** the rail has no Calendar area and the Settings menu shows General, Numbering, AI
  assistant and Activity in their usual relative order

### Requirement: Both portals follow the same navigation rules
The system SHALL apply these rules identically in the tenant portal and in the platform control
plane, evaluated against the identity of the portal the user is signed into.

#### Scenario: Platform operator navigation
- **WHEN** a platform operator is signed into the control plane
- **THEN** the rail shows Tenants, Operations and AI in that order, and each area's menu shows the
  same items in the same order as before this change


### Requirement: Record page tabs use contributed navigation entries
The system SHALL compose customer detail navigation from module-owned entries in the same
navigation registry as the shell. Local menus SHALL NOT create rail areas or replace the area
sidebar. Entries SHALL follow the registry ordering and route access rules, including restrictions
on parent routes. Links SHALL preserve the current customer identifier and the active tab SHALL
follow the URL on direct entry, reload and history navigation. Overview SHALL match only the
customer index; other tabs SHALL match their descendant pages, preferring the longest match.

#### Scenario: Customer detail tabs
- **WHEN** a signed-in user opens a customer detail page
- **THEN** the tabs show Overview, Contacts and Events in that order
- **AND** each tab opens its page for that same customer

#### Scenario: Calendar contribution removed
- **WHEN** the calendar module and its routes are removed from the build
- **THEN** customer detail shows Overview and Contacts without an Events tab

#### Scenario: Restricted tab
- **WHEN** a tab's route or any parent route denies the current user
- **THEN** that tab is absent from the local menu

#### Scenario: Deep link to customer events
- **WHEN** a user opens a customer's events page or a descendant page directly
- **THEN** Events is the active tab and Overview is not active
