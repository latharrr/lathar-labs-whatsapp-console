"""Labs console config: everything from env, secrets never logged."""
import os
import re


def _req(name):
    v = os.environ.get(name, "").strip()
    if not v:
        raise SystemExit(f"{name} required - refusing to run")
    return v


class Cfg:
    # Public Meta webhook + Graph API
    META_APP_SECRET = _req("META_APP_SECRET")        # signs X-Hub-Signature-256
    META_VERIFY_TOKEN = _req("META_VERIFY_TOKEN")    # we generate this, Meta echoes it
    META_TOKEN = _req("META_TOKEN")                  # Graph API access token
    PHONE_NUMBER_ID = _req("META_PHONE_NUMBER_ID")
    GRAPH_BASE = os.environ.get("GRAPH_BASE", "https://graph.facebook.com").rstrip("/")
    GRAPH_VERSION = os.environ.get("GRAPH_VERSION", "v24.0")

    # The existing bot brain, unchanged
    RELAY_BASE = os.environ.get("RELAY_BASE", "http://127.0.0.1:8787").rstrip("/")
    RELAY_SECRET = _req("WEBHOOK_SECRET")            # same HMAC secret relay uses
    SHIM_API_KEY = _req("OPENWA_API_KEY")            # relay authenticates to us with this
    RELAY_SESSION = os.environ.get("OPENWA_SESSION", "default")

    # Strict outbound allowlist: digits-only recipient numbers, comma-separated.
    # Every send path (bot brain via shim, dashboard reply, OTP) is refused for
    # anyone not listed. Defaults to the owner's number only, for setup/testing.
    # An explicitly empty value disables the list (allow all) - not for testing.
    OUTBOUND_ALLOWLIST = {
        re.sub(r"\D", "", n)
        for n in os.environ.get("OUTBOUND_ALLOWLIST", "").split(",")
        if n.strip()
    }

    # OTP endpoint shared with LpuTV backend
    OTP_HMAC_SECRET = _req("OTP_HMAC_SECRET")
    OTP_TEMPLATE = os.environ.get("OTP_TEMPLATE", "otp")
    OTP_TEMPLATE_LANG = os.environ.get("OTP_TEMPLATE_LANG", "en")

    # Dashboard login (single user)
    CONSOLE_PASSWORD = _req("CONSOLE_PASSWORD")

    PORT = int(os.environ.get("PORT", "8788"))
    CONSOLE_DB = os.environ.get("CONSOLE_DB", "/data/console.db")
    RELAY_DB = os.environ.get("RELAY_DB", "/relay-data/relay.db")  # opened read-only
    STATIC_DIR = os.environ.get("STATIC_DIR", "/app/static")
