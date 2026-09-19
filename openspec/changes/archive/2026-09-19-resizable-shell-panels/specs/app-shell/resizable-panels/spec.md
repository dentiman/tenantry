# Spec Delta

## Purpose

Lets users in both the tenant portal and the platform control plane drag the app shell's left
navigation panel and right context panel to a comfortable width, within a floor set by today's
fixed sizes and a ceiling that keeps the main content usable.

## ADDED Requirements

### Requirement: AreaSidebar is resizable with a minimum width floor
The system SHALL let the user resize the left `AreaSidebar` panel by dragging a handle on its
trailing edge, independently of the icon rail next to it, down to a minimum width of 14rem
(224px) and no smaller.

#### Scenario: User drags the AreaSidebar narrower than its floor
- **WHEN** the user drags the `AreaSidebar` resize handle further toward the rail than the
  14rem minimum
- **THEN** the panel stops resizing at 14rem and does not collapse, hide, or shrink further

#### Scenario: User drags the AreaSidebar wider
- **WHEN** the user drags the `AreaSidebar` resize handle away from the rail, within the
  allowed maximum
- **THEN** the panel width follows the pointer live and the main content area reflows to the
  remaining space

### Requirement: Context Panel is resizable with a minimum width floor
The system SHALL let the user resize the right Context Panel by dragging a handle on its
leading edge, down to a minimum width of 18rem (288px) and no smaller, when the panel is docked
(viewport width at or above the `md` breakpoint).

#### Scenario: User drags the Context Panel narrower than its floor
- **WHEN** the user drags the Context Panel resize handle toward the main content further than
  the 18rem minimum
- **THEN** the panel stops resizing at 18rem and does not collapse or hide

#### Scenario: Context Panel resize handle is absent on mobile overlay
- **WHEN** the viewport is narrower than the `md` breakpoint and the Context Panel renders as a
  fixed overlay
- **THEN** no resize handle is shown and the panel keeps its fixed overlay width

### Requirement: Resize is bounded by a viewport-relative maximum
The system SHALL cap each panel's resized width at a maximum expressed as a percentage of the
current viewport width, so that resizing one panel cannot reduce the main content area below a
usable width.

#### Scenario: User drags a panel past the viewport-relative maximum
- **WHEN** the user drags either panel's resize handle past its viewport-relative maximum width
- **THEN** the panel stops growing at that maximum and further drag movement in the same
  direction has no additional effect

#### Scenario: Maximum recalculates after the browser window is resized
- **WHEN** the browser window is resized after a panel was previously widened close to its
  maximum
- **THEN** the panel's effective maximum width is recalculated against the new viewport width,
  shrinking the panel if it now exceeds the new maximum

### Requirement: Resized width persists across reloads
The system SHALL remember each panel's user-chosen width independently (`AreaSidebar` width and
Context Panel width are stored separately) per browser, and restore it the next time the shell
loads, without requiring the user to resize again.

#### Scenario: Reloading the page after a resize
- **WHEN** the user resizes a panel and then reloads or revisits the app in the same browser
- **THEN** the panel renders at the previously chosen width instead of the default width

#### Scenario: No stored width yet
- **WHEN** the user opens the app shell in a browser that has never stored a width for a panel
- **THEN** the panel renders at its current default width (14rem for `AreaSidebar`, 18rem for
  the Context Panel)

### Requirement: Resize handle supports classic desktop resize interaction
The system SHALL present each resize handle with the interaction conventions of a desktop
resizable panel: a `col-resize` cursor on hover, a live width update while dragging (not only
on drop), and a reset to the panel's default width on double-clicking the handle.

#### Scenario: Hovering the resize handle
- **WHEN** the user's pointer is over a panel's resize handle
- **THEN** the cursor changes to indicate horizontal resize

#### Scenario: Double-clicking the resize handle
- **WHEN** the user double-clicks a panel's resize handle
- **THEN** the panel's width resets to its default (14rem for `AreaSidebar`, 18rem for the
  Context Panel) and that default is what subsequently persists

#### Scenario: Resizing with the keyboard
- **WHEN** a resize handle has keyboard focus and the user presses the left/right arrow keys
- **THEN** the associated panel's width changes in fixed increments, respecting the same
  minimum and maximum bounds as pointer dragging

### Requirement: Resize is independent of rail collapse
The system SHALL keep panel-width resizing and the existing rail-only collapse/expand behavior
independent: collapsing the left navigation to the icon rail does not discard or change the
stored `AreaSidebar` width, and resizing a panel does not change its collapsed/expanded state.

#### Scenario: Collapsing the rail after resizing AreaSidebar
- **WHEN** the user has resized `AreaSidebar` to a custom width and then collapses the left
  navigation to icon-only
- **THEN** the collapse hides the area panel as it does today, and expanding it again restores
  the previously resized width rather than the default

### Requirement: Resizable panels behave identically across both planes
The system SHALL apply the same resize behavior, minimums, maximums, and persistence to the
app shell in both the tenant portal (`apps/web`) and the platform control plane
(`apps/platform-web`), stored separately per plane since they are distinct origins.

#### Scenario: Resizing in the platform control plane
- **WHEN** an operator resizes a panel in the platform web app
- **THEN** the same minimum/maximum bounds and persistence behavior apply as in the tenant
  portal, independent of any width stored for the tenant portal
