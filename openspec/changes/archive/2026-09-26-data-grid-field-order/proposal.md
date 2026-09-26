# Proposal

## Why

`data-grid/field-visibility` and `data-grid/field-sets` let users choose *which* fields a list
shows, but the order is fixed by code: every set renders in the page's declaration order, and a
user who wants "Status" before "Phone" has no way to get it. Notion, Airtable, MUI X, AG Grid and
TanStack Table all treat field order as a second axis next to visibility, changeable by dragging
the column header and, for accessibility and non-table presentations, from the field list. The
field model shipped in `data-grid-field-sets` already has the right seams (Custom state, presets
applied from code, a single "manual edit is Custom" rule), so order can be added without
reworking it — and should be before a cards presentation arrives and bakes in declaration order.

## What Changes

- **Order becomes part of the field state.** A preset's `fields` list now defines its order (it
  was ignored); the Custom set stores an order for **all** fields, shown and hidden, so a field
  that is turned back on returns to its remembered position. Fields a new release adds are placed
  after their declaration neighbour.
- **Reordering is a manual edit.** Reordering while a preset is active forks it into Custom (the
  preset stays unchanged), exactly like a visibility toggle. Reset restores the default set's
  order too.
- **Field menu with two sections.** The gear menu lists **Shown** fields in current order, each
  with a drag handle, then **Hidden** fields in declaration order without handles. Non-hideable
  fields appear in Shown with a locked checkbox so they can be positioned. Handles are
  keyboard-operable with live announcements. The menu becomes a popover (a checklist with handles
  rather than a menu of commands).
- **Pinned fields.** A field may opt out of reordering (`reorderable: false`); it stays at the
  start. Row-selection and row-action columns never move.
- **Column header drag (table only).** Dragging a column header shows a ghost of the header and a
  vertical insertion line; dropping reorders. A plain click still sorts (drag starts only after a
  small movement threshold); Escape cancels.
- **Persistence**: stored format `v: 3` adds the Custom order; `v: 2` data is accepted (order
  derived).

Not a breaking change for pages: all new flags are optional, and a page without field sets keeps
working with order edits forming Custom.

## Capabilities

### New Capabilities

- `data-grid/field-order`: users reorder shown fields from the field menu or by dragging table
  headers; order is per field set, edits form Custom, and it persists per browser per grid.

### Modified Capabilities

- `data-grid/field-visibility`: the gear menu lists all fields in two sections (Shown in current
  order, Hidden in declaration order) and includes non-hideable fields with a locked checkbox.
- `data-grid/field-sets`: a field set's own field order is now the render order (previously the
  page's declaration order always applied).

## Impact

- `libs/ui/src/components/data-grid/`: `types.ts` (`reorderable`, Custom order in state),
  `field-model.ts` (order resolution, `moveField`, order merge for new fields, `v: 3` sanitise) +
  tests, `use-data-grid-fields.ts`, `field-settings.tsx` (popover with Shown/Hidden sections and
  handles), `data-grid.tsx` (header drag, ghost, insertion line), possibly a shared pointer-reorder
  hook extracted from `apps/web/src/components/user-multi-select/use-row-reorder.ts`.
- `libs/i18n` `common.json`: section titles, handle labels, live-region announcements.
- `apps/web` Customers/Users: review which fields are `reorderable: false`; set orders become
  meaningful.
- `docs/frontend/ui-stack.md` (DataGrid section).
