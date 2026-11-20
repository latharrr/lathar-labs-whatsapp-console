"""Translate Meta webhook payloads into the OpenWA event shape the relay already speaks.

Chat ids: Cloud API gives a plain wa_id (digits, country code first). The relay's legacy ids are
"<digits>@c.us", so history keyed by the same number carries over. No @lid ids exist on this API.
Anything unrecognised is dropped, never guessed at.
"""


def _rec(v):
    return v if isinstance(v, dict) else {}


def _list(v):
    return v if isinstance(v, list) else []


def _str(v):
    return v if isinstance(v, str) and v else None


def translate(body):
    """Returns (events, receipts). events are OpenWA-shaped message.received payloads;
    receipts are (mid, status, billable, category, error)."""
    events, receipts = [], []
    if _rec(body).get("object") != "whatsapp_business_account":
        return events, receipts
    for entry in _list(_rec(body).get("entry")):
        for change in _list(_rec(entry).get("changes")):
            change = _rec(change)
            if change.get("field") != "messages":
                continue
            value = _rec(change.get("value"))
            names = {}
            for c in _list(value.get("contacts")):
                c = _rec(c)
                wa, name = _str(c.get("wa_id")), _str(_rec(c.get("profile")).get("name"))
                if wa:
                    names[wa] = name or ""
            for m in _list(value.get("messages")):
                m = _rec(m)
                frm, mid = _str(m.get("from")), _str(m.get("id"))
                if not frm or not mid:
                    continue
                typ = _str(m.get("type")) or ""
                chat = f"{frm}@c.us"
                media = _rec(m.get(typ)) if typ else {}
                body = None
                if typ == "text":
                    body = _str(_rec(m.get("text")).get("body"))
                events.append({
                    "event": "message.received",
                    "data": {
                        "id": mid,
                        "from": chat,
                        "chatId": chat,
                        "fromMe": False,
                        "isGroup": False,
                        "type": {"text": "chat"}.get(typ, typ or "chat"),
                        "body": body,
                        "caption": _str(media.get("caption")) or "",
                        "timestamp": _str(m.get("timestamp")) or "0",
                        "notifyName": names.get(frm, ""),
                        "mediaId": _str(media.get("id")) if typ in ("audio", "image", "sticker", "video", "document") else None,
                        "mime": _str(media.get("mime_type")),
                    },
                })
            for s in _list(value.get("statuses")):
                s = _rec(s)
                mid, status = _str(s.get("id")), _str(s.get("status"))
                if not mid or not status:
                    continue
                pricing = _rec(s.get("pricing"))
                billable = pricing.get("billable") if isinstance(pricing.get("billable"), bool) else None
                errs = _list(s.get("errors"))
                code = _rec(errs[0]).get("code") if errs else None
                receipts.append((mid, status, billable, _str(pricing.get("category")),
                                 f"meta_error_{code}" if isinstance(code, int) else None))
    return events, receipts
