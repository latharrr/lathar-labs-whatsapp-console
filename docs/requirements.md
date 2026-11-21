# Requirements audit

Every requirement in the original spec, checked against the code on 21 Nov 2026. A related test passing
does not count as proof unless it exercises that requirement.

| Status | Meaning |
|---|---|
| **Verified** | An automated test exercises this exact behaviour against local Postgres and Redis, or a recorded manual check does (cited). |
| **Built** | The code exists and appears in screenshots or was clicked through, but no test asserts it. |
| **Mock-only** | Our side is tested, but the Meta or paid side was replaced by a mock or a test account. It needs live verification. |
| **Changed** | Built differently from the spec. The trade-off is given. |
| **Missing** | Not built. |
| **Blocked** | Needs credentials, spending or an approval that was not given. |

**Nothing was checked against a live Meta account.** There are no real tokens, sends, template submissions or deployments.
Evidence lives in `worker/test/*.test.ts` (Vitest, 79 tests) and `web/e2e/*.spec.ts` (Playwright, 28 tests plus a 4-combination
screenshot sweep). The manual checks are in `docs/checks/access-keyboard.md` and `docs/checks/visual-review.md`.

## Context and stack

| Requirement | Status | Evidence / note |
|---|---|---|
| Official Cloud API only; Graph version from env | Verified (request shape) · Mock-only (Meta side) | send.test "sends the right request and stores the message". Default `v26.0`; Meta's latest is v27.0 (see meta-notes) |
| Next.js 14 App Router, TypeScript, Tailwind, Recharts | Built | `npm run build` compiles |
| shadcn/ui | Changed | House components in `web/components/ui/*` (below) |
| Postgres + Prisma, safe migrations | Verified | All suites run on migrated DBs. Both migrations are additive. An old pre-phase dump restored and migrated forward with no rows lost (README "Backups") |
| BullMQ + Redis for webhooks and sends | Verified | queue.test (a replay really re-processes). review.test "sweeper" covers lost jobs, crashed sends, and webhooks stored while the queue was down |
| Realtime inbox and statuses | Changed | Server-Sent Events + Redis pub/sub instead of Supabase Realtime (below) |
| Auth: email + Google; roles Owner/Admin/Agent/Viewer | Changed · Google Blocked | Auth.js credentials (below). The Google provider is coded but needs `GOOGLE_CLIENT_ID/SECRET` |
| Deploy: Vercel + worker host, TLS | Blocked | Needs hosting approval and spend. See `docs/go-live-runbook.md` |

## Meta integration

| Requirement | Status | Evidence / note |
|---|---|---|
| GET verification handshake | Verified | webhook.spec "verification handshake echoes the challenge only for the right token" |
| `X-Hub-Signature-256` on the raw bytes; reject bad ones | Verified | webhook.test "accepts the exact bytes…", "rejects a tampered body, a wrong secret, a missing or malformed header"; webhook.spec "unsigned or wrongly signed…" |
| Store the raw payload first, process async, idempotent | Verified | webhook.test idempotency (3); review.test "re-enqueues webhook events stored while the queue was down" |
| Batches up to Meta's documented 3 MB | Verified | webhook.spec "a signed batch near Meta's 3 MB payload size is accepted". The limit was raised from 1 MB in this review |
| A batch spanning two workspaces does not leak into one workspace's event log | Verified | review.test "a batch naming two workspaces' accounts is visible to neither". **New in this review** |
| Inbound text, media, location, contacts, interactive, button, reactions | Verified (fixtures) · Mock-only | Fixtures in `db/fixtures` follow Meta's documented shapes; webhook.test. Not compared against real payloads |
| Statuses sent → delivered → read / failed, out of order, error codes | Verified | webhook.test "moves forward only…", "out-of-order receipts…" |
| Template status, quality, account alerts | Verified | webhook.test (5) |
| Inbound media download → storage | Verified (mocked Graph) · Mock-only | core.test "test accounts have no file at Meta; real accounts are copied into storage" |
| Outbound media upload | Built · Mock-only | Inbox "Attach file". **No test** |
| Rate limits, tier limits, backoff on 429/5xx | Verified | send.test retries (4) and limits (2); review.test "a send throttled more times than MAX_ATTEMPTS still retries…". **Fixed in this review:** waiting used to use up retries |
| Token encrypted server-side; multiple WABAs and numbers | Verified | webhook.test "round-trips tokens and rejects tampering"; `npm run key:check -w db` (README "Encryption key") |
| Current Meta details checked | Built | `docs/meta-notes.md`, re-checked 21 Nov 2026, with open conflicts listed |

## Pages

| Requirement | Status | Evidence / note |
|---|---|---|
| **Overview**: per-number name, status, quality, limit tier | Verified | smoke "owner sees the labelled fixture overview" |
| KPIs incl. delivery, read and reply %, windows opened | Verified | smoke "the totals line adds up and matches the Sent figure" |
| Estimated cost by category | Built | Shows **Not set** until verified rates are configured, never ₹0. messaging.spec campaign asserts "Not set" |
| Alerts: quality, template rejected/paused, webhook failures, token expiry | Verified | webhook.test alerts; isolation.test scoping |
| **Inbox**: threads and filters (unassigned / mine / open / closed / tag / number) | Built | Screenshots; access checks open filtered URLs. No test asserts each filter's results |
| 24-hour window: timer in the UI, enforced on the server | Verified | send.test window (2); messaging.spec "a closed window allows templates only, and the server enforces it" |
| Assign, notes, tags, close | Verified | messaging.spec "reply, note, tag, assign and close a conversation" |
| Quick replies, interactive buttons and lists, media in replies | Built · Mock-only | Composer actions exist. **No test** sends an interactive message or uses a quick reply |
| Contact side panel: profile, attributes, opt-in, campaign history, orders and leads | Built | Screenshots 03/04 |
| Read receipts + typing indicator | Built · Mock-only | `inbox/actions.ts`. Test accounts skip the Graph call. **No test** |
| **Contacts**: CSV import, E.164, dedupe | Verified | core.test (3); workspace.spec import |
| Custom fields, tags, segments (rule builder) | Verified | core.test "filters by tag, opt-in and attribute, always inside the workspace"; workspace.spec segment count |
| Opt-in source, proof and time; STOP and similar handled automatically | Verified | automation.test consent (4); messaging.spec STOP |
| Block list, export | Verified | send.test "blocked contacts get nothing"; workspace.spec export; access checks show 403 for agent and viewer exports |
| **Templates**: list synced from Meta | Blocked | Needs a real WABA token. The paging code follows the docs only |
| Builder: header, body, footer, buttons incl. copy code | Verified | core.test templates (3); workspace.spec builder |
| Live preview, samples, version history, duplicate | Verified | workspace.spec "build a draft with a live preview, version it…" |
| Submit to Meta; show the rejection reason | Mock-only · Blocked | Test accounts are refused locally (asserted). The rejection reason comes from webhook.test. A real submission needs approval |
| **Campaigns**: wizard number → segment → template → variables → schedule → throttle | Verified | messaging.spec "wizard and pre-send checks…" |
| Scheduled launch | Verified | review.test "send nothing before their time, then start on the first tick after it". **New** |
| Pre-send checks: opted-in only, tier vs audience, quality, cost | Verified | send.test campaigns; messaging.spec "a low-quality number blocks launch" |
| Live progress + per-error breakdown | Built | Screenshot 14 |
| A/B variants | Verified | core.test "A/B variants split deterministically by weight" |
| UTM short links, click counts | Built | `r/[code]/route.ts`. **No test** (the old checklist wrongly said Tested) |
| Pause, resume, cancel; retry failed (retryable errors only) | Verified | send.test "pause holds…", "retry-failed only retries temporary errors"; review.test "does not keep re-queueing sends of a paused campaign". **Fixed:** the sweeper used to re-queue paused sends and spend their attempts |
| **Automations**: keyword, welcome, away (hours, Asia/Kolkata) | Verified | automation.test (3); messaging.spec keyword |
| Flow builder: message, buttons, branch, set attribute, assign, webhook | Verified (logic) · Changed (UI) | automation.test flows (2). The editor is an ordered node list with branch targets, not a drag-and-drop canvas. It is quicker to build and keyboard-friendly, but harder to see large flows at a glance |
| AI reply node with handoff and guardrails | Mock-only · Blocked | automation.test with a mocked model. Off unless `AI_REPLIES_ENABLED=1`. Live use needs a key and spend approval |
| Event triggers via API | Verified | automation.test; messaging.spec "API events and contacts" |
| **Analytics**: funnel; by campaign, template, segment, agent | Built | Pages render with fixture data (screenshots, a11y sweep). **No test checks the numbers** |
| Reply heatmap, first response, resolution time | Built | Screenshot 18. Not checked by a test |
| Cost by category and day, CSV, date range | Built | Cost is blank until rates are set. Export permission verified (403 for agent and viewer) |
| **Developer**: API keys; outbound webhooks (SSRF-guarded) | Verified | core.test "blocks private and metadata addresses"; automation.test outbound; workspace.spec |
| Event log, replay, raw payload, error lookup | Verified | workspace.spec "create and use an API key, replay an event, look up an error"; queue.test |
| **Settings**: numbers + business profile incl. photo | Built · Blocked | Test accounts refuse edits. A live edit needs approval |
| Team, roles, invites | Verified | workspace.spec invite; isolation.spec role tests; access checks (5 roles × 18 URLs) |
| Business hours, opt-out words, retention, audit log | Verified | workspace.spec "messaging settings keep STOP"; core.test retention |

## Data, compliance, UI, deliverables

| Requirement | Status | Evidence / note |
|---|---|---|
| Data model (all listed tables) | Verified | Schema used by all suites. Roles are an enum on `Membership`, not a separate table (**Changed**: four fixed roles need no table) |
| Marketing only to opted-in contacts; opt-out is instant, incl. queued jobs and retries | Verified | send.test consent (5); review.test "a lost queued send is re-queued, and the send-time check still blocks it after an opt-out" |
| Ambiguous sends are never sent twice | Verified | send.test "a timeout after the request left is marked unknown"; review.test "a send stuck mid-request is marked unknown and never sent again" |
| Tokens encrypted; delete contact | Verified | webhook.test secrets; core.test erasure |
| PII access logged | Built | `pii.view` on the contact page and API, `pii.export` on export. **No test asserts the audit rows** |
| Every mutating action audited | Built | `audit()` in server actions; workspace.spec checks `team.invite` only |
| Workspace isolation | Verified | isolation.test (8); isolation.spec (2); access checks (other-workspace owner gets the 404 on all 18 URLs; the raw HTML has no data) |
| Errors never show internals | Verified | review.test "database errors never reach the form". **Fixed:** some Prisma error classes used to reach forms |
| Dark and light, dense, shortcuts, mobile inbox | Verified | workspace.spec shortcuts; smoke mobile; keyboard pass in both themes (access-keyboard.md) |
| Empty, loading and error states; confirm before sends and deletes | Built | Screenshots 31–43. Confirm dialogs cover campaign launch, schedule, pause, resume and cancel, deletes and submit-to-Meta. **Single inbox replies do not ask for confirmation** (on purpose: it would slow agents) |
| Accessibility | Verified (automated) | axe on 12 pages: no serious or critical issues. Keyboard pass by hand. **No skip link**, so Tab goes through the nav first |
| Monorepo web / worker / db + docker-compose | Built | Repo root |
| README: Meta setup, token, webhook, env, backups | Built | Commands checked against the code on 21 Nov 2026 |
| Seed data + webhook fixtures | Built | `db/src/seed.ts`, `db/fixtures`, `db/src/e2e-fixtures.ts` |
| Tests: signature, idempotency, 24h, opt-out, throttling, Playwright | Verified | 79 + 28 passing |

## Missing

- **Password reset.** There is no "forgot password" flow and no admin reset. `npm run user:create` upserts without changing an existing password. Until this exists, a locked-out user needs a direct DB update.
- **MFA.** None.
- **Session revocation.** Sessions are 12-hour JWTs. Removing a member takes effect at once, because every request re-reads membership from the DB. A password change does **not** end existing sessions until they expire.

## Review of the choices that differ from the spec

**Custom login (Auth.js credentials) instead of Supabase Auth.** The spec allowed Supabase; this kept the stack to one database.
It meets the requirements safely:
- passwords are hashed with scrypt
- unknown emails now cost the same hashing time (review.test "sign-in timing")
- the error message is generic
- failed attempts are rate-limited
- every server request re-reads role and membership from the DB, so a stale JWT cannot keep a removed member's access

Trade-offs:
- the limiter is in memory per process (a `shortcut:` comment marks it); with more than one web instance it must move to Redis
- the Missing items above

**Keep it, and add a password reset before inviting real users.**

**SSE + Redis pub/sub instead of Supabase Realtime.** It meets the requirement:
- the inbox and statuses update live
- the browser reconnects on its own, and an offline banner shows while it is disconnected (screenshot 32)

Costs:
- one Redis subscriber connection per open tab
- serverless hosts cut long responses, which causes periodic reconnects; on Vercel that is a reconnect every few minutes, which is harmless

**Keep it.** Revisit only beyond a few hundred concurrent tabs.

**House components instead of shadcn/ui.** They are small, look the same and have no Radix dependency. axe and the keyboard pass found no serious issues.
The confirm dialog uses the native `<dialog>` element, so focus trapping and Escape come from the browser. **Keep them.**

## Corrections to the previous checklist

- "UTM short links, click counts: Tested". Click counting has **no test**. It is now Built.
- "Media download / upload: Tested / Built". Upload has no test and is now Mock-only.
- "Assign, notes, tags, quick replies, media, buttons/lists: Tested". Only assign, notes, tags and close are tested.
- "PII access logged: Tested". The audit rows are not asserted. It is now Built.
- "Analytics… Built (a11y sweep fails on any error page)". That only proves the page renders, not that the numbers are right.
- Test counts were 70 / 27. They are now 79 / 28.

## Bugs found and fixed in this review (each has a test that failed first)

1. A throttled send or a send held by the messaging limit used up its 5 retry attempts, so a later temporary Meta error failed at once (`db/src/send.ts`).
2. The sweeper re-queued the queued sends of paused campaigns every minute and spent their attempts (`db/src/sweep.ts`).
3. A webhook batch naming two workspaces' accounts was logged under the first one, so it was visible to that workspace (`db/src/ingest.ts`).
4. Webhook bodies over 1 MB were rejected, but Meta sends up to 3 MB (`web/app/api/webhooks/meta/route.ts`).
5. Some Prisma error classes showed raw DB text in forms (`web/lib/server.ts`).
6. Sign-in for an unknown email returned faster than for a wrong password, which revealed whether an account exists (`db/src/password.ts`).
7. Contact and analytics exports returned 500 instead of 403 for agents and viewers (found by the access checks).
