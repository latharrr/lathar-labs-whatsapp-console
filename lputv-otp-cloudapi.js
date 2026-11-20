// LpuTV otp.js patch: implement the 'cloudapi' sender against the Labs console.
//
// Replace the sendCloudApi stub with the function below, and change the send
// dispatch so the code reaches the sender:
//
//   function enqueueSend(phone, text, code) { ... sender()(phone, text, code) ... }
//   const result = await enqueueSend(normalized, text, code);   // in requestOtp
//
// Config additions (config.js, from env):
//   cloudapiUrl: env.OTP_CLOUDAPI_URL || 'http://127.0.0.1:8788/admin/otp-send'
//   cloudapiSecret: env.OTP_CLOUDAPI_SECRET (same value as the console's OTP_HMAC_SECRET)
//
// Then OTP_SENDER=cloudapi switches over. The console sends Meta's Authentication
// template (fixed preset text + copy-code button); the custom OTP_TEXTS variants
// are not used on the official route. Caps, queue, kill switch all stay in force.

async function sendCloudApi(phone, _text, code) {
    const body = JSON.stringify({ phone, code, minutes: Math.round(config.otp.ttlMs / 60000) });
    const sig = 'sha256=' + crypto.createHmac('sha256', config.otp.cloudapiSecret).update(body).digest('hex');
    let res;
    try {
        res = await fetch(config.otp.cloudapiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Relay-Signature': sig },
            body,
            signal: AbortSignal.timeout(15_000),
        });
    } catch (err) {
        return { ok: false, kind: 'send_failed', error: String(err) };
    }
    if (res.status === 200) return { ok: true };
    const errBody = await res.text().catch(() => '');
    if (res.status === 400 && errBody.includes('unknown recipient')) return { ok: false, kind: 'not_on_whatsapp' };
    if (res.status === 401) return { ok: false, kind: 'auth' };
    return { ok: false, kind: 'send_failed', error: `${res.status} ${errBody.slice(0, 120)}` };
}
