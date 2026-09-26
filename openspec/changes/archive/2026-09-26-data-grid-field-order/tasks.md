# Tasks

## 1. Order in the field model

- [x] 1.1 `types.ts`: `reorderable?` on the field type; `custom` becomes `{ visible, order }` in `DataGridFieldsState`; verify `pnpm typecheck`
- [x] 1.2 `field-model.ts`: `resolveFields` (visible ids in display order, pinned first), `mergeOrder`, `fullOrderOf(preset)`, `moveField(fieldId, beforeId | null)` action, `toggle` keeping order, `v: 3` serialise + `v: 2` sanitise (design D1–D3, D7); verify by 1.3
- [x] 1.3 Extend `field-model.test.ts`: preset order honoured; pinned lifted first; move on preset forks to Custom; move on Custom in place; `null` target lands after last shown, not after trailing hidden; move of/before pinned rejected; hidden field re-shown at remembered position; new declared field merged after its neighbour; reset restores preset order; `v: 2` → order derived; unknown order ids dropped; verify `pnpm --filter @saas-skeleton/ui test`
- [x] 1.4 `use-data-grid-fields.ts` exposes `displayFields` (ordered) and `Grid.Table` renders it; verify Sales on `/workspace/customers` renders in the set's own order

## 2. Shared pointer-reorder primitive

- [x] 2.1 Extract `useSortableReorder({ axis, ids, lockedIds, onChange, measure })` into `libs/ui` from `apps/web/src/components/user-multi-select/use-row-reorder.ts` (threshold, DOM-measured midpoints, pointer capture, Escape cancel), with pure boundary math unit-tested; verify tests pass
- [x] 2.2 Migrate `user-multi-select` to the shared hook (remove `use-row-reorder.ts`, update `docs/frontend/multi-user-select.md` §6); verify on `/playground/components/user-select` (the only consumer with `reorderable` on — calendar attendees keep it off by design) that the pinned organiser row cannot be displaced

## 3. Field panel

- [x] 3.1 Replace the `DropdownMenu` in `Grid.FieldSettings` with a `Popover` (design D4): Shown (display order, handles, locked checkbox for non-hideable) / Hidden (declaration order, no handles, omitted when empty) / Reset; verify both sections and that toggling moves a row between them with the popover open
- [x] 3.2 Pointer drag of Shown rows with live reorder, dispatch `moveField` on release; verify dragging "Status" above "Phone" updates the table on drop
- [x] 3.3 Keyboard: Arrow Up/Down on a focused handle moves one step, focus stays, `aria-live` announcement; `common.json` strings (sections, handle label, announcement); verify with keyboard only in the browser

## 4. Header drag (table)

- [x] 4.1 Make reorderable `<th>` draggable via the shared hook (`axis: 'x'`, commit on drop), suppress the click after a real drag; verify a plain click still sorts and a drag doesn't
- [x] 4.2 Ghost (portal, follows pointer) and 2 px insertion line over the table, clamped after pinned fields and before the actions column; Escape cancels; verify visually in light and dark theme
- [x] 4.3 Horizontal auto-scroll near the wrapper edges when the table overflows; verify on a narrow window

## 5. Rollout, verification, docs

- [x] 5.1 Users: `name` `reorderable: false`; review Customers/Users set lists for intended order; verify both pages
- [x] 5.2 Walk every scenario of `specs/data-grid/field-order` and the modified requirements in the browser, including reload, `v: 2` stored data, Reset
- [x] 5.3 Run `pnpm lint && pnpm typecheck && pnpm build && pnpm --filter @saas-skeleton/ui test`
- [x] 5.4 Promote to `docs/frontend/ui-stack.md`: order model, pinned fields, panel sections, drag behaviour, research table; verify with `openspec validate data-grid-field-order --strict`

## 6. Field panel with many fields (added after the playground stand)

- [x] 6.1 Playground stand `/playground/components/data-grid`: 50 deterministic mock invoices × 32 fields, four field sets, client-side search/status filter/sort/paging through the same `useListQuery` contract; verify it renders with no console errors
- [x] 6.2 Bound the panel height (`min(32rem, --available-height)`), scroll only the field list via `ScrollArea`, keep Reset in a fixed footer; pass the list viewport to the reorder hook for edge auto-scroll; verify on the stand: panel 512 px in a 969 px window, list scrolls, Reset visible, drag near the bottom scrolls the list
- [x] 6.3 Field search when the grid has more than 20 fields (`FIELD_SEARCH_THRESHOLD`, `filterFieldsByQuery` by label or id, unit-tested); verify on the stand that "due" and "ponum" filter and that Customers shows no search
- [x] 6.4 Layout `auto` / `list` / `split` on `Grid.FieldSettings` (split — Shown left, Hidden right, own headers with counts and own scroll — when more than 20 fields); stand gets an Auto / List / Two columns switch; verify both layouts fit 969 px with Reset visible and headers aligned
- [x] 6.5 Move the search into the Hidden header (title · search · count as the input's right addon), filter Hidden only, keep Shown draggable during a search, no autofocus on pointer open; verify "due" → Hidden 1 / 25 with Shown untouched, drag works while searching
- [x] 6.6 Fixed height for the split layout so the panel doesn't shrink while typing a search (list keeps a max height)
