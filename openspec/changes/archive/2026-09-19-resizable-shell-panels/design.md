# Design

## Context

See `proposal.md` - Why. Today `AppShell` (`apps/web/src/app-shell/app-shell.tsx`, byte-identical
in `apps/platform-web`) sets two CSS custom properties on `SidebarProvider`:
`--sidebar-width: calc(14rem + var(--sidebar-width-icon) + 2px)` (rail + area combined, consumed
internally by the vendored `sidebar.tsx` primitive) and `--context-panel-width: 18rem` (consumed
by `libs/ui`'s `ContextPanelSlot`). `AreaSidebar` itself has no width of its own - it just fills
whatever space `--sidebar-width` leaves after the rail. Neither panel has a resize handle, a
min/max concept, or any width-persistence mechanism today. `libs/ui` has no resizable-panel
primitive and no dependency that provides one.

## Goals / Non-Goals

**Goals:**
- Independent drag-resize for `AreaSidebar` and the Context Panel, sharing one implementation
  used by both `apps/web` and `apps/platform-web`.
- Keep the change to the shell's existing flex/CSS-var layout minimal - extend it, don't replace
  it with a different layout model.

**Non-Goals:**
- Extracting the duplicated `app-shell.tsx`/`area-sidebar.tsx` composition from `apps/web` and
  `apps/platform-web` into `libs/ui`. `docs/frontend/app-shell.md` already flags this as a
  candidate extraction, but doing it as part of this change would mix a structural refactor
  into a behavior change and enlarge the blast radius. This change edits both copies identically
  and leaves extraction as a follow-up.
- Making the resize handles or stored widths syncable across devices/tenants (server-side
  persistence). Per-browser `localStorage` is sufficient per the proposal.
- Changing the existing rail collapse/expand mechanism (`SidebarProvider`, `sidebar_state`
  cookie) or the Context Panel's mobile overlay behavior.

## Decisions

### Resize mechanism: a small custom hook + handle, not `react-resizable-panels`/shadcn `resizable`

Checked the project's shadcn registry (`mcp__shadcn`): the standard `resizable` block wraps
`react-resizable-panels`, which models a resize group as `Panel`/`PanelGroup` siblings sized in
percentages of the group's total space. Adopting it here would mean restructuring
`AppRail + AreaSidebar + main content + ContextPanel` into an explicit `PanelGroup` - i.e.
retrofitting the vendored `sidebar.tsx` primitive's own flex/collapse layout into a different
sizing model - to resize two regions that aren't really peers in one split (the rail must stay
fixed, and the main content sits between two independently resizable edges, not directly beside
either one in a simple two-pane split). That's a larger structural change than this feature
needs, and it still wouldn't give us the px-based minimum "floor" the spec requires without
extra glue code to convert px constraints to group percentages on every resize.

Instead: a single `useResizablePanelWidth` hook + `ResizeHandle` component in `libs/ui`,
reused by both panels and both apps. The hook:
- Owns one CSS custom property per panel (`--area-sidebar-width`, already-existing
  `--context-panel-width`), updated on `pointermove` while dragging.
- Clamps to `[minWidthPx, maxWidthPx]`, where `minWidthPx` is the constant floor (224px / 288px)
  and `maxWidthPx` is recomputed from a `ResizeObserver` on the shell root (see below).
- Persists to `localStorage` on drag end (not on every pointermove, to avoid write thrashing),
  keyed per panel (`app-shell:area-sidebar-width`, `app-shell:context-panel-width`); reads the
  stored value synchronously on mount before first paint (the shell is a client-only Vite SPA,
  no SSR, so there is no hydration mismatch to worry about).
- Resets to the default width on handle double-click.
- Exposes keyboard resize: the handle is `role="separator" aria-orientation="vertical"` with
  `aria-valuenow/min/max` and `tabIndex={0}`, following the standard WAI-ARIA "window splitter"
  pattern used by desktop-style resizable panes (VS Code, JetBrains); arrow keys move the width
  by a fixed step within the same clamped bounds as dragging.

`--sidebar-width` (the combined var the stock `sidebar.tsx` primitive already reads) becomes a
derived expression, `calc(var(--area-sidebar-width) + var(--sidebar-width-icon) + 2px)`, set in
`AppShell` alongside the new `--area-sidebar-width`. This keeps the vendored `sidebar.tsx` file
itself untouched - only our own `app-shell.tsx` changes what it feeds into the variable the
primitive already expects.

### Maximum width: percentage of viewport, recomputed on resize

Each panel's maximum is `viewportWidth * MAX_RATIO` (a constant, not user-configurable),
recalculated via a `ResizeObserver` on the shell's root element rather than a `window.resize`
listener, so it also reacts correctly if the shell is ever embedded in a non-full-viewport
container. If a stored or in-progress width exceeds the newly computed maximum (window shrunk),
the panel is clamped down immediately. Starting value for `MAX_RATIO`: 0.4 for both panels. This
is a plain constant in the hook, not a spec-level number, so it can be tuned later without a
spec change.

### Both apps get the same behavior, edited as two copies

Per the proposal, both `apps/web` and `apps/platform-web` get resizing. Since their
`app-shell.tsx`/`area-sidebar.tsx` are already maintained as byte-identical copies (documented,
deliberate pattern - see `docs/frontend/app-shell.md` §9.3), this change edits both the same way
rather than extracting a shared composition (see Non-Goals). The shared hook/handle/CSS-var
logic lives once in `libs/ui`; only the small amount of shell wiring is duplicated, same as
today.

## Risks / Trade-offs

- [Found during manual verification, fixed in the same change: the vendored `sidebar.tsx`
  primitive's `sidebar-gap`/`sidebar-container` elements carry
  `transition-[width]`/`transition-[left,right,width] duration-200 ease-linear`, meant for the
  discrete icon↔full collapse toggle. Since live drag also mutates `--sidebar-width` (the same
  var those elements read), that transition fired on every drag frame too - `AreaSidebar`'s own
  width (inline style, no transition) snapped to the pointer instantly, but its ancestor
  container's width eased 200ms behind, so content visibly "caught up" to the new border. The
  Context Panel has no such ancestor transition, so it never showed the symptom - the asymmetry
  is what surfaced this.] → `useResizablePanelWidth` toggles a `is-resizing-panel` class on
  `document.documentElement` for the duration of an active pointer drag only (not keyboard, not
  double-click, not collapse); `libs/ui/src/styles.css` has an unlayered rule that zeroes the
  transition on `[data-slot='sidebar-gap']`/`[data-slot='sidebar-container']` while that class is
  present, so it wins over the Tailwind utility regardless of layer order. `sidebar.tsx` itself
  is untouched - the fix is a CSS-only override fed by the same class/var contract the rest of
  this change already uses, not a vendored-file edit.
- [Both panels resized to their 40% maximum simultaneously could leave the main content
  cramped on narrower laptop viewports] → Main content already uses `min-w-0` and reflows
  rather than breaking; `MAX_RATIO` is a single constant that can be lowered later without
  touching the spec if this proves too aggressive in practice.
- [Hand-rolled resize hook duplicates functionality a maintained library already provides] →
  Accepted: the shell's existing layout doesn't fit `react-resizable-panels`' group/percentage
  model without a larger structural rewrite (see Decisions); the hook is intentionally small
  and single-purpose (drag, clamp, persist, keyboard) rather than a general-purpose library.
- [Duplicated shell files mean this change's edits, and any future related edit, must be
  applied twice] → Existing, accepted project pattern; `tasks.md` calls out both file pairs
  explicitly so review catches a partial edit.
- [Keyboard step size and exact handle visuals aren't specified by the requirements] →
  Implementation detail with no externally-contracted value; pick a reasonable default (e.g.
  16px per arrow press) during implementation.

## Migration Plan

Client-only, additive change - no data migration, no API surface, no breaking change. Default
widths match today's fixed widths exactly, so existing users see no visual change until they
first drag a handle. Rollback is a normal revert of the deploy; no stored `localStorage` value
outlives an individual browser, so there is nothing to clean up server-side.
