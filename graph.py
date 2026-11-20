"""Graph API calls for the official WhatsApp Cloud API. Never logs the token or OTP codes."""
import json
import urllib.request
import urllib.error

from cfg import Cfg


class GraphError(Exception):
    def __init__(self, code, http_status):
        super().__init__(f"meta_error_{code}")
        self.code = code          # Meta's numeric error code, 0 for transport/5xx
        self.http_status = http_status


def _call(path, payload, timeout=20):
    req = urllib.request.Request(
        f"{Cfg.GRAPH_BASE}/{Cfg.GRAPH_VERSION}/{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {Cfg.META_TOKEN}"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        code = 0
        try:
            code = int(json.loads(e.read() or b"{}").get("error", {}).get("code") or 0)
        except Exception:
            pass
        raise GraphError(code, e.code)
    except urllib.error.URLError:
        raise GraphError(0, 0)     # never reached Meta: outcome unknown
    msgs = body.get("messages") or []
    mid = msgs[0].get("id") if msgs and isinstance(msgs[0], dict) else None
    if not mid:
        raise GraphError(0, 200)   # unreadable answer: treat as unknown, never retry blindly
    return mid


def send_text(to_digits, text):
    return _call(f"{Cfg.PHONE_NUMBER_ID}/messages", {
        "messaging_product": "whatsapp", "recipient_type": "individual",
        "to": to_digits, "type": "text",
        "text": {"preview_url": False, "body": text}})


def send_reaction(to_digits, message_id, emoji):
    return _call(f"{Cfg.PHONE_NUMBER_ID}/messages", {
        "messaging_product": "whatsapp", "recipient_type": "individual",
        "to": to_digits, "type": "reaction",
        "reaction": {"message_id": message_id, "emoji": emoji}})


def send_otp_template(to_digits, code):
    """Authentication template: fixed Meta text, body param {{1}} = code, copy-code button.
    The code is used for this call only and is never stored or logged here."""
    return _call(f"{Cfg.PHONE_NUMBER_ID}/messages", {
        "messaging_product": "whatsapp", "recipient_type": "individual",
        "to": to_digits, "type": "template",
        "template": {
            "name": Cfg.OTP_TEMPLATE,
            "language": {"code": Cfg.OTP_TEMPLATE_LANG},
            "components": [
                {"type": "body", "parameters": [{"type": "text", "text": code}]},
                {"type": "button", "sub_type": "url", "index": "0",
                 "parameters": [{"type": "text", "text": code}]},
            ]}})


def mark_read(message_id):
    try:
        _call(f"{Cfg.PHONE_NUMBER_ID}/messages", {
            "messaging_product": "whatsapp", "status": "read",
            "message_id": message_id})
    except GraphError:
        pass  # cosmetic only


def media_url(media_id):
    req = urllib.request.Request(
        f"{Cfg.GRAPH_BASE}/{Cfg.GRAPH_VERSION}/{media_id}",
        headers={"Authorization": f"Bearer {Cfg.META_TOKEN}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read() or b"{}").get("url")


def download_media(media_id, max_bytes):
    url = media_url(media_id)
    if not url:
        return None
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {Cfg.META_TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read(max_bytes + 1)
    return data if 0 < len(data) <= max_bytes else None
