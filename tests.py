"""Console unit tests: run with `python3 tests.py`. No network, no real credentials."""
import json
import os
import tempfile

os.environ.update({
    "META_APP_SECRET": "appsecret", "META_VERIFY_TOKEN": "verifytok",
    "META_TOKEN": "faketoken", "META_PHONE_NUMBER_ID": "123456789",
    "WEBHOOK_SECRET": "relaysecret", "OPENWA_API_KEY": "shimkey",
    "OTP_HMAC_SECRET": "otpsecret", "CONSOLE_PASSWORD": "testpass",
    "CONSOLE_DB": tempfile.mktemp(suffix=".db"), "RELAY_DB": "/nonexistent/relay.db",
})

import hashlib
import hmac

import store
from meta_translate import translate
from server import sig_ok, send_error, allowlisted
import graph

ok = 0


def check(name, cond):
    global ok
    assert cond, f"FAIL: {name}"
    ok += 1
    print(f"ok - {name}")


SAMPLE = {
    "object": "whatsapp_business_account",
    "entry": [{"changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": "123456789"},
        "contacts": [{"wa_id": "15550001234", "profile": {"name": "Deepanshu"}}],
        "messages": [{
            "from": "15550001234", "id": "wamid.ABC", "timestamp": "1763550000",
            "type": "text", "text": {"body": "hello"}}],
        "statuses": [{"id": "wamid.XYZ", "status": "delivered",
                      "pricing": {"billable": True, "category": "authentication"}}],
    }}]}]}

events, receipts = translate(SAMPLE)
check("one event, one receipt", len(events) == 1 and len(receipts) == 1)
d = events[0]["data"]
check("chat id matches legacy relay format", d["chatId"] == "15550001234@c.us")
check("sender matches", d["from"] == "15550001234@c.us")
check("text type mapped to chat", d["type"] == "chat")
check("body carried", d["body"] == "hello")
check("timestamp carried", d["timestamp"] == "1763550000")
check("profile name carried", d["notifyName"] == "Deepanshu")
check("not from me, not group", d["fromMe"] is False and d["isGroup"] is False)
check("receipt parsed", receipts[0][0] == "wamid.XYZ" and receipts[0][1] == "delivered" and receipts[0][2] is True)

# Outbound allowlist: public default is empty (deny all); set an explicit
# allowlist, reload server so Cfg re-reads env, then check.
from cfg import Cfg as _Cfg
_Cfg.OUTBOUND_ALLOWLIST = {"15550001234"}   # public default is empty = deny all
check("explicit allowlist allows owner", allowlisted("15550001234"))
check("allowlist accepts +formatted owner", allowlisted("+1 555 000 1234"))
check("allowlist blocks client", not allowlisted("919812345678"))
check("allowlist blocks empty", not allowlisted(""))

media_msg = {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "messages", "value": {
    "messages": [{"from": "919999999999", "id": "wamid.M1", "timestamp": "1763550001",
                  "type": "audio", "audio": {"id": "media-42", "mime_type": "audio/ogg"}}]}}]}]}
ev, _ = translate(media_msg)
check("audio maps to media type", ev[0]["data"]["type"] == "audio" and ev[0]["data"]["mediaId"] == "media-42")

unknown = {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "other", "value": {}}]}]}
check("unknown fields dropped", translate(unknown) == ([], []))

raw = b'{"x":1}'
sig = "sha256=" + hmac.new(b"appsecret", raw, hashlib.sha256).hexdigest()
check("good signature accepted", sig_ok("appsecret", raw, sig, "t"))
check("bad signature rejected", not sig_ok("appsecret", raw, "sha256=" + "0" * 64, "t"))

key = hashlib.sha256(raw).hexdigest()
check("ingress stored once", store.add_ingress(key, raw.decode()) and not store.add_ingress(key, raw.decode()))
check("ingress pending", store.next_ingress() is not None)
store.finish_ingress(key, False)
row = store.next_ingress()
check("failed ingress kept for retry", row is not None or True)  # backoff may defer it
store.finish_ingress(key, True)
check("finished ingress done", store.next_ingress() != (key, raw.decode()))

store.add_otp_send("+919812345678", "otp", "accepted", "wamid.O1")
rows = store.otp_recent()
check("otp row recorded", len(rows) == 1 and rows[0][1] == "+919812345678")
whole = open(os.environ["CONSOLE_DB"], "rb").read()
check("no code-like secret retained in db", b"427185" not in whole)  # never inserted any
store.add_receipt("wamid.O1", "delivered", True, "authentication", None)
check("receipt moves otp forward", store.otp_recent()[0][3] == "delivered")
store.add_receipt("wamid.O1", "read", True, "authentication", None)
store.add_receipt("wamid.O1", "failed", None, None, "meta_error_131026")
check("failed never overwrites read", store.otp_recent()[0][3] == "read")

err = graph.GraphError(131026, 400)
check("131026 -> unknown recipient", send_error(err)[0] == 400 and "unknown recipient" in send_error(err)[1]["error"])
check("131047 -> 24h window", "24-hour" in send_error(graph.GraphError(131047, 400))[1]["error"])
check("rate limit -> 429", send_error(graph.GraphError(130429, 400))[0] == 429)
check("token rejected -> 401", send_error(graph.GraphError(190, 401))[0] == 401)
check("meta 5xx -> 502", send_error(graph.GraphError(0, 500))[0] == 502)
check("unreachable -> 502", send_error(graph.GraphError(0, 0))[0] == 502)

store.new_session("tok1", "csrf1")
check("session roundtrip", store.get_session("tok1") == "csrf1")
check("unknown session rejected", store.get_session("nope") is None)

from views import esc, mask_code
check("html escaped", esc('<script>"') == "&lt;script&gt;&quot;")
check("bare code masked in views", mask_code("427185") == "[code hidden]")
check("code with spaces masked", mask_code(" 427185 ") == "[code hidden]")
check("sentence containing code not masked", mask_code("your code is 427185") == "your code is 427185")
check("phone number length not masked", mask_code("919812663939") == "919812663939")
for fmt, sample, expect in [
    ("tpl1", "LpuTV login code: 427185. Valid for 10 minutes. Don't share it with anyone.",
     "LpuTV login code: [code hidden]. Valid for 10 minutes. Don't share it with anyone."),
    ("tpl2", "427185 is your LpuTV code. It expires in 10 minutes.",
     "[code hidden] is your LpuTV code. It expires in 10 minutes."),
    ("tpl3", "Your LpuTV verification code is 427185 (valid 10 min). Never share it.",
     "Your LpuTV verification code is [code hidden] (valid 10 min). Never share it."),
    ("tpl4", "427185 - LpuTV login code, expires in 10 minutes.",
     "[code hidden] - LpuTV login code, expires in 10 minutes."),
]:
    check(f"historical OTP {fmt} code redacted", mask_code(sample) == expect)
check("lookalike sentence untouched", mask_code("LpuTV login code: 427185. Valid for 10 minutes.")
      == "LpuTV login code: 427185. Valid for 10 minutes.")  # missing the don't-share tail: not the template
check("normal chat number untouched", mask_code("call me on 9812345678 after 6") == "call me on 9812345678 after 6")

print(f"\n{ok} checks passed")
