# Lathar Labs WhatsApp Console

A self-hosted dashboard that puts Lathar Labs' existing WhatsApp bot on the
official Meta WhatsApp Business Cloud API: a shared-team inbox over the bot's
full chat history, replies sent through the official API, and an OTP delivery
view for LpuTV sign-ins.

The bot's brain (wa-relay: Anthropic/Groq pipeline, routines, memory) is
unchanged. This console replaces only the transport: where the unofficial
gateway (OpenWA/wa-automate) used to sit, the console now serves the small
subset of the OpenWA HTTP API the relay actually calls, and exchanges real
messages with Meta's Cloud API.

## What it does

- **Inbox**: live chat list and full history per contact, merging the relay's
  existing SQLite history with new Cloud API traffic (chat ids stay in the
  legacy `<wa_id>@c.us` format, so history carries over).
- **Reply**: send text as the business number through the Cloud API. Outbound
  sends are allowlist-gated (`OUTBOUND_ALLOWLIST`); an empty allowlist denies
  all outbound sends.
- **OTP page**: delivery visibility for LpuTV OTP sign-in codes, with codes
  masked at render time. The historical OTP text is never re-exposed.
- **Webhook**: receives inbound messages and delivery receipts from Meta,
  verifies `X-Hub-Signature-256`, stores them, forwards the message into the
  bot brain through the relay's existing HMAC-gated ingress.
- **OpenWA shim**: `/api/sessions/{session}` status, `/contacts`, `/chats`,
  `/contacts/check`, `send-text`, `react` — enough for wa-relay to run
  unchanged against `OPENWA_BASE=http://labs-console:8788`.

## Stack

Python 3.12 + Flask, SQLite (WAL), Docker. nginx terminates TLS in front and
proxies to the container on localhost. The UI is a single-page vanilla
JS/CSS app in `static/` (Hanken Grotesk + Newsreader, self-hosted
WOFF2 with licenses in `static/fonts/`).

## Repo layout

| File | Purpose |
| --- | --- |
| `server.py` | Flask app: pages, JSON APIs, webhook, OpenWA shim, auth, rate limits |
| `cfg.py` | Env-driven config (all secrets via environment, nothing in source) |
| `graph.py` | Minimal Graph API client (send text, mark read, media download) |
| `store.py` | SQLite storage: messages, receipts, ingress queue, OTP index |
| `meta_translate.py` | Meta webhook payloads -> relay's legacy message format |
| `views.py` | HTML for login / inbox / OTP pages |
| `tests.py` | 44 stdlib-only checks (`python3 tests.py`) |
| `relay_gate_patch.py` | Patch for wa-relay: route outbound via the console shim |
| `lputv-otp-cloudapi.js` | LpuTV backend patch: send OTPs via the Cloud API (gated until an approved Authentication template exists) |
| `Dockerfile`, `DEPLOY.md` | Container image and the full deploy/rollback runbook |

## Run locally

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install flask requests
export META_TOKEN=... META_APP_SECRET=... WEBHOOK_VERIFY_TOKEN=... \
       WEBHOOK_SECRET=... CHAT_PASSWORD=... PHONE_NUMBER_ID=...
python3 server.py   # serves on 127.0.0.1:8788
python3 tests.py    # 44 checks
```

See `DEPLOY.md` for production layout, nginx config, DNS, Meta app wiring,
credential handling (vault-only, never in chat or git), and rollback steps.

## Security notes

- Password login (PBKDF2-HMAC-SHA256, 200k iterations), HttpOnly + Secure +
  SameSite=Strict session cookie, 5/min login rate limit keyed on the direct
  peer (X-Forwarded-For is ignored).
- Webhook signature verification (`X-Hub-Signature-256`, app secret) and
  verify-token challenge.
- Internal relay/console APIs are HMAC-gated and bound to localhost.
- OTP codes and known OTP template sentences are masked at render; the
  database is mounted read-only into the console container.
- No third-party trackers or CDNs; fonts are self-hosted.

Honest caveats: the login rate limit is per-source-IP (a shared NAT is one
bucket), and security headers are minimal (CSP is not yet set). This is a
single-operator internal tool, hardened for its exposure, not a multi-tenant
product.

## Status

Live behind nginx on the Lathar Labs VPS. The LpuTV OTP route is wired but
disabled until a Meta Authentication template is approved (per-message charge,
owner decision). Receipts and history you see in the UI are real webhook data
only — nothing is simulated.
