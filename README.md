# Lathar Labs WhatsApp dashboard

A team dashboard on the official WhatsApp Business Platform (Meta Cloud API, Graph v26.0).
No unofficial libraries. All four phases of the original spec are built and **locally tested** against
labelled fixtures and a mocked Graph API: Overview, shared Inbox, Contacts, Templates, Campaigns,
Automations, Analytics, Developer tools and Settings. **It is not production-ready**: nothing has run
against a real Meta account or been deployed. See [docs/requirements.md](docs/requirements.md) for each
requirement's status (verified, mock-only, changed, missing), [docs/meta-notes.md](docs/meta-notes.md) for
what was checked against Meta's docs, [docs/go-live-runbook.md](docs/go-live-runbook.md) for the staged
go-live plan.

This is separate from the live Lathar Labs console.
Nothing here changes that console, its webhook or the bot behind it.

## Layout

| Path | What it is |
|---|---|
| `web/` | Next.js 14 (App Router, TypeScript, Tailwind). Pages, Auth.js, the Meta webhook route, server actions |
| `worker/` | BullMQ workers: webhook processing, sends, media download, automations, outbound webhooks; campaign dispatcher, retention purge and a sweeper for lost jobs |
| `db/` | Prisma schema and migrations, plus the shared server code: webhook processing, the outbox (`send.ts`), consent (`optout.ts`), campaigns, automations and flows, templates, segments, contacts/CSV, SSRF-guarded HTTP, storage, redaction, permissions |
| `db/fixtures/webhooks/` | Labelled test payloads (invented IDs) |
| `docker-compose.yml` | Local Postgres 16 and Redis 7, bound to 127.0.0.1 |
| `bar.md`, `design-system.md` | The design bar (Mercury's demo dashboard) and Lathar Labs tokens |

## Run it locally

```sh
cp .env.example .env            # then fill in the blanks (see below); for the local
                                # docker-compose services use DATABASE_URL=postgresql://ll:ll_local_only@127.0.0.1:5432/ll_dashboard
                                # and REDIS_URL=redis://127.0.0.1:6379
ln -sf ../.env db/.env && ln -sf ../.env web/.env
npm install
docker compose up -d --wait     # Postgres + Redis
npm run db:migrate              # creates the tables
npm run db:seed                 # Owner account + a FIXTURE number with sample traffic
npm run dev                     # web on http://localhost:3100
npm run worker                  # in a second terminal
```

Sign in with `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`. The fixture account is labelled
**Test account, not connected to Meta** in the UI, and the Overview says **last test event** when the
newest webhook came from it. Its statuses, pricing categories and billable flags are samples, not Meta data. Add team members with
`npm run user:create -w db -- someone@example.com ADMIN` (roles: OWNER, ADMIN, AGENT, VIEWER).

Tests: `npm test` (worker + processing, against a separate `ll_dashboard_test` database) and
`npm run e2e` (Playwright, uses your installed Chrome, needs the web server and worker running; it loads `.env` itself).

## Environment variables

| Name | Needed for | Where it comes from |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | everything | docker-compose defaults |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | sign-in | your URL; `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional Google sign-in | Google Cloud OAuth client. Blank hides the button. Only existing users can sign in |
| `ENCRYPTION_KEY` | storing WABA tokens | `openssl rand -base64 32` (32 bytes). Losing it means reconnecting every account |
| `META_APP_ID` | token expiry check | Meta app > App settings > Basic |
| `META_APP_SECRET` | webhook signatures | same page. Wrong or missing = every event is rejected with 401 |
| `META_VERIFY_TOKEN` | webhook handshake | any random string you choose; paste the same into Meta |
| `GRAPH_API_VERSION` | Graph calls | `v26.0`, the version this was built and tested against. Meta's latest is `v27.0` (4 Nov 2026); move up in a separate tested change |
| `PRICING_RATES`, `PRICING_CURRENCY` | cost estimate | See [Cost estimate](#cost-estimate). Blank = counts only, no invented prices |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD` | `db:seed` | your choice |
| `PUBLIC_URL` | tracked links, invites | your public https URL; defaults to `NEXTAUTH_URL` |
| `STORAGE_DRIVER`, `MEDIA_DIR` | media files | `local` (default, `../.data/media`, outside git) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` | `STORAGE_DRIVER=supabase` | a private Storage bucket; server-only key |
| `DEFAULT_COUNTRY_CODE` | CSV import | `91`: added to 10-digit numbers without a code |
| `AI_REPLIES_ENABLED`, `AI_MODEL`, `ANTHROPIC_API_KEY` | optional AI flow node (paid) | off by default; `claude-opus-5-5` |
| `OUTBOUND_ALLOW_PRIVATE` | local development | `1` lets outbound webhooks reach localhost. Never set in production |

## Meta setup (once)

1. **Meta app.** In Meta for Developers, use the existing "Lathar Labs" app (it has the WhatsApp
   use case) or create one. Copy the App ID and App Secret into `.env`.
2. **WABA and number.** In WhatsApp Manager the WhatsApp Business Account owns the phone numbers.
   A number must be registered (status `CONNECTED`) to send and receive. Messaging limits are set at
   the business-portfolio level and shared by all its numbers.
3. **System User token.** Business settings > Users > System users > add an Admin system user >
   *Assign assets* (the app and the WABA, full control) > *Generate token* with `business_management`,
   `whatsapp_business_management` and `whatsapp_business_messaging`, longest expiry offered. Meta calls these
   tokens long-lived but does not promise they never expire, so the Overview's expiry alert stays on.
   Paste it into Settings > Connect an account. It is stored AES-256-GCM encrypted and only read
   on the server. Connecting makes **only GET calls**: it checks the token (`debug_token`), reads the
   WABA and its numbers, and stores them.
4. **Webhook.** Needs a public HTTPS URL: `https://<your-domain>/api/webhooks/meta`, with
   `META_VERIFY_TOKEN`, subscribed to `messages`, `message_template_status_update`,
   `message_template_quality_update`, `phone_number_quality_update`, `account_alerts`, `account_update`.

### Webhook routing: decide before going live

A Meta app has **one** default callback URL, and the Lathar Labs app's is the live console.
Do not repoint it until you pick one of these:

| Option | How | Trade-off |
|---|---|---|
| A. Console forwards | The console re-POSTs each raw signed payload (and its `X-Hub-Signature-256`) to this dashboard | No Meta change; needs a small console patch; dashboard sees everything |
| B. Override for messages | WABA- or number-level callback override pointing here | **Diverts messages away from the live console.** `account_alerts`, `account_update`, template and `phone_number_quality_update` webhooks cannot be overridden: they still go only to the console |
| C. Second Meta app | A new app subscribed to the same WABA, with its own callback | Console untouched; both apps receive events. One more app and secret to manage. **Recommended**, in shadow mode first: see [docs/go-live-runbook.md](docs/go-live-runbook.md) |

Until then, everything runs on the signed local fixtures.

## Cost estimate

The Overview counts billable messages per pricing category but shows no cost until you set rates.
Rates are never read from Meta and never guessed. To turn the estimate on, copy the current per-message
rates for your recipients' market from Meta's WhatsApp pricing page into `.env`, in your billing currency:

```sh
PRICING_CURRENCY=INR
PRICING_RATES={"marketing":0,"utility":0,"authentication":0,"service":0}
```

Replace each `0` with the real rate. A missing key, `0` or a non-number counts as "not set", and that row
shows **not set**. The estimate is billable count × rate. Check it against your Meta invoice: volume tiers,
free service messages and rate changes are not modelled.

## How the Overview counts messages

| Figure | Counts | Percentage |
|---|---|---|
| Sent | Outbound messages in the range, from Meta's status receipts. Each is delivered, awaiting receipt or failed | change vs the previous period |
| Delivered | Delivered or read | delivered ÷ sent |
| Read | Read | read ÷ delivered (customers can turn read receipts off) |
| Replied | Chats where the customer wrote after one of our messages | ÷ chats we messaged in the range |
| Failed | Failed | ÷ sent |
| Windows opened | Customer messages that opened a new 24-hour window | (count; all customer messages shown beside it) |

The page shows the totals line `sent = delivered + awaiting receipt + failed`, and an e2e test checks that it adds up.

## How the webhook pipeline works

1. `POST /api/webhooks/meta` reads the raw bytes, checks `X-Hub-Signature-256` (HMAC-SHA256 with the
   app secret, constant-time), rejects with 401 if wrong, then **stores the raw body before answering 200**.
   A byte-identical redelivery maps to the same row (sha256 key).
2. It enqueues the event id on BullMQ (job id = event id, so no duplicate jobs). If Redis is down the
   row still exists and the worker's sweeper picks it up after a minute.
3. The worker processes it with retries (8 attempts, exponential backoff). Messages are unique by
   `wamid`, statuses by (`wamid`, status), alerts by a content hash. Replays add nothing.
4. Statuses only move forward (sent < delivered < read); a late `failed` never erases a delivery.
   Pricing (`billable`, `category`) is kept per message for the cost view.
5. An inbound message records whether it opened a new 24-hour customer service window; the
   conversation's `lastInboundAt` only moves forward. Phase 2's inbox uses it to allow templates only.

The Overview raises alerts when events wait more than 5 minutes (worker down) or keep failing, and when a
token is invalid or expires within 7 days.

## Messaging safeguards (all server-side)

Every send (inbox, campaign, automation, API, opt-out reply) goes through one outbox, `db/src/send.ts`.
The rules run when a send is queued **and again right before it goes to Meta**, so queued jobs and retries
cannot slip past a change:

- **24-hour window**: anything but a template is refused once the customer has not written for 24 hours.
- **Marketing consent**: marketing templates need a recorded opt-in (source, proof, time). Opted-out and
  blocked contacts get nothing marketing or automated. Utility templates and agent replies inside the window
  still work for contacts without marketing consent.
- **Opt-out, immediately**: STOP, UNSUBSCRIBE, STOP PROMOTIONS and NOT INTERESTED (editable, whole message, any
  case, also button text/payload), Meta's `user_preferences` stop, and error 131050 all opt the contact out and
  cancel their queued marketing, campaign and automated sends. This runs in webhook processing, **before**
  automations, which also refuse opted-out contacts. START opts back in, with the message as proof. The live bot
  has no suppression list, so nothing here relies on one upstream.
- **Duplicates**: each send has a unique idempotency key and is claimed atomically (`queued → sending`).
  A timeout after the request left is marked `unknown` and **never retried automatically**.
- **Retries**: only Meta's temporary errors (429, 5xx, 130429, 131000, 131016, 131056, …) with exponential
  backoff, at most 5 attempts. Campaign "retry failed" only re-sends those.
- **Limits**: a per-number send rate (`sendsPerSecond`, default 20/s), the campaign throttle (per minute, counting
  sends in flight), and the portfolio messaging limit (business-initiated templates per 24 h) all hold sends back.
- **Cancellation**: cancelling a campaign cancels queued sends; pausing holds them; resuming re-queues them.
- **Roles**: `db/src/permissions.ts` is the one matrix for server actions and the API.

## Security and reliability

- Meta tokens and webhook secrets are AES-256-GCM encrypted (`ENCRYPTION_KEY`); keys live only in `.env`, which
  is git-ignored. API keys are stored as SHA-256 hashes and shown once.
- Logs and stored error messages pass through `redact()` (tokens, API keys, secrets).
- Every mutating action writes `AuditLog`; personal-data views and exports are logged as `pii.view` / `pii.export`.
- Webhooks: signature checked on raw bytes, stored before the 200, processed by the worker, idempotent, and
  out-of-order safe (statuses only move forward; `lastInboundAt` only moves forward).
- Outbound HTTP to user URLs (webhooks, flow nodes) blocks private, loopback, link-local, CGNAT and metadata
  addresses at connect time (no DNS rebinding), follows no redirects and caps response size.
- Every query is scoped to the signed-in workspace; `worker/test/isolation.test.ts` and `web/e2e/isolation.spec.ts`
  prove a second workspace cannot read or change the first.
- Migrations are additive only. The phases 2–4 migration backfills workspace ids and never drops data.

## Assumptions and known limits

- **Auth is Auth.js on local Postgres, not Supabase Auth**, and realtime is Server-Sent Events over Redis
  pub/sub, not Supabase Realtime (no Supabase project was assumed). Both are contained swaps.
- **Per-message pricing.** "Conversations opened" is shown as **windows opened**. Rates are config, unset.
- **Test accounts** (`isFixture`) never call Meta: sends are stored as "Test send, not delivered to WhatsApp",
  and syncs, submissions and profile edits are refused with that reason.
- Invites are one-time links you send yourself: no mail service is configured.
- The messaging-limit cap counts every non-service template as business-initiated (over-counts).
- Phone validation is E.164 shape, not per-country numbering plans.
- Login and API rate limits: login is in memory (one web instance); API is Redis-backed per key.
- Error code meanings in `web/lib/meta-errors.ts` cover the common codes; check Meta's list for others.

## Tests

```sh
npm test                         # worker suite (Vitest) on the separate ll_dashboard_test database
cd web && npm run build && npx next start -p 3100 &   # or npm run dev
npm run worker &                 # the e2e flows need the worker
npm run e2e                      # Playwright: loads labelled e2e fixtures (db/src/e2e-fixtures.ts) first
```

Last full run (2026-11-21, production build): worker **79/79**, Playwright **28/28** (4 screenshot tests skipped
unless `SCREENS=1`). Manual access and keyboard checks: `node web/scripts/access-checks.mjs` (needs the production
server on 3100) writes [`docs/checks/access-keyboard.md`](docs/checks/access-keyboard.md). The visual review is in
[`docs/checks/visual-review.md`](docs/checks/visual-review.md). Requirement-by-requirement coverage: [`docs/requirements.md`](docs/requirements.md).

Screenshots of every screen, desktop and 390px, light and dark, plus empty/loading/no-access/disconnected/error
states, go to `docs/screenshots/final/` (local test data only; generated screenshots are not committed to this repo):

```sh
cd web && SCREENS=1 npx playwright test e2e/screens.spec.ts --workers=1
node scripts/error-screens.mjs   # briefly stops the LOCAL Postgres container to capture the error states
```

## Deploy with Docker

Built and run with Node 26 (`node:26-bookworm-slim`) and npm 11. One image serves both roles: the web server
(`next start` on port **3100**, or `$PORT`) and the worker (`npm run start -w worker`).

```sh
cp .env.example .env     # fill in every value under "Required", plus POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml up -d --build    # postgres, redis, migrate (one-off), web, worker
docker compose -f docker-compose.prod.yml run --rm worker npm run seed -w db   # first Owner (uses SEED_OWNER_*)
```

- `migrate` runs `prisma migrate deploy` (additive migrations) and must finish before web and worker start.
- The seed also creates a labelled **test account** with sample traffic. Add more people with
  `docker compose -f docker-compose.prod.yml run --rm worker npm run user:create -w db -- name@example.com ADMIN`.
- Web and worker share the `media` volume (`MEDIA_DIR=/data/media`); keep them on one host, or use `STORAGE_DRIVER=supabase`.
- Put a TLS reverse proxy in front of port 3100. Meta's webhook URL is `https://<your-domain>/api/webhooks/meta`.
- Run one web instance: the sign-in rate limiter is in memory per process.

Without Docker: `npm ci && npx prisma generate --schema db/prisma/schema.prisma && npm run build -w web && npm run deploy -w db`,
then `npm run start -w web` and `npm run start -w worker` (the worker reads the root `.env`; link it for the web with `ln -sf ../.env web/.env`).

## Setup from scratch and rollback

```sh
cp .env.example .env && ln -sf ../.env db/.env && ln -sf ../.env web/.env   # fill in the secrets
npm install && docker compose up -d --wait
npm run deploy -w db          # applies migrations (additive)
npm run db:seed               # owner + labelled test account and fixtures
```

**Before any migration on a database with real data, take a dump:**
`docker compose exec -T postgres pg_dump -U ll -d ll_dashboard -Fc > .backups/ll_dashboard_$(date +%Y%m%d-%H%M).dump`
(`.backups/` is git-ignored. `ll_dashboard_before_phases.dump` there is this build's dump from before the phases 2–4 migration.)

**Check a dump restores**, into a new scratch database only. The script refuses the working and test databases and any name that exists:

```sh
scripts/restore-check.sh .backups/<file>.dump ll_restore_check_<date> ll_dashboard   # last arg: compare row counts
DATABASE_URL=postgresql://ll:<password>@localhost:5432/ll_restore_check_<date> npm run key:check -w db
```

Checked on 21 Nov 2026:
- A fresh dump restored with matching row counts in every table, 2 migrations recorded, and both stored secrets decrypting.
- The old pre-phases dump restored and `prisma migrate deploy` brought it forward with no rows lost.

**Rollback** = restore the dump into a new database, point `DATABASE_URL` at it, and check out the matching
commit (`e31a3fb` for `ll_dashboard_before_phases.dump`). Nothing is dropped automatically; delete old or scratch
databases yourself once you are sure (`docker compose exec -T postgres dropdb -U ll <name>`).

### Encryption key

`ENCRYPTION_KEY` encrypts WABA tokens and outbound-webhook secrets (AES-256-GCM). **A database dump is useless
without the key it was written with.** The tokens cannot be decrypted, and every account must be reconnected.
Keep the key in a password manager, separate from the backups. Never put it in git, chat or the dump folder.

`npm run key:check -w db` decrypts every stored secret with the current key and prints only counts; it exits 1 if any fail.
Run it after restoring, or before rotating, the key. It was tested with the right key (1/1 ok) and a wrong key (0/1, exit 1).
There is no rotation command yet. To change the key, reconnect each account after setting the new one.

## Go-live checklist (needs your separate approval for each step)

The staged version with sources, stop conditions and rollback is [docs/go-live-runbook.md](docs/go-live-runbook.md).

1. **Credentials**: System User token with `business_management` + `whatsapp_business_management` +
   `whatsapp_business_messaging` (long-lived); `META_APP_ID`, `META_APP_SECRET`; a new `META_VERIFY_TOKEN`; fresh `NEXTAUTH_SECRET` and
   `ENCRYPTION_KEY` for production (back the key up: losing it means reconnecting every account).
2. **Webhook routing decision** (the live console owns the app's callback today): A. console forwards signed
   payloads, B. WABA/number override for messages (account alerts and template events stay with the console),
   or C. a second Meta app. Do not repoint the live webhook until you pick one.
3. **Hosting** (paid/cloud, ask first): web on Vercel or a VPS, worker on Railway/Render/VPS, managed Postgres and
   Redis, TLS. Set `PUBLIC_URL`. Run `npm run deploy -w db` before the web build.
4. **Media storage**: a private bucket (`STORAGE_DRIVER=supabase`) or a persistent disk for `MEDIA_DIR`.
5. **Verified pricing rates** for `PRICING_RATES`, or leave the estimate off.
6. **First live checks, in this order**: connect the WABA (GET only) → sync templates → receive one inbound
   message → reply inside the window to your own number → one utility template → a 1-contact campaign to
   yourself with your own recorded opt-in → STOP from your phone and confirm the opt-out.
7. Optional, separately approved: AI replies (Anthropic billing), a mail service for invites.
8. Never commit `.env`, `.data/`, `.backups/` or generated screenshots.
