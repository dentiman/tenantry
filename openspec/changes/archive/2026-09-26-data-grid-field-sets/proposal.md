# Proposal

## Why

The shared DataGrid (`libs/ui/src/components/data-grid`) always renders every column a page
declares. Customers already has 7 content columns and Users 6; as CRM entities grow, one fixed
column set stops fitting every task — a sales view wants owner/tags, a support view wants
phone/status. Users cannot hide what they don't need, and pages cannot offer task-oriented
sets. Every mature grid/CRM list (MUI X, AG Grid, TanStack Table, HubSpot, Salesforce, Shopify
Polaris, Linear, Notion, Airtable) solves this with the same two primitives — per-field
visibility and named sets — so we add both, generically, before more list pages copy the
current shape.

The grid is also expected to grow presentations other than a table (cards, later a board).
The vocabulary is therefore presentation-neutral: a record has **fields** (a table renders them
as columns, cards as lines), and a named selection of visible fields is a **field set**. The
word "layout"/"view" is left free for the future table/cards switch.

## What Changes

- **Fields in the grid root.** `Grid.Root` accepts `fields` (same shape as today's column
  definitions, plus optional `hideable` and `defaultHidden`) and a `gridId`. The root holds only
  the visibility state; renderers (`Grid.Table` now, cards later) show the visible fields.
  Business code keeps supplying `id` + label once — the menu reuses the column header text.
- **Field settings menu (`Grid.FieldSettings`).** A single gear icon button opening a dropdown of
  checkbox items (one per hideable field) plus "Reset to default". It reads grid context, so it
  can be placed anywhere inside `Grid.Root`: in the table's actions header cell (via a generic
  `Grid.Table actionsHeader` slot), in the toolbar, or in the page header.
- **Field sets (`Grid.FieldSets sets={…}`).** Named presets `{ id, label, fields }` defined in
  code are a prop of the tabs component itself — like `filters` on `Grid.Toolbar` — not of the
  root. The root does not know presets; the tabs write the resolved field list into it.
- **Custom set.** Presets are immutable. Any manual toggle puts the grid into a single
  remembered Custom set (starting from the active preset) and selects its tab. Reset discards
  Custom and returns to the first set.
- **Persistence in `localStorage`** keyed by `gridId`: the active set id and Custom's visibility
  map. Presets are re-applied from code, so a release that changes a preset is not overridden by
  a stale snapshot. Unknown ids and old formats degrade to defaults.
- **Rollout** to tenant Customers and Users: field sets as a compact tab strip placed last,
  directly above the table; gear in the table's actions header cell. Platform grids untouched
  (all new props optional; `Grid.Table columns` keeps working).

No backend, contract, or migration changes. Not a breaking change for existing consumers.

## Capabilities

### New Capabilities

- `data-grid/field-visibility`: users choose which fields a list shows via a gear menu that can
  be placed anywhere around the grid; choices persist per browser per grid.
- `data-grid/field-sets`: pages offer named field presets shown as tabs; editing fields on a
  preset moves the user to a single remembered Custom set.

### Modified Capabilities

None — there is no existing DataGrid spec (its behaviour is documented in
`docs/frontend/ui-stack.md` only).

## Impact

- `libs/ui/src/components/data-grid/`: `types.ts` (field flags, `DataGridField`,
  `DataGridFieldSet`, `DataGridFieldsState`, `CUSTOM_FIELD_SET_ID`), new `field-model.ts` (pure
  state logic) + tests, new `use-data-grid-fields.ts` (state + storage) + tests, new
  `field-settings.tsx` (gear + tabs), `create-data-grid.tsx` (`fields`/`gridId` on Root,
  `FieldSettings`/`FieldSets` slots), `data-grid.tsx` (`actionsHeader`, `colSpan`), `index.ts`.
- `libs/i18n` `common.json`: `fields.*` chrome strings.
- `apps/web/src/pages/customers.tsx`, `users.tsx` and their locale files.
- `docs/frontend/ui-stack.md` (DataGrid section).
