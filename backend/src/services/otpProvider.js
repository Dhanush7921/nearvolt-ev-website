// MSG91 OTP v5. The OTP is generated, delivered and checked by MSG91; our server never stores it.
export function createMsg91({ authKey, templateId, baseUrl, fetchImpl = fetch }) {
  const call = async (method, path, params) => {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetchImpl(url, { method, headers: { authkey: authKey, accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    const body = await r.json().catch(() => ({}));
    return { httpOk: r.ok, ok: r.ok && body.type === 'success', message: body.message };
  };
  const mobile = (e164) => e164.replace(/^\+/, ''); // MSG91 expects 91XXXXXXXXXX
  return {
    send: (phone) => call('POST', '/api/v5/otp', { template_id: templateId, mobile: mobile(phone), otp_expiry: '5', otp_length: '6' }),
    verify: (phone, otp) => call('GET', '/api/v5/otp/verify', { mobile: mobile(phone), otp }),
  };
}
