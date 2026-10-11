# guide/dashboard-tour Specification

## Purpose
Defines the "Product tour" tile on the dashboard: how a signed-in user is pointed to the in-app
guide, how its links open the guide at a section, and how the tile can be dismissed.

## Requirements

### Requirement: The dashboard offers a product tour
The dashboard SHALL show a "Product tour" tile spanning the full width of the widget board,
above the other widgets, containing a short explanation, an "Open the guide" button and links to
the guide sections Modules & services, Development & delivery, Architecture and Key subsystems.
The tile SHALL remain short enough that the widgets below it stay on the first screen of a
typical laptop window, and its text and links SHALL stay readable when the board's column is
narrow (side panels open).

#### Scenario: Tile is shown
- **WHEN** a signed-in user opens the dashboard and has not dismissed the tile
- **THEN** the "Product tour" tile is shown above the other widgets with the button and the four
  section links

### Requirement: Tour links open the in-app guide at a section
Choosing a section link on the tile SHALL open the in-app guide (`/guide`) scrolled to that
section, with that section marked as current in the guide's section list. Choosing "Open the
guide" SHALL open the guide from its beginning.

#### Scenario: Section link
- **WHEN** a user chooses "Architecture" on the tile
- **THEN** the guide opens with the Architecture section scrolled into view and "Architecture"
  highlighted in the section list, and the address ends with `#architecture`

#### Scenario: Open the guide
- **WHEN** a user chooses "Open the guide"
- **THEN** the guide opens at its Overview

### Requirement: The tour tile can be dismissed
The tile SHALL have a "Hide the product tour" control. Using it SHALL remove the tile at once and
keep it hidden on later visits from the same browser. The guide SHALL remain reachable from the
navigation rail whether or not the tile is shown. When the browser refuses to store the choice,
the tile SHALL simply be shown again after a reload, without any error.

#### Scenario: Dismissing
- **WHEN** a user uses "Hide the product tour" and then reloads the dashboard
- **THEN** the tile is not shown, and the Guide entry is still present in the navigation rail

#### Scenario: Storage unavailable
- **WHEN** the browser blocks site storage and a user dismisses the tile
- **THEN** the tile disappears for the current visit, shows again after a reload, and no error is shown
