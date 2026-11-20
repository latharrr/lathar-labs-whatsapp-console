"""Dashboard UI: inbox (read/reply), OTP delivery view. Single-user, cookie session + CSRF."""
import hashlib
import hmac
import html
import os
import re
import secrets
import time
from http.cookies import SimpleCookie
from urllib.parse import parse_qs

import store
from cfg import Cfg

LOGIN_ATTEMPTS = {}  # ip -> [timestamps]


def esc(s):
    return html.escape(str(s), quote=True)


CODE_RE = re.compile(r"\d{4,8}")

# Historical LpuTV OTP texts (4 variants, sent as full sentences over the old
# unofficial sender). The code inside a matching sentence is redacted on render;
# the stored message is never changed.
OTP_TPL_RE = [
    re.compile(r"(?<=^LpuTV login code: )\d{4,8}(?=\. Valid for \d+ minutes\. Don't share it with anyone\.$)"),
    re.compile(r"^\d{4,8}(?= is your LpuTV code\. It expires in \d+ minutes\.)"),
    re.compile(r"(?<=^Your LpuTV verification code is )\d{4,8}(?= \(valid \d+ min\)\.)"),
    re.compile(r"^\d{4,8}(?= - LpuTV login code, expires in \d+ minutes\.)"),
]


def mask_code(body):
    """Never render a code in the dashboard; stored history is kept unchanged.
    Bare code-shaped messages are hidden whole; codes inside the known OTP
    template sentences are redacted in place. Normal numbers are untouched."""
    body = str(body)
    if CODE_RE.fullmatch(body.strip()):
        return "[code hidden]"
    for tpl in OTP_TPL_RE:
        body = tpl.sub("[code hidden]", body)
    return body


def fmt_ts(ts):
    return time.strftime("%d %b %H:%M", time.localtime(float(ts)))


def page(title, body, extra_head=""):
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · Lathar Labs</title>
<link rel="stylesheet" href="/static/tokens.css"><link rel="stylesheet" href="/static/console.css">
{extra_head}</head><body>
<header class="top"><span class="brand">Lathar Labs</span>
<nav><a href="/">Inbox</a><a href="/otp">OTP delivery</a><a href="/logout" class="dim">Log out</a></nav></header>
<main>{body}</main></body></html>"""


class Views:
    def __init__(self, handler):
        self.h = handler

    # ---- auth ----
    def _client_ip(self):
        return self.h.client_address[0]

    def _cookie_token(self):
        c = SimpleCookie(self.h.headers.get("Cookie") or "")
        m = c.get("lc_session")
        return m.value if m else ""

    def require_session(self):
        csrf = store.get_session(self._cookie_token())
        if csrf is None:
            self.h.send_response(302)
            self.h.send_header("Location", "/login")
            self.h.send_header("Content-Length", "0")
            self.h.end_headers()
            return False
        self.csrf = csrf
        return True

    def login_page(self, error=""):
        msg = f'<p class="err">{esc(error)}</p>' if error else ""
        return self.h._raw(200, page("Log in", f"""
<form class="card login" method="post" action="/login">
<h1>Lathar Labs console</h1>{msg}
<label>Password <input type="password" name="password" autocomplete="current-password" required autofocus></label>
<button type="submit">Log in</button></form>"""), "text/html; charset=utf-8")

    def login_submit(self, raw):
        ip = self._client_ip()
        now = time.time()
        tries = [t for t in LOGIN_ATTEMPTS.get(ip, []) if now - t < 60]
        if len(tries) >= 5:
            return self.login_page("Too many attempts. Wait a minute.")
        pw = parse_qs(raw.decode("utf-8", "replace")).get("password", [""])[0]
        if not hmac.compare_digest(pw.encode(), Cfg.CONSOLE_PASSWORD.encode()):
            tries.append(now)
            LOGIN_ATTEMPTS[ip] = tries
            return self.login_page("Wrong password.")
        token, csrf = secrets.token_hex(32), secrets.token_hex(16)
        store.new_session(token, csrf)
        self.h.send_response(302)
        self.h.send_header("Location", "/")
        self.h.send_header("Set-Cookie", f"lc_session={token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200")
        self.h.send_header("Content-Length", "0")
        self.h.end_headers()

    def logout(self):
        store.drop_session(self._cookie_token())
        self.h.send_response(302)
        self.h.send_header("Location", "/login")
        self.h.send_header("Set-Cookie", "lc_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0")
        self.h.send_header("Content-Length", "0")
        self.h.end_headers()

    def static(self, path):
        rel = path[len("/static/"):]
        if "/" in rel or ".." in rel:
            return self.h._json(404, {"error": "not found"})
        full = os.path.join(Cfg.STATIC_DIR, rel)
        if rel.startswith("fonts/"):
            full = os.path.join(Cfg.STATIC_DIR, rel)
        try:
            with open(full, "rb") as f:
                data = f.read()
        except OSError:
            return self.h._json(404, {"error": "not found"})
        ctype = ("text/css" if rel.endswith(".css")
                 else "font/woff2" if rel.endswith(".woff2") else "application/octet-stream")
        return self.h._raw(200, data, ctype)

    # ---- data ----
    def _relay_threads(self):
        conn = store.relay_ro()
        if conn is None:
            return None
        try:
            rows = conn.execute(
                "SELECT chat, body, role, ts FROM messages m WHERE ts = "
                "(SELECT MAX(ts) FROM messages WHERE chat = m.chat) ORDER BY ts DESC LIMIT 100").fetchall()
            counts = dict(conn.execute("SELECT chat, COUNT(*) FROM messages GROUP BY chat").fetchall())
            names = dict(conn.execute("SELECT chat, profile FROM profiles").fetchall())
        except Exception:
            return None
        finally:
            conn.close()
        contacts = dict(store.contacts_all())
        threads = []
        for chat, body, role, ts in rows:
            threads.append({"chat": chat, "last": body, "role": role, "ts": ts,
                            "count": counts.get(chat, 0),
                            "name": contacts.get(chat) or ""})
        return threads

    def _label(self, chat, name=""):
        digits = chat.split("@")[0]
        pretty = f"+91 {digits[2:7]} {digits[7:]}" if digits.startswith("91") and len(digits) == 12 else f"+{digits}"
        return f"{name} · {pretty}" if name else pretty

    # ---- pages ----
    def inbox(self):
        threads = self._relay_threads()
        if threads is None:
            body = '<p class="err">The bot database is not readable right now. The bot itself is unaffected.</p>'
        elif not threads:
            body = '<p class="dim">No conversations yet. They appear here when the bot talks on the official number.</p>'
        else:
            items = "".join(f"""
<a class="thread" href="/chat?id={esc(t['chat'])}">
  <span class="t-name">{esc(self._label(t['chat'], t['name']))}</span>
  <span class="t-time">{fmt_ts(t['ts'])}</span>
  <span class="t-last">{esc(('You: ' if t['role'] == 'assistant' else '') + mask_code(t['last'][:90]))}</span>
</a>""" for t in threads)
            body = f'<h1>Inbox</h1><div class="threads">{items}</div>'
        return self.h._raw(200, page("Inbox", body), "text/html; charset=utf-8")

    def chat(self, chat, notice=""):
        if not chat:
            return self.h._json(400, {"error": "missing chat"})
        conn = store.relay_ro()
        msgs = []
        if conn is not None:
            try:
                msgs = conn.execute(
                    "SELECT role, body, ts FROM messages WHERE chat=? ORDER BY ts DESC LIMIT 60",
                    (chat,)).fetchall()[::-1]
            except Exception:
                msgs = []
            finally:
                conn.close()
        bubbles = "".join(
            f'<div class="bubble {"out" if role == "assistant" else "in"}">'
            f'{esc(mask_code(body))}<span class="b-time">{fmt_ts(ts)}</span></div>'
            for role, body, ts in msgs)
        warn = ('<p class="warn">Replies only reach the person within 24 hours of their last message. '
                "Later replies need a Meta-approved template.</p>")
        note = f'<p class="err">{esc(notice)}</p>' if notice else ""
        body = f"""
<p><a href="/" class="dim">&larr; Inbox</a></p>
<h1>{esc(self._label(chat))}</h1>{note}
<div class="convo">{bubbles or '<p class="dim">No stored messages for this chat.</p>'}</div>
{warn}
<form method="post" action="/reply" class="replybox">
<input type="hidden" name="csrf" value="{esc(self.csrf)}">
<input type="hidden" name="chat" value="{esc(chat)}">
<textarea name="text" rows="2" maxlength="2000" required placeholder="Reply as Lathar Labs&hellip;"></textarea>
<button type="submit">Send</button></form>"""
        return self.h._raw(200, page(self._label(chat), body), "text/html; charset=utf-8")

    def reply(self, raw, relay_post):
        if not self.require_session():
            return
        form = parse_qs(raw.decode("utf-8", "replace"))
        if not hmac.compare_digest(form.get("csrf", [""])[0], self.csrf):
            return self.h._json(403, {"error": "bad csrf"})
        chat = form.get("chat", [""])[0]
        text = (form.get("text", [""])[0] or "").strip()
        if not text:
            return self.chat(chat, "Nothing to send.")
        try:
            relay_post("/admin/send", {"chat": chat, "text": text})
        except urllib_error() as e:
            try:
                detail = e.read().decode("utf-8", "replace")[:200]
            except Exception:
                detail = ""
            return self.chat(chat, f"Not delivered: {detail or 'the bot refused the send'}")
        except Exception:
            return self.chat(chat, "Not delivered: the bot is unreachable.")
        self.h.send_response(302)
        self.h.send_header("Location", f"/chat?id={chat}")
        self.h.send_header("Content-Length", "0")
        self.h.end_headers()

    def otp(self):
        rows = store.otp_recent(100)
        if not rows:
            items = '<p class="dim">No OTP sends yet on the official number.</p>'
        else:
            lines = "".join(f"""<tr><td>{fmt_ts(ts)}</td><td>{esc(phone)}</td>
<td><span class="status s-{esc(status)}">{esc(status)}</span></td>
<td class="dim">{esc(error or "")}</td></tr>""" for ts, phone, template, status, error in rows)
            items = f"""<table class="otp"><thead><tr><th>Time</th><th>To</th><th>Status</th><th>Detail</th></tr></thead>
<tbody>{lines}</tbody></table>"""
        body = f"""<h1>OTP delivery</h1>
<p class="dim">Login codes sent from the official number. New codes travel in Meta's authentication
template and are not stored or shown here. Status comes from Meta's delivery
receipts: accepted &rarr; delivered &rarr; read, or failed. Older login codes from the previous
unofficial setup remain in the retained chat history; codes in the recognized old message formats
are hidden on screen.</p>
{items}"""
        return self.h._raw(200, page("OTP delivery", body), "text/html; charset=utf-8")


def urllib_error():
    import urllib.error
    return urllib.error.HTTPError
