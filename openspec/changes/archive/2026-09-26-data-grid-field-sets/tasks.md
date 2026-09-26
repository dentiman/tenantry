# Tasks

## 1. Field model (pure logic)

- [x] 1.1 Extend `libs/ui/src/components/data-grid/types.ts`: `hideable?` / `defaultHidden?` on the column/field type (doc: `id` is also a persistence key), `DataGridField`, `DataGridFieldSet { id, label, fields }`, `DataGridFieldsState`, `CUSTOM_FIELD_SET_ID`; verify `pnpm typecheck` passes
- [x] 1.2 Add `data-grid/field-model.ts`: `resolveVisibility`, `reduceFieldsState` (`toggle` / `applyPreset` / `selectCustom` / `reset`), `syncFieldSets`, `sanitizeStoredFieldsState` / `serializeFieldsState`, `validateFieldSets` per design D2/D3; verify by 1.3
- [x] 1.3 Add `data-grid/field-model.test.ts` covering: toggle on a preset → Custom; toggle without field sets → Custom; Custom patch; preset switch keeps Custom; reset + sync → first set; stored id re-applied from code; changed preset contents re-applied; unknown id → first set; unknown/non-hideable Custom keys dropped; new field takes `defaultHidden`; last field can't be hidden; set order ≠ render order; old format ignored; verify `pnpm --filter @saas-skeleton/ui test` passes

## 2. Root state and persistence

- [x] 2.1 Add `data-grid/use-data-grid-fields.ts` + test: lazy sanitised read from a `localStorage` adapter under `saas-skeleton:data-grid:<gridId>:fields` (`v: 2`), write on change, all storage access in `try/catch`, memory-only without `gridId`; verify throwing-storage and round-trip tests pass
- [x] 2.2 `create-data-grid.tsx`: `Root` accepts `fields?` and `gridId?` (no presets); context carries the fields model; `Grid.Table columns` keeps working, both → `console.warn`; verify platform `tenants.tsx` / `jobs.tsx` typecheck unchanged

## 3. Rendering

- [x] 3.1 `data-grid.tsx`: `actionsHeader?: ReactNode` in the row-actions header cell, the column rendered when `rowActions` or `actionsHeader` is present, `colSpan` from rendered columns; verify empty filtered list spans the visible columns (browser: 5 = 4 Contact fields + actions)
- [x] 3.2 `Grid.Table` renders `visibleFields` in declaration order from context; verify selection checkbox and row menu remain on `/users` with fields hidden
- [x] 3.3 `Grid.FieldSettings` (design D5): gear + checkbox items + disabled last field + Reset; verify several toggles per opening and keyboard navigation
- [x] 3.4 `Grid.FieldSets sets={…}` (design D3/D6): tabs + Custom, layout-effect sync, config warnings, minimal strip (no vertical padding, indicator on the bottom border); verify in the browser strip bottom = table top and arrow-key switching
- [x] 3.5 Barrel exports (`DataGridField`, `DataGridFieldSet`, `DataGridFieldsState`, `DataGridFieldsModel`, `CUSTOM_FIELD_SET_ID`) and `fields.*` strings in `libs/i18n/src/locales/en/common.json`; verify `pnpm lint && pnpm typecheck`

## 4. Tenant rollout

- [x] 4.1 Customers: `fields` + `gridId="tenant.customers"` on Root, `name` non-hideable, `tags` `defaultHidden`, sets Main / Sales / Contact (labels in `customers.json` → `fieldSets.*`), `Grid.FieldSets` after the toolbar band directly above the table, gear via `actionsHeader`; verify in the browser: switch, fork to Custom, Custom survives reload, Reset removes Custom
- [x] 4.2 Users: same wiring, `gridId="tenant.users"`, sets Main / Access; verify the same plus independence from Customers and blocked storage working in-session

## 5. Verification and docs

- [x] 5.1 Run `pnpm lint && pnpm typecheck && pnpm build && pnpm --filter @saas-skeleton/ui test` and confirm green
- [x] 5.2 Walk the scenarios of both specs in the tenant web app, including a stored preset id, an unknown id, the old `v: 1` format, broken JSON and blocked storage
- [x] 5.3 Promote to `docs/frontend/ui-stack.md`: the fields/field-sets API, the root-knows-only-visibility model, sync, the storage key, the research and the naming rationale, the "next: views" shape; verify `design.md` holds nothing that stays true after archive only there
- [x] 5.4 Validate the change with `openspec validate --strict`
