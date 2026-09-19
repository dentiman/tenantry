# Proposal

## Why

The tenant portal's app shell has two side panels with fixed widths: the left `AreaSidebar`
(~224px, derived from the shared `--sidebar-width` var) and the right Context Panel
(~288px, `--context-panel-width`). Users working with wide list content (DataGrid columns) or
long labels have no way to give either panel more room, and users who want more room for the
main content have no way to shrink them. `docs/frontend/app-shell.md` already anticipated this
for the Context Panel — its width is a CSS variable specifically "because the panel is planned
to become resizable" — but no drag/resize interaction exists yet for either panel, and there is
no primitive in `libs/ui` to build one.

## What Changes

- Add drag-to-resize to the left `AreaSidebar` and the right Context Panel in both
  `apps/web` (tenant portal) and `apps/platform-web` (control plane), which share an identical
  `app-shell.tsx` composition and CSS-variable contract today.
- Split the combined `--sidebar-width` (rail + area) into a fixed rail width
  (`--sidebar-width-icon`, unchanged at 48px) and an independently resizable area width, since
  `AreaSidebar` currently has no width of its own to resize.
- Add a `libs/ui` resizable-panel primitive (none exists in the repo today) providing the drag
  handle, live resize, and keyboard resize (arrow keys on a focused handle) for accessibility.
- Classic desktop resize behavior on the handle: `col-resize` cursor on hover, live width
  update while dragging, hard stop at the panel's minimum width (the handle does not let the
  panel collapse or disappear), double-click the handle to reset to the default width.
- Existing fixed widths become the floor, not a suggestion: `AreaSidebar` min-width stays
  14rem/224px, Context Panel min-width stays 18rem/288px. Each panel's maximum width is a
  viewport-relative ceiling (exact percentage decided in design.md) so the resized panel can
  never crowd out the main content area.
- Resized widths persist per browser via `localStorage` (same pattern already used for
  theme/appearance), separately for `AreaSidebar` and Context Panel, and are restored on
  reload; absence of a stored value falls back to the current default width.
- Resize is independent of the existing rail-only collapse/expand behavior (`SidebarProvider`
  + `sidebar_state` cookie) — collapsing to icon-rail still works exactly as today and does not
  interact with the stored resize width.
- Mobile/overlay presentation of the Context Panel (`< md`, `fixed` overlay) is unaffected —
  resize applies to the docked (`md:` and up) layout only.

## Capabilities

### New Capabilities
- `app-shell/resizable-panels`: user-driven, persisted resizing of the `AreaSidebar` and
  Context Panel in the two-level app shell (both tenant and platform planes), with a per-panel
  minimum width floor equal to today's fixed width and a viewport-relative maximum.

### Modified Capabilities
<!-- No existing specs in this project yet (`openspec list --specs` returns none) — nothing to
     list here. -->

## Impact

- `apps/web/src/app-shell/app-shell.tsx`, `apps/web/src/app-shell/area-sidebar.tsx`
- `apps/platform-web/src/app-shell/app-shell.tsx`, `apps/platform-web/src/app-shell/area-sidebar.tsx`
  (byte-identical copies today — both need the same edit)
- `libs/ui/src/components/context-panel-slot.tsx` (host a resize handle on the docked panel)
- New resizable-panel primitive + width-persistence hook in `libs/ui` (likely built on
  `react-resizable-panels`, matching the shadcn/ui `resizable` pattern referenced in
  `docs/frontend/ui-registry.md`); new dependency in `libs/ui/package.json`
- `docs/frontend/app-shell.md` (record the resize behavior and the split `--sidebar-width-icon`
  / area-width variables, replacing the "planned to become resizable" note)
