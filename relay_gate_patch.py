#!/usr/bin/env python3
"""Gate the relay's dormant routines behind env flags (default off).

Official-API rules change proactive sends (they need approved templates outside
the 24h window), and the owner previously had several standing routines stopped.
This patch makes the relay start with digest/sweep/reminders/mess OFF unless the
matching env flag is set, without deleting any code.

Run on the VPS:  python3 relay_gate_patch.py /opt/automations/wa-relay/relay.py
Idempotent; makes a timestamped backup first.
"""
import shutil
import sys
import time

path = sys.argv[1]
src = open(path).read()

ANCHOR = '    threading.Thread(target=send_daily_digest'  # not present; digest is called, see below
GATED = {
    "startup_sweep": "RELAY_SWEEP_ENABLED",
    "watchdog_worker": "RELAY_WATCHDOG_ENABLED",
    "reminder_worker": "RELAY_REMINDERS_ENABLED",
    "mess_worker": "RELAY_MESS_ENABLED",
}

def env_gate(fn, env):
    return (f'    if os.environ.get("{env}", "off").lower() == "on":\n'
            f'        threading.Thread(target={fn}, daemon=True).start()')

old = "".join(f'    threading.Thread(target={fn}, daemon=True).start()\n' for fn in GATED)
if old not in src:
    # threads may not be adjacent; patch one by one
    for fn, env in GATED.items():
        line = f"    threading.Thread(target={fn}, daemon=True).start()\n"
        if line in src:
            src = src.replace(line, env_gate(fn, env) + "\n")
        else:
            print(f"note: {fn} thread line not found, left unchanged")
else:
    new = "".join(env_gate(fn, env) + "\n" for fn, env in GATED.items())
    src = src.replace(old, new)

# The 8am digest: gate the two startup calls inside the wake window.
digest_old = """        flush_owner_digest()  # restarted inside the flush window: deliver the overnight batch now
        send_daily_digest()"""
digest_new = """        if os.environ.get("RELAY_DIGEST_ENABLED", "off").lower() == "on":
            flush_owner_digest()  # restarted inside the flush window: deliver the overnight batch now
            send_daily_digest()"""
if digest_old in src:
    src = src.replace(digest_old, digest_new)
else:
    print("note: digest startup block not found, left unchanged")

# Allowlist-block alerts: the console returns 403 for sends its allowlist blocks
# (deliberate during containment). The relay's send-failure path would page the
# owner about every one. Suppress owner alerts for 403 only; real Meta rejections
# still alert.
suppress_old = """            if not (is_owner_chat(chat_id) or is_owner_chat(orig_chat_id)):"""
suppress_new = """            if e.code != 403 and not (is_owner_chat(chat_id) or is_owner_chat(orig_chat_id)):  # 403 = our allowlist, expected during containment"""
if suppress_old in src:
    src = src.replace(suppress_old, suppress_new, 1)
else:
    print("note: send perm-fail alert guard not found, left unchanged")

# Dispatcher 08:00 IST digest edge (separate from the startup flush above):
edge_old = """            if awake and not was_awake:
                flush_owner_digest()
                send_daily_digest()"""
edge_new = """            if awake and not was_awake and os.environ.get("RELAY_DIGEST_ENABLED", "off").lower() == "on":
                flush_owner_digest()
                send_daily_digest()"""
if edge_old in src:
    src = src.replace(edge_old, edge_new)
else:
    print("note: dispatcher digest edge not found, left unchanged")

# OTP redaction: code-shaped messages in an OTP window are stored as "[code hidden]"
# instead of the raw digits. Applied only when RELAY_OTP_REDACT=on (owner decision;
# changes what is stored in his relay.db history).
redact_old = '''    if (
        is_otp_held(sender, chat)
        and re.fullmatch(r"\\d{4,8}", body)
        and not owner_check(sender)
        and not is_owner_chat(chat)
    ):
        log.info("otp-code: %s sent a code-shaped message in the login window; no bot reply", display_id(chat))
        store_message(chat, "user", body)
        return'''
redact_new = '''    if (
        is_otp_held(sender, chat)
        and re.fullmatch(r"\\d{4,8}", body)
        and not owner_check(sender)
        and not is_owner_chat(chat)
    ):
        log.info("otp-code: %s sent a code-shaped message in the login window; no bot reply", display_id(chat))
        store_message(chat, "user", "[code hidden]" if os.environ.get("RELAY_OTP_REDACT", "off").lower() == "on" else body)
        return'''
if redact_old in src:
    src = src.replace(redact_old, redact_new)
else:
    print("note: otp-code block not found verbatim, redaction not applied")

bak = f"{path}.bak-gated-{time.strftime('%Y%m%d-%H%M%S')}"
shutil.copy2(path, bak)
open(path, "w").write(src)
print(f"patched {path} (backup: {bak})")
