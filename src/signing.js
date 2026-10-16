const crypto = require('crypto');

// Signature format (same idea as Stripe): "t=<unix seconds>,v1=<hex hmac>"
// The signed string is `${timestamp}.${body}` so a captured request can't be replayed
// outside the tolerance window.
function sign(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

function verify(secret, body, header, toleranceSeconds = 300) {
  if (typeof header !== 'string') return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=').map((s) => s.trim()))
  );
  const timestamp = parseInt(parts.t, 10);
  if (!timestamp || !parts.v1) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const expected = sign(secret, body, timestamp).split('v1=')[1];
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function generateSecret() {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

module.exports = { sign, verify, generateSecret };
