# Labs console - official WhatsApp API transport + dashboard

Keeps the existing bot (wa-relay) exactly as-is and swaps its WhatsApp transport
from the unofficial OpenWA session to the official Meta Cloud API, plus a small
dashboard: inbox (read/reply) and OTP delivery view.

## How it fits

```
Meta --webhook--> console :8788 --(OpenWA-shaped, HMAC)--> wa-relay :8787 (unchanged brain)
wa-relay --(OpenWA API shape)--> console shim --> Graph API
LpuTV backend --/admin/otp-send (HMAC)--> console --> Graph API (Authentication template)
browser --> nginx (wa.deepanshulathar.com, TLS) --> console dashboard
```

- console.py = Meta webhook (signed, durable queue with retry) + OpenWA-compatible
  shim (send-text, react, contacts/chats/messages from its mirror, media download)
  + OTP endpoint + dashboard.
- relay.py needs NO code changes for transport: point OPENWA_BASE at the console.
- console.db stores the webhook queue, message mirror, receipts, OTP sends
  (never the code), and dashboard sessions. relay.db is mounted read-only.

## Feature gates (relayed from main: nothing dormant reactivates silently)

The relay restart keeps these OFF unless explicitly re-enabled by the owner,
because official-API rules change them (proactive sends need approved templates):

- 8am digest to owner        RELAY_DIGEST_ENABLED=on to re-enable
- 9pm unreplied sweep        RELAY_SWEEP_ENABLED=on
- meeting reminders          RELAY_REMINDERS_ENABLED=on
- mess-menu alerts           RELAY_MESS_ENABLED=on

## Env (.env, never committed)

    META_APP_SECRET=          # Meta app dashboard -> App secret
    META_VERIFY_TOKEN=        # we generate: openssl rand -hex 20 (we paste it into Meta)
    META_TOKEN=               # Graph API access token (see "credentials" below)
    META_PHONE_NUMBER_ID=     # WhatsApp -> API Setup -> Phone number ID
    WEBHOOK_SECRET=           # existing relay HMAC secret (unchanged)
    OPENWA_API_KEY=           # existing relay->shim key (unchanged value)
    OTP_HMAC_SECRET=          # shared with LpuTV backend env
    OTP_TEMPLATE=otp          # name of the approved Authentication template
    CONSOLE_PASSWORD=         # dashboard login (vault)
    RELAY_DB=/relay-data/relay.db

## Run (Docker, on the VPS)

    docker build -t labs-console .
    docker run -d --name labs-console --restart unless-stopped \
      --env-file .env -p 127.0.0.1:8788:8788 \
      -v /opt/automations/labs-console/data:/data \
      -v /opt/automations/wa-relay/data:/relay-data:ro \
      labs-console

Relay change: in /opt/automations/wa-relay/compose.yaml set
OPENWA_BASE=http://host.docker.internal:8788 (or the console container IP),
then `docker compose up -d wa-relay` (openwa-api stays stopped).

## nginx (public edge; only these two paths need the internet)

    server {
        listen 443 ssl; server_name wa.deepanshulathar.com;
        # certbot-managed certs
        location /webhook/meta { proxy_pass http://127.0.0.1:8788; }
        location / { proxy_pass http://127.0.0.1:8788; }   # dashboard, password-gated
    }

## Meta app changes (once, in the dashboard)

1. Webhook callback: https://wa.deepanshulathar.com/webhook/meta + META_VERIFY_TOKEN,
   subscribe to the `messages` field.
2. Create the Authentication template named `otp` (copy-code button), language en.
3. Access token: whatever the owner/Claude set up. Submit via vault, never chat.

## Test plan (before any real use)

1. `python3 tests.py` - 30 checks (translation, dedup, error mapping, no-code
   retention, sessions, escaping).
2. Dry-run locally with mock Meta; confirm ingress retry and shim shapes.
3. Live: one Authentication-template send to the owner number only; confirm the OTP
   page shows accepted -> delivered; reply from the phone; confirm it lands in
   the inbox and the bot answers. No other recipients, no auto-replies to clients.

## Rollback

Stop the console; point the relay's OPENWA_BASE back at openwa-api and
`docker compose up -d openwa-api wa-relay`. All session files and data are intact.
