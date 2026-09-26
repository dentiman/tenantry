# Design

## Context

See `proposal.md` — Why. Behaviour is fixed in `specs/data-grid/field-visibility/spec.md` and
`specs/data-grid/field-sets/spec.md`; this document covers how and why. Everything here that
stays true after archive is promoted to `docs/frontend/ui-stack.md` (DataGrid section).

Starting point: `createDataGrid<TFilters, TItem>()` returns a compound set whose `Root` holds
grid state (URL filters, the list query, selection) in a per-factory context; slots
(`Toolbar`, `Table`, …) read it. Columns were passed to `Grid.Table` only, so nothing outside
the table knew them. Filter *definitions* live on `Grid.Toolbar` because only the toolbar
needs them — the query consumes filter *values* from the URL.

## Research: how mature products do it

| Product | Visibility | Named sets | Edit on a named set |
| --- | --- | --- | --- |
| MUI X Data Grid | `columnVisibilityModel` map, `hideable: false` | — (app builds it) | n/a |
| TanStack Table | `columnVisibility` map, `enableHiding` | — | n/a |
| AG Grid | column state (`hide`, order, width, pin) | — (app builds it) | n/a |
| Linear | display properties, personal | Views | persists personally; "Reset to default" |
| Shopify Polaris | via index table | tabs = saved views | edited state: Cancel / Save / Save as |
| HubSpot / Salesforce | "Edit columns" dialog | list views as tabs | unsaved → Save / Save as new / Reset |
| Notion / Airtable | properties / hide fields per view | Views (each with a layout: table, board, gallery) | mutates the view |

Takeaways:

1. Visibility is universally a **map `fieldId → visible`** plus a "can't hide" flag. A map (not a
   list of visible ids) lets a field added in a later release take its own default.
2. Named sets are a **layer above** visibility; the visibility UI doesn't know they exist.
3. Products differ only on what an edit to a named set does. Our presets are code-defined and
   immutable, so "Save" is impossible and a dirty flag would leave a "Sales" tab that isn't
   Sales; forking into one remembered Custom set is the honest version of "Save as" without
   CRUD, and grows into named user views later.
4. Display prefs are **personal and not in the URL** everywhere: a link carries *which data*,
   not *how you look at it*.
5. Notion/Airtable use "layout"/view type for table vs board vs gallery. That meaning is ours
   too once cards arrive — hence "field sets", not "layouts".

## Goals / Non-Goals

**Goals:**

- The root holds only visibility; presets live on the tabs component; the gear and the tabs can
  be rendered anywhere inside `Root`, independently of each other.
- Pure, unit-testable state logic, separate from React and storage.
- Zero changes for consumers that don't opt in (platform grids).

**Non-Goals:**

- Field order (separate change `data-grid-field-order`), widths, pinning.
- Presentations other than the table (cards/board) — see "Next: views" below.
- Named user-created sets, sharing, server-side persistence, URL state, cross-tab sync.

## Decisions

### D1. Fields live on `Grid.Root`; presets do not

Fields are the record's schema — shared by the table, future cards and the gear (which may sit
outside the table, or before it in the tree), just as `useListQuery` is shared data. So
`Grid.Root` takes `fields` + `gridId`. Presets are a *UI preference helper*, needed only by the
tabs, so they are a prop of `Grid.FieldSets` — the same split as filter definitions on
`Grid.Toolbar` vs filter values in the root.

`Grid.Table columns` stays as the legacy path (platform grids). Both given → `console.warn`,
root wins.

*Rejected:* presets on `Root` (first implementation) — couples the root to one UI and makes
every renderer depend on preset definitions. Registering fields from the table via an effect —
first render with an empty menu, ordering bugs when the gear precedes the table.

### D2. State: the root knows visibility, not presets

```ts
interface DataGridFieldsState {
  activeSetId: string | null;                     // preset id | CUSTOM_FIELD_SET_ID | null
  preset: { id: string; fields: string[] } | null; // applied preset; NOT persisted
  custom: Record<string, boolean> | null;          // Custom visibility map
}
```

Actions (`field-model.ts`, pure): `toggle(fieldId, visible)`, `applyPreset(id, fields)`,
`selectCustom()`, `reset()`.

- `resolveVisibility`: Custom → `custom[id] ?? !defaultHidden`; applied preset whose id is
  active → its fields ∩ declared; otherwise → every field not `defaultHidden`. Non-hideable
  always added; empty result falls back to defaults, then to all fields. Render order is always
  the declaration order.
- `toggle` is the one generic rule "a manual edit is Custom": the current resolved visibility
  with the toggle applied becomes `custom`, `activeSetId = CUSTOM`. It refuses to hide the last
  visible field (the UI also disables it). Works identically with or without field sets.
- `reset` returns to the initial state (`null`) — the root has no idea what the default preset
  is; `FieldSets` re-applies its first set (D3). Without `FieldSets`, defaults apply.
- No automatic "Custom equals preset X → select X" matching: explicit is predictable.

### D3. `Grid.FieldSets` synchronises the root in a layout effect

`syncFieldSets(state, sets)` (pure) returns what the tabs must dispatch: nothing while Custom is
active; `applyPreset` for a known preset that is not applied yet or whose contents changed;
`applyPreset(first)` for `null` or an unknown id. The component runs it in `useLayoutEffect`, so
after mount (restoring a stored id) and after Reset the table is corrected before paint — no
flash of default fields. One `FieldSets` per `Root` (single visibility state).

Consequence: for a preset only its **id** is persisted; its fields always come from code, so a
release that changes Sales is not shadowed by a stale snapshot.

### D4. Persistence behind a tiny adapter

Key `saas-skeleton:data-grid:<gridId>:fields`, value `{ v: 2, activeSetId, custom }`. Read once
(lazy init), sanitised: other versions/shapes → initial state; Custom keys not declared or not
hideable dropped; `CUSTOM` without a Custom map → `null`. Unknown preset ids are left for
`FieldSets` to resolve (the root can't validate them). Writes on change in `try/catch`, silent on
failure. No `gridId` → memory only. The `{ read, write }` storage adapter is the seam for a later
per-user server store; not exported yet.

`gridId` is explicit (`"tenant.customers"`), not derived from the route.

### D5. Gear — `Grid.FieldSettings`

`DropdownMenu`; trigger `Button ghost icon-sm` with lucide `Settings`, `aria-label` + Tooltip.
Content: label "Fields", one `DropdownMenuCheckboxItem` per hideable field in declaration order
(Base UI's `closeOnClick` defaults to `false` — several toggles per opening), the last visible
field's item disabled, separator, "Reset to default". Renders nothing without `Root.fields`.

Placement is the page's decision. `Grid.Table actionsHeader?: ReactNode` is a generic slot in
the row-actions header cell; it also creates that column when there are no `rowActions`. The
table computes `colSpan` from rendered columns, so the empty state follows hidden fields.

### D6. Tabs — `Grid.FieldSets`

Shared `Tabs` + `TabsList variant="line" size="sm"`, no `TabsContent` (the tabs switch the
renderer's mode, they don't own panels; Base UI supplies roving focus and arrow keys). Order:
offered sets, then "Custom" while a Custom map exists.

Visual (tenant pages): placed **last, directly above the table**, below the filter toolbar —
the tabs belong to the table's fields, not to the list as a whole. The strip is minimal
vertically: list without padding (`p-0`), triggers full height (`h-full`), strip 32 px + a 1 px
`border-b`, and the active indicator is moved onto that border line
(`after:bottom-[-1px]`), so the tab reads as attached to the table header. Measured in the
browser: strip bottom = table top.

### D7. Rollout

- **Customers** (`gridId: 'tenant.customers'`): `name` non-hideable, `tags` `defaultHidden`.
  Sets: Main — number, name, phone, status, owner, createdAt; Sales — name, status, owner, tags,
  createdAt; Contact — number, name, phone, status.
- **Users** (`gridId: 'tenant.users'`): `name` non-hideable. Sets: Main — name, phone, role,
  isActive, lastSeen, createdAt; Access — name, role, isActive, lastSeen.

## Next: views (table / cards)

Deliberately not built. The shape it should take, recorded so the naming above stays coherent:
the presentation switch is composition, not a root prop —
`<Grid.Views defaultView="table"><Grid.ViewTabs>…</Grid.ViewTabs><Grid.View value="table">
<Grid.Table/></Grid.View><Grid.View value="cards"><Grid.Cards/></Grid.View></Grid.Views>`.
Views and field sets are orthogonal axes: a field set applies to whichever renderer is shown.
When a second renderer exists, table-only options (`align`, `className`, `isRowHeader`) move
into `field.table`.

## Risks / Trade-offs

- [Preferences don't follow the user across devices] → accepted; storage adapter seam (D4).
- [Field `id`s are persistence keys; renaming one resets its preference] → graceful by
  sanitisation; documented on the type.
- [A layout effect runs one extra render on mount/reset] → invisible (before paint); first
  display is a loading spinner anyway.
- [Two `FieldSets` on one root would fight] → documented contract: one per root.
- [Tabs without panels is a slightly unusual ARIA pattern] → common for view switchers;
  switching to `ToggleGroup` would be internal to the slot.
- [Hidden sorted field hides why rows are ordered] → display never changes data; the sort stays
  in the URL and returns with the field.

## Migration Plan

Frontend-only, additive. Keys from the pre-rename draft (`…:columns`, `v: 1`) were never shipped;
they are ignored. Rollback = revert.
