# Access and keyboard checks

Run 2026-11-20T17:21:09.861Z against the local production build (port 3100) with the labelled e2e fixtures.
Driven by `web/scripts/access-checks.mjs` in a real Chrome window; screenshots in `docs/screenshots/final/checks/`.
Limits: one desktop size for the keyboard pass; no screen reader was used; API checks cover read only.

**Result: all as expected.**

## Direct URLs by role

| Role | URL | Got | Expected |
|---|---|---|---|
| signed out | / | sign-in page | sign-in page |
| signed out | /inbox | sign-in page | sign-in page |
| signed out | /inbox/<id> | sign-in page | sign-in page |
| signed out | /contacts | sign-in page | sign-in page |
| signed out | /contacts/<id> | sign-in page | sign-in page |
| signed out | /contacts/import | sign-in page | sign-in page |
| signed out | /api/export/contacts | sign-in page | sign-in page |
| signed out | /templates/new | sign-in page | sign-in page |
| signed out | /campaigns/new | sign-in page | sign-in page |
| signed out | /automations | sign-in page | sign-in page |
| signed out | /analytics | sign-in page | sign-in page |
| signed out | /api/export/analytics | sign-in page | sign-in page |
| signed out | /developer | sign-in page | sign-in page |
| signed out | /developer/events/<id> | sign-in page | sign-in page |
| signed out | /settings | sign-in page | sign-in page |
| signed out | /settings/team | sign-in page | sign-in page |
| signed out | /settings/audit | sign-in page | sign-in page |
| signed out | /settings/data | sign-in page | sign-in page |
| owner | / | page | page |
| owner | /inbox | page | page |
| owner | /inbox/<id> | page | page |
| owner | /contacts | page | page |
| owner | /contacts/<id> | page | page |
| owner | /contacts/import | page | page |
| owner | /api/export/contacts | CSV download | CSV download |
| owner | /templates/new | page | page |
| owner | /campaigns/new | page | page |
| owner | /automations | page | page |
| owner | /analytics | page | page |
| owner | /api/export/analytics | CSV download | CSV download |
| owner | /developer | page | page |
| owner | /developer/events/<id> | page | page |
| owner | /settings | page | page |
| owner | /settings/team | page | page |
| owner | /settings/audit | page | page |
| owner | /settings/data | page | page |
| agent | / | page | page |
| agent | /inbox | page | page |
| agent | /inbox/<id> | page | page |
| agent | /contacts | page | page |
| agent | /contacts/<id> | page | page |
| agent | /contacts/import | page, says Owner/Admin only | page, says Owner/Admin only |
| agent | /api/export/contacts | 403 | 403 |
| agent | /templates/new | no access | no access |
| agent | /campaigns/new | no access | no access |
| agent | /automations | page, says Owner/Admin only | page, says Owner/Admin only |
| agent | /analytics | page | page |
| agent | /api/export/analytics | 403 | 403 |
| agent | /developer | page, says Owner/Admin only | page, says Owner/Admin only |
| agent | /developer/events/<id> | no access | no access |
| agent | /settings | page | page |
| agent | /settings/team | page | page |
| agent | /settings/audit | no access | no access |
| agent | /settings/data | no access | no access |
| viewer | / | page | page |
| viewer | /inbox | page | page |
| viewer | /inbox/<id> | page | page |
| viewer | /contacts | page | page |
| viewer | /contacts/<id> | page | page |
| viewer | /contacts/import | page, says Owner/Admin only | page, says Owner/Admin only |
| viewer | /api/export/contacts | 403 | 403 |
| viewer | /templates/new | no access | no access |
| viewer | /campaigns/new | no access | no access |
| viewer | /automations | page, says Owner/Admin only | page, says Owner/Admin only |
| viewer | /analytics | page | page |
| viewer | /api/export/analytics | 403 | 403 |
| viewer | /developer | page, says Owner/Admin only | page, says Owner/Admin only |
| viewer | /developer/events/<id> | no access | no access |
| viewer | /settings | page | page |
| viewer | /settings/team | page | page |
| viewer | /settings/audit | no access | no access |
| viewer | /settings/data | no access | no access |
| other-workspace owner | / | page | page |
| other-workspace owner | /inbox | page | page |
| other-workspace owner | /inbox/<id> | not found | not found |
| other-workspace owner | /contacts | page | page |
| other-workspace owner | /contacts/<id> | not found | not found |
| other-workspace owner | /contacts/import | page | page |
| other-workspace owner | /api/export/contacts | CSV download | CSV download |
| other-workspace owner | /templates/new | page | page |
| other-workspace owner | /campaigns/new | page | page |
| other-workspace owner | /automations | page | page |
| other-workspace owner | /analytics | page | page |
| other-workspace owner | /api/export/analytics | CSV download | CSV download |
| other-workspace owner | /developer | page | page |
| other-workspace owner | /developer/events/<id> | not found | not found |
| other-workspace owner | /settings | page | page |
| other-workspace owner | /settings/team | page | page |
| other-workspace owner | /settings/audit | page | page |
| other-workspace owner | /settings/data | page | page |

## Raw HTML of denied pages (before the browser redirect)

| Role | URL | Protected marker | In raw HTML |
|---|---|---|---|
| agent | /settings/audit | auth.signin | absent |
| agent | /developer/events | phone_number_quality_update | absent |
| agent | /developer/events/<id> | whatsapp_business_account | absent |
| agent | /templates/new | Save draft | absent |
| agent | /campaigns/new | Campaign name | absent |
| viewer | /settings/audit | auth.signin | absent |
| viewer | /developer/events | phone_number_quality_update | absent |
| viewer | /developer/events/<id> | whatsapp_business_account | absent |
| viewer | /templates/new | Save draft | absent |
| viewer | /campaigns/new | Campaign name | absent |

## API keys across workspaces

| Request | Status | Expected |
|---|---|---|
| no key | 401 | 401 |
| other workspace's key | 404 | 404 |
| this workspace's key | 200 | 200 |

## Keyboard only

| Theme | Step | Result |
|---|---|---|
| light | login: Tab reaches Email, Password, Sign in in order; Enter submits | ok |
| light | focus ring is visible on a nav link (screenshot) | ok |
| light | ? opens the shortcuts dialog, Escape closes it | ok |
| light | g then i goes to the Inbox; / focuses search; j opens a conversation | ok |
| light | r focuses the reply box (window open) | ok |
| light | a confirm dialog opens from the keyboard and Escape cancels without acting | ok |
| dark | login: Tab reaches Email, Password, Sign in in order; Enter submits | ok |
| dark | focus ring is visible on a nav link (screenshot) | ok |
| dark | ? opens the shortcuts dialog, Escape closes it | ok |
| dark | g then i goes to the Inbox; / focuses search; j opens a conversation | ok |
| dark | r focuses the reply box (window open) | ok |
| dark | a confirm dialog opens from the keyboard and Escape cancels without acting | ok |
