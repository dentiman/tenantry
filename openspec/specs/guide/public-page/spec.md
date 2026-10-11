# guide/public-page Specification

## Purpose
Defines what a visitor without a session sees and can do on the public product guide at `/about`,
so the stand can be explained to someone who has not signed in. The page looks like the
application — a navigation rail, a second column with the guide's sections, a content area — but
carries none of its live parts. It covers content parity with the in-app guide, the visibility of
module statuses, navigation, the sign-in entry point and the link from the sign-in page.

## Requirements

### Requirement: The guide is readable without signing in
The route `/about` SHALL render the product guide for any visitor, with or without a session, and
SHALL NOT redirect a visitor without a session to the sign-in page. The page SHALL be laid out like
the application — a narrow rail of area icons on the left, a second column beside it, and the
content area with its own header — but SHALL NOT contain the application's live parts: no
notification bell, assistant panel, user menu or tenant name, and nothing on it SHALL depend on a
session to load.

#### Scenario: Guest opens the public guide
- **WHEN** a visitor with no session opens `/about`
- **THEN** the guide is shown inside the application-like frame, with its overview first, and the
  visitor is not sent to `/login`

#### Scenario: Signed-in user opens the public guide
- **WHEN** a signed-in user opens `/about`
- **THEN** the same public page is shown and the user is not redirected into the application

#### Scenario: No live parts
- **WHEN** a visitor opens `/about`
- **THEN** the header shows no notification bell, assistant button or user menu

### Requirement: The rail is a static picture of the application's areas
The rail of the public guide SHALL list the application's areas as a fixed, hand-maintained set
that does not depend on the application's navigation registry, the visitor's role or the enabled
features: Workspace, Calendar, Chat, Assistant, Settings, Playground and Guide, in that order, with
the product mark on top. Guide SHALL be shown as the current area. Every other entry SHALL be a
link to that area's address in the application: for a visitor without a session the application's
own access check sends them to the sign-in page, and a signed-in visitor lands in that area. Each
entry SHALL carry its name as a tooltip and an accessible label.

#### Scenario: Guest follows a rail entry
- **WHEN** a visitor with no session chooses "Calendar" in the rail
- **THEN** the visitor ends up on the sign-in page

#### Scenario: Signed-in user follows a rail entry
- **WHEN** a signed-in user chooses "Calendar" in the rail
- **THEN** the application's Calendar opens

#### Scenario: Current area
- **WHEN** a visitor looks at the rail of `/about`
- **THEN** "Guide" is marked as the current area and the others are not

### Requirement: The public guide has the same content as the in-app guide
The public guide SHALL present the same sections, in the same order, with the same texts and
module cards as the in-app guide at `/guide`: Overview, Modules & services, Development &
delivery, Architecture and Key subsystems. A change to the guide's content SHALL appear in both
places without being made twice.

#### Scenario: Sections match
- **WHEN** a visitor compares `/about` with `/guide`
- **THEN** both list the same five sections in the same order with identical headings and cards

### Requirement: Module statuses and audience tags are visible to guests
Every module card on the public guide SHALL show its status — Done, Partial, Designed or
Planned — with its explanatory hint, and SHALL show its audience tag (Admin, Operator or
Developer) where the module has one. Modules that are only designed or planned SHALL NOT be
hidden from, or omitted for, a visitor without a session. The status filter of the modules
section SHALL work for guests exactly as it does for signed-in users.

#### Scenario: A planned module is shown to a guest
- **WHEN** a visitor with no session reads the Modules & services section
- **THEN** modules whose status is Planned or Designed appear with that status badge, next to
  modules that are Done

#### Scenario: Filtering by status
- **WHEN** a guest selects the status "Planned" in the modules filter
- **THEN** only modules with the Planned status remain visible in the modules section

### Requirement: Section navigation in the second column
The second column of the public guide SHALL list the guide's sections under a header naming the
product and the area "Guide". Choosing a section SHALL scroll the page to it and mark it as
current. While the visitor scrolls, the current section SHALL follow the section nearest the top
of the page. With reduced motion requested by the system, scrolling to a section SHALL happen
without animation. The column SHALL be collapsible from the content header, and on a narrow screen
the rail and the column SHALL open together as a panel over the content from that same control.

#### Scenario: Choosing a section
- **WHEN** a visitor chooses "Architecture" in the second column
- **THEN** the Architecture section scrolls to the top of the reading area and "Architecture" is
  marked as current

#### Scenario: Scrolling updates the current section
- **WHEN** a visitor scrolls down from the overview past the Modules & services heading
- **THEN** "Modules & services" becomes the current section in the second column

#### Scenario: Narrow screen
- **WHEN** a visitor opens `/about` on a phone-width screen and uses the header control
- **THEN** the rail and the section list appear together as a panel over the content, and
  choosing a section closes it

### Requirement: Opening a section by link
A link of the form `/about#<section>`, where `<section>` is one of the guide's section ids
(`overview`, `modules`, `delivery`, `architecture`, `subsystems`), SHALL open the public guide
scrolled to that section with it marked as current. A fragment that does not name a section SHALL
be ignored: the page opens at the top and does not fail.

#### Scenario: Deep link to a section
- **WHEN** a visitor opens `/about#architecture`
- **THEN** the Architecture section is scrolled into view and marked as current

#### Scenario: Unknown fragment
- **WHEN** a visitor opens `/about#nope`
- **THEN** the page opens at the top with Overview current, and no error is shown

### Requirement: Entry point into the application
The bottom of the second column SHALL show one entry button whose label and target depend on the
session: for a visitor without a session it SHALL read "Sign in" and lead to `/login`; for a
signed-in user it SHALL read "Open the app" and lead to `/workspace`. The content header SHALL
offer the light/dark theme switch.

#### Scenario: Guest sees Sign in
- **WHEN** a visitor with no session looks at the bottom of the second column of `/about`
- **THEN** the entry button reads "Sign in" and leads to the sign-in page

#### Scenario: Signed-in user sees Open the app
- **WHEN** a signed-in user looks at the bottom of the second column of `/about`
- **THEN** the entry button reads "Open the app" and leads to the workspace

### Requirement: A call to action closes the public guide
After the last section, the public guide SHALL show one large button, centred in the reading
area, that invites the visitor into the demo. For a visitor without a session it SHALL read
"Login to CRM Demo" and lead to `/login`; for a signed-in user it SHALL read "Open the CRM demo"
and lead to `/workspace`. The button belongs to the public page only: the in-app guide at `/guide`
SHALL NOT show it, and the guide's shared content SHALL stay identical in both places.

#### Scenario: Guest sees the button after the last section
- **WHEN** a visitor with no session scrolls to the end of `/about`
- **THEN** a large centred "Login to CRM Demo" button follows the Key subsystems section and
  leads to the sign-in page

#### Scenario: Signed-in user sees Open the CRM demo
- **WHEN** a signed-in user scrolls to the end of `/about`
- **THEN** the button reads "Open the CRM demo" and leads to the workspace

#### Scenario: The in-app guide has no such button
- **WHEN** a signed-in user opens `/guide` and scrolls to its end
- **THEN** the guide ends with the Key subsystems section and no call-to-action button

### Requirement: The tenant sign-in page links to the public guide
The tenant sign-in page SHALL show a quiet "About the system" link leading to `/about`. The
platform (operator) sign-in page SHALL NOT show it.

#### Scenario: Link on the tenant sign-in page
- **WHEN** a visitor opens the tenant sign-in page
- **THEN** an "About the system" link is shown and opens `/about`

#### Scenario: No link on the platform sign-in page
- **WHEN** a visitor opens the platform sign-in page
- **THEN** no link to the public guide is shown
