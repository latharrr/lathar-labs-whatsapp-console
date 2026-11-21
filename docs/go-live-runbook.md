# Go-live runbook (staged)

This is a plan, not a deployment. **Every stage needs your approval before it starts.** Nothing below has been run.
Meta facts were checked against developers.facebook.com on 21 Nov 2026; sources are at the end.

## Current state

- **Live today:** the Lathar Labs console and bot. Its Meta app's default webhook callback receives everything for the WABA.
- **Not live:** this dashboard. It has been run only locally, against fixtures and a mocked Graph API.

## Routing recommendation: a second Meta app, in shadow mode first

| Option | What it does to the live console | Verdict |
|---|---|---|
| **C. Second Meta app** subscribed to the same WABA | Nothing. Meta lists "all applications currently subscribed" to a WABA and delivers "to all apps that have subscribed", each to its own callback. The console's app and callback are untouched [1][2] | **Recommended**: least disruptive, and removed with one call |
| B. Callback override (WABA or phone level) | **Diverts** `messages` away from the console's callback (precedence: phone override, then WABA override, then app default). `account_alerts`, `account_update`, template and `phone_number_quality_update` webhooks cannot be overridden and stay with the console [3] | Breaks the live bot unless the dashboard forwards to it. Avoid |
| A. Console forwards signed payloads | Needs a code change to the live console | Touches the live console. Avoid for now |

**Caution with C:** the console bot and the dashboard would both see every inbound message.
The dashboard must run with **automations off and AI off** until you decide which system replies to customers.
Otherwise customers get two replies.

## Stages

### Stage 1: Local, read-only connect (no hosting, no webhook change)

1. In Business settings, create or choose a system user. Assign it the WABA (and later the second app).
   Generate a token with `business_management`, `whatsapp_business_management` and `whatsapp_business_messaging` [4].
   Meta calls system-user tokens long-lived; it does not promise they never expire, so the dashboard's expiry alert stays on.
2. **You** paste the token into the local dashboard: Settings > Connect an account. Not into chat.
   Connecting makes only GET calls: `debug_token`, the WABA and its numbers.
3. Press Sync templates (GET only).
4. Run `npm run key:check -w db`. It should report that 1 token decrypts.

- **Check:** the number, quality, messaging limit and templates match WhatsApp Manager.
- **Stop if:** any POST to Graph shows in the worker log; the token shows fewer than the three permissions; the numbers or WABA do not match.
- **Rollback:** delete the account in Settings, and revoke the token in Business settings if you want.
- **Cost:** none expected (read calls).

### Stage 2: Private hosted staging (paid; needs a budget decision)

1. Host the web app, the worker, Postgres and Redis behind TLS. Self-signed certificates are not accepted by Meta [5].
2. Create fresh secrets for production: `NEXTAUTH_SECRET`, `ENCRYPTION_KEY` and `META_VERIFY_TOKEN`.
3. Back up `ENCRYPTION_KEY` outside the server; without it every stored token is unreadable.
4. Run `npm run deploy -w db`, then the build. Take a `pg_dump` and test it with `scripts/restore-check.sh` before real data arrives.
5. Add password reset (see requirements "Missing") before inviting anyone other than you.

- **Stop if:** `scripts/restore-check.sh` reports differences; `key:check` fails after a restore; the e2e suite fails against staging.
- **Rollback:** tear down the staging resources. Nothing live depends on them.
- **Cost:** **unknown until you pick providers.**

### Stage 3: Shadow webhooks through a second app (no sends)

1. Create a second Meta app with the WhatsApp use case. Put it in Live mode, which some webhooks require [5].
2. Set its callback to `https://<staging>/api/webhooks/meta` with the new verify token. Subscribe it to the fields in the README.
3. Assign the app to the system user.
4. Subscribe it to the WABA: `POST /<WABA_ID>/subscribed_apps` with a token for **that app** [2].
5. Keep automations, AI and campaigns off.

- **Watch for 48 hours:**
  - inbound counts match the console
  - no 401s (a wrong app secret)
  - event lag under 5 minutes
  - zero rows in the outbox
- **Stop if:** the console stops receiving any webhook (check its log within 5 minutes of subscribing); the dashboard logs any outbound send; signature failures repeat.
- **Before subscribing:** run `GET /<WABA_ID>/subscribed_apps` and save the list. The console's app must be on it.
- **Rollback:** `DELETE /<WABA_ID>/subscribed_apps` **using a token generated for the second app**, never the console's.
  Meta's reference says "Unsubscribing will immediately stop all webhook deliveries for this WABA" [2]. It does not
  say plainly whether that is per calling app; it is assumed to be, since the call is made as one app.
  Rehearse it once in Stage 3, before relying on it:
  1. Unsubscribe.
  2. Within 5 minutes, `GET` the list again and confirm the console's app is still there.
  3. Send a test message from your own phone and confirm it reaches the console.

  If the console's app disappears, re-subscribe it right away with **its own** token (`POST /<WABA_ID>/subscribed_apps`).
  Meta does not state a limit on how many apps can subscribe.
- **Cost:** none from Meta for receiving webhooks, but hosting continues.

### Stage 4: First sends, to your own number only

Do these in order, stopping at the first surprise:
1. Reply inside the 24-hour window to a message from your own phone.
2. One utility template to yourself.
3. Record your own opt-in, then a 1-contact marketing campaign to yourself.
4. Send STOP from your phone. Confirm the opt-out, and that the next marketing send is refused.

- **Stop if:**
  - a message reaches anyone but you
  - a send ends `unknown`
  - any 131xxx error you cannot explain
  - number quality drops
- **Rollback:** pause or cancel in the dashboard. Unsubscribe the second app (Stage 3 rollback).
- **Cost:** per-message charges apply to templates; see Costs.

### Stage 5: Decide who replies to customers, then widen

Decide whether the bot or the dashboard owns replies. Then turn automations on for one keyword only.
Start campaigns small: well under the portfolio messaging limit (new portfolios start at 250 business-initiated per 24 h [6]).

- **Stop if:** quality goes to yellow or red, or block or report rates rise.

## Costs (unknown until checked)

- **Meta.** Per-message pricing since 1 Jul 2025, by category and recipient country, with volume tiers. Read the current rate card [7] and put verified rates in `PRICING_RATES`; until then the dashboard shows **Not set**.
- **Service messages.** Meta's pricing page says service messages above 1,000 per number per month are charged from 1 Oct 2026, and that Meta stops delivering service messages for businesses without a payment method [7]. Confirm both on the account's billing page.
- **Hosting.** Web, worker, Postgres, Redis and media storage: unknown until providers are chosen.
- **Optional.** AI replies (Anthropic usage) and a mail service for invites, if ever enabled.

## Version note

The code uses Graph `v26.0`. Meta's latest is `v27.0` (4 Nov 2026) [8]. Stay on v26.0 for the stages above.
Move up in a separate, tested change before v26.0's deprecation date.

## Decisions and access needed for the next stage (Stage 1 only)

1. **Approval to run Stage 1** on this machine, which makes read-only Graph calls with a real token.
2. **Business settings access** to create the system user and its token with the three permissions. You generate it and paste it into the local Settings form yourself.

Everything else (hosting budget, the second app, first sends) is decided at its own stage.

## Sources (checked 21 Nov 2026)

1. Set up webhooks: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
2. Subscribed apps API: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api
3. Webhook overrides: https://developers.facebook.com/docs/whatsapp/embedded-signup/webhooks/override
4. Access tokens: https://developers.facebook.com/docs/whatsapp/access-tokens
5. Create a webhook endpoint: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
6. Messaging limits: https://developers.facebook.com/docs/whatsapp/messaging-limits
7. Pricing and rate cards: https://developers.facebook.com/docs/whatsapp/pricing#rate-cards-and-volume-tiers
8. Graph API changelog: https://developers.facebook.com/docs/graph-api/changelog
