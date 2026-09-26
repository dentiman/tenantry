# Design

## Context

See `proposal.md` — Why; behaviour in `specs/data-grid/field-order`, plus the modified
requirements in `field-visibility` and `field-sets`. The field model this builds on is
documented in `docs/frontend/ui-stack.md` → DataGrid → «Поля, набори полів і меню полів»:

- `Grid.Root` holds only `DataGridFieldsState { activeSetId, preset, custom }` and knows no
  presets; `Grid.FieldSets` applies presets from code in a layout effect (`syncFieldSets`).
- One generic rule in the reducer: a manual edit forms Custom.
- Storage `saas-skeleton:data-grid:<gridId>:fields`, `{ v: 2, activeSetId, custom }`.
- Render order today is always the declaration order; `preset.fields` order is ignored.
- `Grid.FieldSettings` is a Base UI `DropdownMenu` of `CheckboxItem`s.

Existing drag precedent: `apps/web/src/components/user-multi-select/use-row-reorder.ts` and the
calendar grid use raw pointer events, deliberately without `@dnd-kit`: 4 px start threshold,
live reorder of a vertical list, steps measured from the DOM.

## Research: how others do it

| System | How to reorder | Order lives | Hidden fields in the list | Fixed |
| --- | --- | --- | --- | --- |
| Notion | header drag + ⋮⋮ in Properties | per view | separate "Hidden" section | — |
| Airtable | header drag + handles in "Hide fields" | per view | one list, every row draggable | primary field first |
| HubSpot / Salesforce | "Edit columns": available ↔ selected | per list view | available list, not ordered | — |
| MUI X Pro | header drag only | `orderedFields` state | panel has no ordering | `disableReorder` |
| AG Grid | header drag + columns panel | column state | panel ordering | pinned columns |
| TanStack | `columnOrder: string[]`; DnD left to the app | separate from visibility | — | — |

Takeaways: order is its own state next to visibility; it is scoped like visibility (per view /
set); two entry points (header drag for the table, list handles for accessibility and for
presentations without a header); a fixed "primary" field is common. Dragging hidden fields
(Airtable) reorders something the user cannot see — we follow the Notion split instead.

## Goals / Non-Goals

**Goals:**

- Order as a first-class part of the field state, resolved the same way for any renderer.
- Zero new dependencies; one pointer-reorder primitive shared by the panel and the header.
- Keyboard parity in the panel.

**Non-Goals:**

- Reordering hidden fields; column width/pinning to the right; touch-optimised header drag
  (coarse pointers use the panel); named user sets; server persistence.

## Decisions

### D1. State: Custom carries an order; presets carry theirs

```ts
interface DataGridFieldsState {
  activeSetId: string | null;
  preset: { id: string; fields: string[] } | null;               // order = fields order
  custom: { visible: Record<string, boolean>; order: string[] } | null;
}
```

- `resolveFields(fields, state) → string[]` replaces the visible-set-only resolution: returns
  visible ids **in display order**. Renderers render that list; `visibleIds` stays derivable.
- Preset: its `fields` order, then non-hideable fields it doesn't list merged in (D3).
- Custom: `order` filtered by visibility, with never-positioned declared fields merged in (D3).
- No field sets / initial: declaration order.
- Pinned (`reorderable: false`) fields are lifted to the front, in declaration order, in every
  case.

*Alternative rejected:* a single global order per grid, independent of sets — simpler, but a
set could then not define its order, and it diverges from Notion/Airtable. Order per set keeps
the one rule "any manual edit forms Custom".

### D2. `moveField(fieldId, beforeId | null)`

Operates on the **full** order (shown + hidden): remove the field, insert it right before
`beforeId`; `null` = right after the last shown field (not the absolute end, so trailing hidden
fields keep their places). The reducer rejects moves of pinned fields and drops before a pinned
field. On a preset it forks: `custom = { visible: presetVisibility, order: moved(fullOrderOf(preset)) }`,
`activeSetId = CUSTOM`. `toggle` also produces the new shape (`order` copied from the resolved
full order), so show/hide keeps positions.

`fullOrderOf(preset)` = the preset's list followed by the remaining declared fields merged at
their declaration positions — so a later re-show of a field not in the preset lands somewhere
predictable.

### D3. Merging never-positioned fields

`mergeOrder(order, declared)`: for each declared id missing from `order`, insert it right after
the nearest preceding declared field that is present (or at the start). Covers fields from a new
release, `v: 2` data (no order), and presets not listing non-hideable fields. Unknown ids in a
stored order are dropped.

### D4. Field panel: popover, not menu

Switch `Grid.FieldSettings` from `DropdownMenu` to `Popover` with a plain list:

- A menu is a command list: Base UI Menu owns roving focus, typeahead and item activation,
  which fight a drag handle (pointer-down on a handle would activate the item; Arrow keys are
  captured for item navigation). A popover with checkboxes + handles is what Notion ships for
  exactly this panel.
- Rows: `⋮⋮ handle` (button, `aria-label="Reorder <label>"`) · `Checkbox` · label. Sections
  "Shown" / "Hidden" as small headings; Hidden omitted when empty; "Reset to default" at the
  bottom. The gear trigger, placement freedom and `actionsHeader` slot do not change.
- Pointer: rows reorder **live** while dragging (the `use-row-reorder` behaviour), commit on
  release. Keyboard: on a focused handle Arrow Up/Down dispatches `moveField` one step and
  announces "<label>, position n of m" in an `aria-live="polite"` region inside the popover.

### D5. Shared pointer-reorder primitive

Extract the arithmetic of `use-row-reorder.ts` into `libs/ui` as an axis-generic hook
(`useSortableReorder({ axis: 'y' | 'x', ids, lockedIds, onChange, measure })`): pointer capture,
4 px threshold, boundaries measured from live DOM rects (midpoints — header widths differ, so no
constant step), Escape cancels. The panel uses `axis: 'y'` with live reorder; the header uses
`axis: 'x'` with commit-on-drop. `user-multi-select` migrates to it in the same change so there
is one implementation.

### D6. Header drag

- Drag source: the whole `<th>` of a reorderable field, including the sort button; the threshold
  keeps a click a click. `touch-action` is left alone (coarse pointers: use the panel).
- Ghost: a portal-rendered, pointer-following copy of the header label (`bg-popover`, shadow,
  opacity) constrained to the table's vertical band.
- Insertion line: one absolutely positioned 2 px `bg-primary` bar over the table wrapper at the
  computed boundary, full table height; boundaries are header midpoints, clamped after the last
  pinned field and before the actions column.
- Columns don't shift during the drag: moving every body cell per frame is costly with real rows
  and makes the target jump under the pointer. Drop → `moveField`.
- Auto-scroll: if the table wrapper scrolls horizontally, scroll when the pointer is within
  40 px of an edge.

### D7. Persistence `v: 3`

`{ v: 3, activeSetId, custom: { visible, order } | null }`. Sanitise accepts `v: 2` (`custom` is
the bare map → `{ visible: map, order: [] }`, merged by D3) and `v: 3`; anything else → initial.

### D8. Rollout

Users: `name` `reorderable: false` (already first — matches Airtable's primary field).
Customers: `name` stays reorderable (No. precedes it in every set; pinning would change today's
look). Set lists are reviewed so their order is intentional now that it is honoured.

## Risks / Trade-offs

- [Popover replaces the menu → different keyboard model] → covered by the spec's keyboard
  requirement; checkbox rows are standard tab stops.
- [Header drag on a sortable header could mis-sort] → threshold + suppress the click after a
  drag that crossed it.
- [Pinning changes visual order on existing pages] → only Users pins, where the pinned field is
  already first.
- [Live reorder in the panel while the table also re-renders] → the table updates on drop, not
  per step (panel reorders a local copy, dispatches on release; keyboard dispatches per step —
  single column move, cheap).

## Migration Plan

Frontend-only. `v: 2` preferences carry over (D7). Rollback: revert; `v: 3` data is ignored by
the old reader (falls back to defaults).
