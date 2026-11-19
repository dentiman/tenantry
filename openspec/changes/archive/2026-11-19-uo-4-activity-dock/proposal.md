## Why
The activity indicator lived in the header as a small chip with a popover: easy to miss, and its
finished items vanished after four seconds. The owner asked (2026-11-19) for the Google Drive
pattern instead — a panel docked to the bottom edge that shows the list itself.

## What Changes
- The header chip and popover are replaced by a dock in the bottom-right corner of the work area:
  a header line with a one-line summary, collapse and close controls, and the list of items.
- Finished items no longer disappear by themselves; they stay until dismissed or the dock is closed.
- Closing the dock removes everything and cancels what is still running, after a confirmation.
- Row actions (download, retry, cancel, dismiss) appear in place of the status mark on hover,
  focus and touch devices.
- The collapsed state is remembered across reloads; work started by the user expands the dock.

## Capabilities
### New Capabilities
None.

### Modified Capabilities
- `app-shell/activity-tray`: where the indicator lives, its summary line, how finished items
  leave, the close-with-confirmation behaviour.

## Impact
Frontend only (`apps/web`): `app-shell/activity-dock.tsx` replaces `activity-tray.tsx`,
`lib/activity.ts` loses the auto-removal timer and gains dock state, both sources set `kind` and
call `reveal()`. Docs: `docs/frontend/app-shell.md` §5.7, `docs/user-operations.md` §6.3.
