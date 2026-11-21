# Visual review

Done 20–21 Nov 2026 against the local production build (port 3100) with labelled fixture data.
Screenshots come from `web/e2e/screens.spec.ts` (44 screens × light/dark × 1440px/390px) and are in
`docs/screenshots/final/<theme>-<size>/`. Each folder has an `issues.txt` with console and network errors.

## What was inspected by eye

- All 44 screens at **light 1440px** and **light 390px**, opened one by one, not just checked for overflow.
- At dark 1440px and 390px: login, overview, inbox, conversation, contacts, template builder, campaign wizard,
  analytics, settings/team, settings/audit, developer/events, not-found, error, empty states and no-access.
- The keyboard and focus screenshots in `checks/` for both themes: focus ring on the nav, the shortcut dialog and the confirm dialog.
- `issues.txt` in all four folders. They contain only expected entries: the deliberate 404 screen, the stream request
  aborted when the page closes (`ERR_FAILED`), and `ERR_NETWORK_IO_SUSPENDED` from the headless browser.

## Fixed, then re-shot and re-inspected

| Problem | Fix |
|---|---|
| At 390px the sub-nav tabs (contacts, developer, settings) ran off screen and could only be reached by scrolling sideways | `components/sub-nav.tsx` wraps instead of scrolling |
| The inbox view tabs clipped "All" on desktop | `inbox/views.tsx` wraps |
| A conversation opened at the oldest message; on phones the composer was far below | Thread scrolls to the newest message (`ScrollToEnd`); capped at 55vh on phones so the composer stays near |
| At 390px team emails broke one letter per line | Team members table became wrapping rows (`settings/team/page.tsx`) |
| Business-hours time inputs clipped the time | Widened (`settings/messaging/page.tsx`) |
| Status chips wrapped onto two lines | `whitespace-nowrap` on `Chip` |
| An unknown URL showed Next's unstyled 404 | Branded not-found pages, in and outside the app shell |
| The error page told production users to run docker | The docker hint shows only in development |
| The audit and event tables hid the key columns at 390px | Who/field columns wrap under the time on phones |
| The token hint in settings missed `business_management` | Added |

## Seen and deliberately left

- At 390px the **Segments** table's Delete button is only reachable by scrolling the table sideways. The table scrolls, not the page, and Delete has a confirm.
- **No skip link**, so keyboard users Tab through the nav first.
- The native file-picker button looks plain in dark mode (browser-drawn).

## Limits

- Chrome only. No Safari or Firefox, no real phone, no screen reader.
- Fixture data only. Long real names, RTL text and very large inboxes were not tried.
- The screenshot sweep sometimes times out at 390px in headless mode. Combinations that timed out were re-run on their own until they passed; all four sets are current.
