# Tasks

## 1. Shared resize primitive (`libs/ui`)

- [x] 1.1 Add `useResizablePanelWidth(options)` hook (`libs/ui/src/hooks/` or similar):
      pointer-drag width state, clamp to `[minWidthPx, computedMaxWidthPx]`, `ResizeObserver`
      on a passed root element to recompute the max on resize, `localStorage` read-on-mount and
      write-on-drag-end keyed by a caller-provided key, and a `resetToDefault()` action. Verify
      with a unit test (Vitest, per `pnpm web:test` conventions) covering: clamping at min/max,
      persistence round-trip through a mocked `localStorage`, and max recompute on a simulated
      resize.
- [x] 1.2 Add `ResizeHandle` component (`libs/ui/src/components/`) using the hook: renders the
      drag handle with `role="separator" aria-orientation="vertical" aria-valuenow/min/max`,
      `col-resize` cursor on hover, double-click calls `resetToDefault()`, arrow-key handlers
      call the hook's step-resize action. Verify by rendering it in Storybook/a scratch page (or
      existing component preview pattern, if any) and confirming drag, double-click reset, and
      arrow-key resize all update the bound CSS variable.
- [x] 1.3 Export both from `libs/ui`'s public entry point and confirm `pnpm build` (or
      `pnpm --filter @saas-skeleton/ui build`, per `docs/commands.md`) succeeds with the new
      files included.

## 2. Context Panel gets a resize handle

- [x] 2.1 In `libs/ui/src/components/context-panel-slot.tsx`, mount a `ResizeHandle` on the
      docked (`md:` and up) panel's leading edge, bound to `--context-panel-width`, default
      `18rem`, min `18rem`. Do not render the handle in the `< md` overlay mode. Verify by
      confirming the handle is absent at a narrow viewport and present at `md`+ in a manual
      browser check.

## 3. `apps/web` shell wiring

- [x] 3.1 In `apps/web/src/app-shell/app-shell.tsx`, split the `--sidebar-width` CSS variable:
      introduce `--area-sidebar-width` (default `14rem`) and change `--sidebar-width` to
      `calc(var(--area-sidebar-width) + var(--sidebar-width-icon) + 2px)`. Verify the rendered
      layout is pixel-identical to today at default widths (visual check - rail 48px, area
      224px, unchanged).
- [x] 3.2 In `apps/web/src/app-shell/area-sidebar.tsx`, replace the `w-auto flex-1` sizing with
      an explicit `style={{ width: 'var(--area-sidebar-width)' }}` and mount a `ResizeHandle` on
      its trailing edge, bound to `--area-sidebar-width`, min `14rem`, `MAX_RATIO = 0.4`. Verify
      by dragging the handle in the running dev app (`pnpm web:dev`) and confirming the panel
      resizes live and stops at the floor.
- [x] 3.3 Manually verify against the spec scenarios in `specs/app-shell/resizable-panels/spec.md`
      for `apps/web`: drag-to-min stops without collapsing, drag-to-max stops and shrinks after
      window resize, reload restores the stored width, double-click resets, arrow keys resize,
      collapsing the rail after a resize preserves the stored area width on re-expand.

## 4. `apps/platform-web` shell wiring (mirrors `apps/web`)

- [x] 4.1 Apply the same `--area-sidebar-width` split from task 3.1 to
      `apps/platform-web/src/app-shell/app-shell.tsx`. Verify pixel-identical default layout,
      same as 3.1.
- [x] 4.2 Apply the same `ResizeHandle` wiring from task 3.2 to
      `apps/platform-web/src/app-shell/area-sidebar.tsx`. Verify by dragging in
      `pnpm platform:web:dev`.
- [x] 4.3 Manually verify the same spec scenarios as task 3.3 in `apps/platform-web`, and
      confirm a width resized in `apps/web` does not affect `apps/platform-web`'s stored width
      (different origins/ports, independent `localStorage`).

## 5. Docs and cleanup

- [x] 5.1 Update `docs/frontend/app-shell.md` §5.6 to describe the implemented resize behavior
      (handle, min/max, persistence) in place of the "planned to become resizable" note, and
      document the new `--area-sidebar-width` variable alongside the existing
      `--context-panel-width` one.
- [x] 5.2 Run `pnpm lint && pnpm typecheck && pnpm build` at the repo root and confirm all three
      pass with the new files and edits included.

## 6. Bug fix found during manual verification

- [x] 6.1 Fix `AreaSidebar` drag visibly lagging behind the pointer (Context Panel drag did
      not) — root cause: vendored `sidebar.tsx`'s `sidebar-gap`/`sidebar-container` carry a
      200ms `transition-[width]` for collapse/expand that also fired on every live-drag frame.
      `useResizablePanelWidth` now toggles an `is-resizing-panel` class on
      `document.documentElement` for the duration of a pointer drag; `libs/ui/src/styles.css`
      zeroes the transition on those two `data-slot`s while the class is present (unlayered
      rule, wins over the Tailwind utility; `sidebar.tsx` itself untouched). Verified in
      browser: `transitionDuration` reads `0s` mid-drag and `0.2s` again after release, and the
      visual catch-up is gone; collapse/expand animation still plays normally outside a drag.
      See `design.md` Risks for the full root-cause writeup.
