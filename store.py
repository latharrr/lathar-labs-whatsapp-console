"""SQLite storage for the console. relay.db is only ever opened read-only."""
import sqlite3
import threading
import time

from cfg import Cfg

_lock = threading.Lock()
db = sqlite3.connect(Cfg.CONSOLE_DB, check_same_thread=False)
db.execute("PRAGMA journal_mode=WAL")

SCHEMA = [
    # Durable webhook queue: stored before Meta gets its 200, retried until delivered.
    "CREATE TABLE IF NOT EXISTS meta_ingress (key TEXT PRIMARY KEY, payload TEXT NOT NULL,"
    " created REAL NOT NULL, done INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0,"
    " next_retry REAL NOT NULL DEFAULT 0)",
    # Message mirror: feeds the relay's startup sweep and chat list (Cloud API has no history API).
    "CREATE TABLE IF NOT EXISTS messages (chat TEXT NOT NULL, direction TEXT NOT NULL,"
    " body TEXT NOT NULL, ts REAL NOT NULL, mid TEXT NOT NULL DEFAULT '')",
    "CREATE INDEX IF NOT EXISTS idx_cmsg ON messages(chat, ts)",
    # Profile names Meta sends with inbound messages.
    "CREATE TABLE IF NOT EXISTS contacts (chat TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',"
    " updated REAL NOT NULL)",
    # Inbound media: Meta message id -> media id for on-demand download.
    "CREATE TABLE IF NOT EXISTS media_map (mid TEXT PRIMARY KEY, media_id TEXT NOT NULL,"
    " mime TEXT NOT NULL DEFAULT '')",
    # Delivery receipts from status webhooks, latest state per provider message id.
    "CREATE TABLE IF NOT EXISTS receipts (mid TEXT NOT NULL, status TEXT NOT NULL, ts REAL NOT NULL,"
    " billable INTEGER, category TEXT, error TEXT, PRIMARY KEY (mid, status))",
    # OTP sends. The code is NEVER stored or logged; only delivery state.
    "CREATE TABLE IF NOT EXISTS otp_sends (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL,"
    " phone TEXT NOT NULL, template TEXT NOT NULL, status TEXT NOT NULL, mid TEXT NOT NULL DEFAULT '',"
    " error TEXT NOT NULL DEFAULT '')",
    # Dashboard sessions.
    "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, csrf TEXT NOT NULL,"
    " created REAL NOT NULL)",
]
with _lock:
    for ddl in SCHEMA:
        db.execute(ddl)
    db.commit()

RANKS = ["accepted", "sent", "delivered", "read"]  # forward-only; failed handled apart


def add_ingress(key, payload):
    with _lock:
        cur = db.execute("INSERT OR IGNORE INTO meta_ingress(key,payload,created) VALUES (?,?,?)",
                         (key, payload, time.time()))
        db.commit()
        return cur.rowcount == 1


def next_ingress():
    with _lock:
        return db.execute(
            "SELECT key,payload FROM meta_ingress WHERE done=0 AND next_retry<=? "
            "ORDER BY created LIMIT 1", (time.time(),)).fetchone()


def finish_ingress(key, ok):
    with _lock:
        if ok:
            db.execute("UPDATE meta_ingress SET done=1 WHERE key=?", (key,))
        else:
            db.execute("UPDATE meta_ingress SET tries=tries+1, next_retry=? WHERE key=?",
                       (time.time() + min(3600, 5 * 2 ** _tries(key)), key))
        db.commit()


def _tries(key):
    row = db.execute("SELECT tries FROM meta_ingress WHERE key=?", (key,)).fetchone()
    return row[0] if row else 0


def mirror_message(chat, direction, body, ts, mid=""):
    with _lock:
        db.execute("INSERT INTO messages VALUES (?,?,?,?,?)", (chat, direction, body, ts, mid))
        db.commit()


def remember_contact(chat, name):
    if not name:
        return
    with _lock:
        db.execute("INSERT INTO contacts VALUES (?,?,?) ON CONFLICT(chat) DO UPDATE SET name=excluded.name, updated=excluded.updated",
                   (chat, name, time.time()))
        db.commit()


def map_media(mid, media_id, mime):
    with _lock:
        db.execute("INSERT OR REPLACE INTO media_map VALUES (?,?,?)", (mid, media_id, mime))
        db.commit()


def media_for(mid):
    with _lock:
        row = db.execute("SELECT media_id FROM media_map WHERE mid=?", (mid,)).fetchone()
        return row[0] if row else None


def add_receipt(mid, status, billable, category, error):
    """Receipts move a send forward only (accepted < sent < delivered < read); a late
    `failed` never erases proof of delivery."""
    with _lock:
        db.execute("INSERT OR IGNORE INTO receipts VALUES (?,?,?,?,?,?)",
                   (mid, status, time.time(), billable, category, (error or "")[:60]))
        row = db.execute("SELECT status FROM otp_sends WHERE mid=?", (mid,)).fetchone()
        if row:
            cur = row[0]
            if status == "failed":
                forward = cur not in ("delivered", "read", "failed")
            else:
                rank = lambda s: RANKS.index(s) if s in RANKS else -1
                forward = rank(status) > rank(cur)
            if forward:
                db.execute("UPDATE otp_sends SET status=?, error=? WHERE mid=?",
                           (status, (error or "")[:60], mid))
        db.commit()


def add_otp_send(phone, template, status, mid="", error=""):
    with _lock:
        cur = db.execute("INSERT INTO otp_sends(ts,phone,template,status,mid,error) VALUES (?,?,?,?,?,?)",
                         (time.time(), phone, template, status, mid, error))
        db.commit()
        return cur.lastrowid


def otp_recent(limit=100):
    with _lock:
        return db.execute(
            "SELECT ts,phone,template,status,error FROM otp_sends ORDER BY id DESC LIMIT ?",
            (limit,)).fetchall()


def mirror_chat_ids():
    with _lock:
        return db.execute("SELECT chat, MAX(ts) FROM messages GROUP BY chat").fetchall()


def mirror_messages(chat, limit=50):
    with _lock:
        return db.execute(
            "SELECT direction,body,ts,mid FROM messages WHERE chat=? ORDER BY ts DESC LIMIT ?",
            (chat, limit)).fetchall()


def contacts_all():
    with _lock:
        return db.execute("SELECT chat,name FROM contacts").fetchall()


def new_session(token, csrf):
    with _lock:
        db.execute("DELETE FROM sessions WHERE created<?", (time.time() - 12 * 3600,))
        db.execute("INSERT INTO sessions VALUES (?,?,?)", (token, csrf, time.time()))
        db.commit()


def get_session(token):
    with _lock:
        row = db.execute("SELECT csrf,created FROM sessions WHERE token=?", (token,)).fetchone()
    if not row or time.time() - row[1] > 12 * 3600:
        return None
    return row[0]


def drop_session(token):
    with _lock:
        db.execute("DELETE FROM sessions WHERE token=?", (token,))
        db.commit()


def relay_ro():
    """Read-only handle on the bot's own database. Missing/corrupt -> None, UI shows a note."""
    try:
        conn = sqlite3.connect(f"file:{Cfg.RELAY_DB}?mode=ro", uri=True, timeout=2)
        conn.execute("SELECT 1 FROM messages LIMIT 1")
        return conn
    except Exception:
        return None
