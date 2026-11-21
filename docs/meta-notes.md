# Meta Cloud API details: what was verified, and open conflicts

Checked against Meta's developer documentation on 20–21 Nov 2026. The code uses Graph API `v26.0`; Meta's latest is
`v27.0` (4 Nov 2026, Graph changelog). Move up in a separate tested change. Where Meta's
own pages and third-party pages disagree, the code follows Meta and the conflict is listed here.
Nothing below was exercised against a live Meta account: there are no real credentials in this build.

## Verified and implemented

| Topic | What the code does | Source |
|---|---|---|
| Webhook verify + signature | GET echoes `hub.challenge` for the right verify token; POST checks `X-Hub-Signature-256` (HMAC-SHA256 of raw bytes, app secret) | Webhooks guide |
| Mark as read + typing indicator | `POST /{phone-id}/messages` `{ status: "read", message_id, typing_indicator: { type: "text" } }`; within 30 days; indicator lasts up to 25 s | developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators |
| Media download | `GET /{media-id}` → short-lived `url`; `GET url` with the same bearer token | Media reference |
| Media upload | `POST /{phone-id}/media` multipart (`messaging_product`, `type`, `file`) → id | Media reference |
| Resumable upload | `POST /{app-id}/uploads?file_name&file_length&file_type` → `upload:` id; `POST /{upload-id}` with `Authorization: OAuth`, `file_offset: 0` → handle `h` | Graph Resumable Upload |
| Business profile | `GET/POST /{phone-id}/whatsapp_business_profile`, fields about, address, description, email, websites, vertical, `profile_picture_handle` | Business profiles |
| Template create | `POST /{waba-id}/message_templates` with HEADER/BODY/FOOTER/BUTTONS components and `example` (body_text, header_text, header_handle); URL button `{{1}}` at the end; one COPY_CODE | Template components, coupon templates |
| Template send | `components` with `header`, `body`, `button` `sub_type: url` / `copy_code` (`coupon_code`) | Template components |
| Template sync | `GET /{waba-id}/message_templates?fields=…` with cursor paging | Templates API |
| Statuses + pricing | per-message pricing object `{ billable, category, type }` on status webhooks | Pricing / webhooks |
| Messaging limit field | `whatsapp_business_manager_messaging_limit` (portfolio level), fallback to deprecated `messaging_limit_tier` on error 100 | Messaging limits |
| user_preferences webhook | field `user_preferences`, items `{ wa_id, category: "marketing_messages", value: "stop" \| "resume", timestamp }` | webhooks/reference/user_preferences |
| Error 131050 | user stopped marketing messages: recorded as an opt-out, never retried | Error codes |
| Webhook delivery | Retries on non-200 for up to 7 days, possibly duplicated; batches up to 1,000 updates and 3 MB. The route accepts 4 MB and processing is idempotent | Webhooks overview; create-webhook-endpoint |
| Callback overrides | WABA: `POST /<WABA_ID>/subscribed_apps {override_callback_uri, verify_token}`; phone: `POST /<PHONE_ID> {webhook_configuration:{override_callback_uri, verify_token}}`. Precedence phone > WABA > app. Only some fields (e.g. `messages`, `message_echoes`, `calls`) follow an override; `account_alerts`, `account_update`, template and `phone_number_quality_update` always go to the app default | Webhook overrides |
| Several apps on one WABA | `GET /<WABA_ID>/subscribed_apps` lists all subscribed apps; Meta delivers to every subscribed app. No limit stated | Subscribed apps API; webhooks page |
| System user token | Permissions `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`; system user (admin or employee) needs access to the WABA. Docs say "long-lived"/"permanent", not "never expires" | Access tokens; Permissions |
| App mode | "Make sure your app is in Live mode; some webhooks will not be sent if your app is in Dev mode." Self-signed TLS not accepted | Create webhook endpoint |

## Unresolved conflicts (decide or re-check before go-live)

1. **Messaging limit tiers in 2026.** Meta's messaging-limits page (re-checked 21 Nov 2026) lists per-portfolio
   limits of 250, 2K, 10K, 100K and unlimited, with new portfolios starting at 250. Third-party pages still mention
   "portfolio pacing" and a 1K start. The code does not
   hard-code a ladder: it reads whatever `TIER_*` Meta returns and caps business-initiated templates at
   that number per rolling 24 h (counting every non-service template, which over-counts). If Meta
   returns a value the parser does not know, no local cap is applied and Meta's own limit still holds.
2. **Marketing opt-out button payload.** Meta does not document the payload of the template
   "Marketing opt-out" quick reply. Vendor docs show `MARKETING_OPT_OUT` or the button text. The code
   matches the opt-out words (default STOP, UNSUBSCRIBE, STOP PROMOTIONS, NOT INTERESTED) against the text,
   the payload and interactive titles, and also honours `user_preferences` and error 131050.
3. **`user_preferences` availability.** Meta says this field is being rolled out gradually. It may never
   arrive for a given app; the keyword and 131050 paths do not depend on it. A `user_id` (BSUID) field is
   mentioned by third parties only; the code keys on `wa_id`.
4. **Webhook retry window.** The WhatsApp webhooks page says failed deliveries are retried and "dropped after 7 days";
   the generic Graph webhooks page says 36 hours. The code does not depend on either (events are stored before the 200).
5. **Free service messages.** Meta's pricing page says service messages above 1,000 per number per month are charged
   from 1 Oct 2026, and that service messages stop being delivered for businesses without a payment method. Older pages disagree.
   Rates are configuration (`PRICING_RATES`), unset by default; nothing is estimated until verified rates
   are supplied.
6. **Template category on review.** Meta may change the category (e.g. utility → marketing). The sync and
   the `message_template_status_update` webhook update the stored category; campaigns re-read it per send.

## Not verified at all (needs a live account)

Every Graph write: sends, uploads, template submission, profile update. Response shapes were taken from
the docs; error handling is tested against mocked responses only.
