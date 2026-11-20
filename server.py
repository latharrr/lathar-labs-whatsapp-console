"""Labs console: Meta webhook receiver, OpenWA-compatible shim for the unchanged relay,
OTP send endpoint, and the dashboard. Python stdlib only."""
import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import graph
import store
from cfg import Cfg
from meta_translate import translate
from views import Views

log = logging.getLogger("console")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MAX_BODY = 512 * 1024
MEDIA_MAX_BYTES = 8 * 1024 * 1024
CHAT_RE = re.compile(r"^\d{8,15}@c\.us$")
PHONE_RE = re.compile(r"^\+91[6-9]\d{9}$")
CODE_RE = re.compile(r"^\d{4,8}$")


def allowlisted(number):
    """Every outbound path gates on this: brain sends via the shim, dashboard
    replies via the relay, OTP sends via /admin/otp-send."""
    if not Cfg.OUTBOUND_ALLOWLIST:
        return True
    return re.sub(r"\D", "", str(number)) in Cfg.OUTBOUND_ALLOWLIST


def sig_ok(secret, raw, header, name):
    """X-Hub-Signature-256 / X-Relay-Signature style check, constant time."""
    exp = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    ok = hmac.compare_digest(header or "", exp)
    if not ok:
        log.warning("%s: bad signature", name)
    return ok


def relay_post(path, obj, timeout=20):
    """Signed call into the relay's existing endpoints."""
    raw = json.dumps(obj).encode()
    req = urllib.request.Request(Cfg.RELAY_BASE + path, data=raw, method="POST", headers={
        "Content-Type": "application/json",
        "X-Relay-Signature" if path.startswith("/admin/") else "X-OpenWA-Signature":
            "sha256=" + hmac.new(Cfg.RELAY_SECRET.encode(), raw, hashlib.sha256).hexdigest()})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status


def ingress_worker():
    """Durable delivery: Meta payload -> relay webhook, with backoff; mirrors to console.db."""
    while True:
        try:
            row = store.next_ingress()
            if not row:
                time.sleep(0.5)
                continue
            key, payload = row
            ok = True
            try:
                events, receipts = translate(json.loads(payload))
                for mid, status, billable, category, error in receipts:
                    store.add_receipt(mid, status, billable, category, error)
                for ev in events:
                    d = ev["data"]
                    if d.get("mediaId"):
                        store.map_media(d["id"], d["mediaId"], d.get("mime") or "")
                    store.remember_contact(d["chatId"], d.get("notifyName") or "")
                    try:
                        ts = float(d.get("timestamp") or 0)
                    except (TypeError, ValueError):
                        ts = time.time()
                    store.mirror_message(d["chatId"], "incoming", d.get("body") or f"[{d.get('type')}]", ts, d["id"])
                    relay_post("/webhook", ev)
                store.finish_ingress(key, True)
            except Exception as e:
                ok = False
                log.error("ingress delivery failed (will retry): %s", type(e).__name__)
                store.finish_ingress(key, False)
        except Exception:
            log.exception("ingress worker")
            time.sleep(1)


# ---- OpenWA-error compatible mapping -------------------------------------

def send_error(err):
    """Map a Graph failure to the HTTP contract the relay already handles."""
    if not isinstance(err, graph.GraphError):
        return 502, {"error": "transport error, not sent"}
    # sanitized observability: numeric codes only, never bodies/tokens/recipients
    log.warning("graph send failed: http=%s meta_code=%s", err.http_status, err.code)
    if err.http_status == 0:
        return 502, {"error": "could not reach Meta, not sent"}
    if err.code == 131026:
        return 400, {"error": "unknown recipient: not on WhatsApp"}
    if err.code == 131047:
        return 400, {"error": "outside the 24-hour reply window; an approved template is required"}
    if err.code == 131030:
        return 400, {"error": "recipient not allowed while the Meta app is in development mode"}
    if err.code in (130429, 130497):
        return 429, {"error": "rate limited by Meta"}
    if err.code in (190, 102, 103) or err.http_status in (401, 403):
        return 401, {"error": "Meta access token rejected or expired"}
    if err.http_status and err.http_status >= 500:
        return 502, {"error": f"Meta server error {err.http_status}"}
    return 400, {"error": f"meta_error_{err.code}" if err.code else f"http_{err.http_status}"}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _json(self, code, obj, headers=None):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def _raw(self, code, body, ctype="text/plain; charset=utf-8", headers=None):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if n > MAX_BODY:
            return None
        return self.rfile.read(n) if n else b""

    # ------------------------------------------------------------- GET
    def do_GET(self):
        u = urlparse(self.path)
        path = u.path
        if path == "/webhook/meta":  # Meta's one-time verification handshake
            q = parse_qs(u.query)
            if (q.get("hub.mode", [""])[0] == "subscribe"
                    and hmac.compare_digest(q.get("hub.verify_token", [""])[0], Cfg.META_VERIFY_TOKEN)):
                return self._raw(200, q.get("hub.challenge", [""])[0])
            return self._json(403, {"error": "bad verify token"})
        if path == "/healthz":
            return self._json(200, {"ok": True, "meta_token_set": bool(Cfg.META_TOKEN),
                                    "ingress_pending": store.next_ingress() is not None})

        # ---- OpenWA-compatible shim used by the relay
        m = re.match(r"^/api/sessions/([^/]+)(/.*)?$", path)
        if m:
            if not hmac.compare_digest(self.headers.get("X-API-Key", ""), Cfg.SHIM_API_KEY):
                return self._json(401, {"error": "bad api key"})
            return self._shim_get(m.group(2) or "", parse_qs(u.query))

        # ---- dashboard
        views = Views(self)
        if path == "/login":
            return views.login_page()
        if path.startswith("/static/"):
            return views.static(path)
        if not views.require_session():
            return
        if path == "/":
            return views.inbox()
        if path == "/chat":
            return views.chat(parse_qs(u.query).get("id", [""])[0])
        if path == "/otp":
            return views.otp()
        return self._json(404, {"error": "not found"})

    def _shim_get(self, sub, q):
        if sub == "":
            return self._json(200, {"status": "ready", "lastError": None})
        if sub == "/contacts":
            rows = [{"id": c, "number": c.split("@")[0], "pushName": n} for c, n in store.contacts_all()]
            return self._json(200, rows)
        if sub == "/chats":
            contacts = dict(store.contacts_all())
            rows = [{"id": c, "name": contacts.get(c) or c.split("@")[0]}
                    for c, _ in sorted(store.mirror_chat_ids(), key=lambda r: -r[1])]
            return self._json(200, rows)
        m = re.match(r"^/contacts/check/(\d+)$", sub)
        if m:
            return self._json(200, {"whatsappId": bool(re.fullmatch(r"\d{8,15}", m.group(1)))})
        if re.match(r"^/contacts/[^/]+/phone$", sub):
            return self._json(404, {"error": "no lid mapping on the official API"})
        m = re.match(r"^/messages/([^/]+)/([^/]+)/media$", sub)
        if m:
            media_id = store.media_for(m.group(2))
            if not media_id:
                return self._json(404, {"error": "unknown media"})
            try:
                data = graph.download_media(media_id, MEDIA_MAX_BYTES)
            except Exception:
                data = None
            if not data:
                return self._json(502, {"error": "media download failed"})
            return self._raw(200, data, "application/octet-stream")
        if sub == "/messages":
            chat = q.get("chatId", [""])[0]
            limit = min(int(q.get("limit", ["50"])[0] or 50), 200)
            rows = [{"direction": d, "fromMe": d == "outgoing", "body": b, "type": "chat",
                     "timestamp": ts, "waMessageId": mid} for d, b, ts, mid in store.mirror_messages(chat, limit)]
            return self._json(200, rows)
        return self._json(404, {"error": "not found"})

    # ------------------------------------------------------------- POST
    def do_POST(self):
        u = urlparse(self.path)
        path = u.path
        raw = self._body()
        if raw is None:
            return self._json(413, {"error": "too large"})

        if path == "/webhook/meta":
            if not sig_ok(Cfg.META_APP_SECRET, raw, self.headers.get("X-Hub-Signature-256"), "meta webhook"):
                return self._json(401, {"error": "bad signature"})
            key = hashlib.sha256(raw).hexdigest()
            store.add_ingress(key, raw.decode("utf-8", "replace"))  # durable before ack; dupes ignored
            return self._json(200, {"ok": True})

        m = re.match(r"^/api/sessions/[^/]+/messages/(send-text|react)$", path)
        if m:
            if not hmac.compare_digest(self.headers.get("X-API-Key", ""), Cfg.SHIM_API_KEY):
                return self._json(401, {"error": "bad api key"})
            return self._shim_send(m.group(1), raw)

        if path == "/admin/otp-send":
            return self._otp_send(raw)

        views = Views(self)
        if path == "/login":
            return views.login_submit(raw)
        if path == "/logout":
            return views.logout()
        if path == "/reply":
            return views.reply(raw, relay_post)
        return self._json(404, {"error": "not found"})

    def _shim_send(self, kind, raw):
        try:
            req = json.loads(raw.decode("utf-8", "replace") or "{}")
        except Exception:
            return self._json(400, {"error": "bad json"})
        chat = str(req.get("chatId") or "")
        if not CHAT_RE.match(chat):
            return self._json(400, {"error": "bad chatId"})
        to = chat.split("@")[0]
        if not allowlisted(to):
            log.warning("outbound blocked by allowlist: %s...%s", to[:3], to[-2:])
            return self._json(403, {"success": False, "error": "recipient not in outbound allowlist"})
        try:
            if kind == "send-text":
                text = str(req.get("text") or "")[:4096]
                if not text:
                    return self._json(400, {"error": "empty text"})
                mid = graph.send_text(to, text)
                store.mirror_message(chat, "outgoing", text, time.time(), mid)
            else:
                mid = graph.send_reaction(to, str(req.get("messageId") or ""), str(req.get("emoji") or "")[:8])
            return self._json(200, {"success": True, "messageId": mid})
        except Exception as e:
            code, obj = send_error(e)
            headers = {"Retry-After": "30"} if code == 429 else None
            return self._json(code, obj, headers)

    def _otp_send(self, raw):
        """LpuTV (and later other Lathar Labs backends) request an OTP here.
        The code passes through to Meta and is never stored or logged."""
        if not sig_ok(Cfg.OTP_HMAC_SECRET, raw, self.headers.get("X-Relay-Signature"), "otp-send"):
            return self._json(401, {"error": "bad signature"})
        try:
            req = json.loads(raw.decode("utf-8", "replace") or "{}")
        except Exception:
            return self._json(400, {"error": "bad json"})
        phone, code = str(req.get("phone") or ""), str(req.get("code") or "")
        if not PHONE_RE.match(phone):
            return self._json(400, {"error": "bad phone"})
        if not CODE_RE.match(code):
            return self._json(400, {"error": "bad code"})
        if not allowlisted(phone):
            log.warning("otp blocked by allowlist: %s...%s", phone[:4], phone[-2:])
            store.add_otp_send(phone, Cfg.OTP_TEMPLATE, "failed", "", "not in outbound allowlist")
            return self._json(403, {"error": "recipient not in outbound allowlist"})
        try:
            mid = graph.send_otp_template(phone.lstrip("+"), code)
            store.add_otp_send(phone, Cfg.OTP_TEMPLATE, "accepted", mid)
            log.info("otp accepted by Meta for %s...%s", phone[:4], phone[-2:])
            return self._json(200, {"ok": True})
        except Exception as e:
            code_http, obj = send_error(e)
            store.add_otp_send(phone, Cfg.OTP_TEMPLATE, "failed", "", obj.get("error", "")[:60])
            if code_http == 401:
                obj = {"error": "auth"}  # match otp.js's auth handling
            log.warning("otp send failed for %s...%s: %s", phone[:4], phone[-2:], obj.get("error"))
            return self._json(400 if code_http == 400 else code_http, obj)


def main():
    threading.Thread(target=ingress_worker, daemon=True).start()
    bind = os.environ.get("BIND", "0.0.0.0")  # in-container default; publish restricts exposure
    log.info("labs-console listening on %s:%s", bind, Cfg.PORT)
    ThreadingHTTPServer((bind, Cfg.PORT), H).serve_forever()


if __name__ == "__main__":
    main()
