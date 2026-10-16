const net = require('net');

// Basic SSRF guard: webhook targets must be http(s) and must not point at
// loopback / private / link-local addresses. This checks the literal hostname only;
// a production hardening step is to resolve DNS and re-check the resolved IP at
// delivery time (protects against DNS rebinding). See README "Next steps".
function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function validateTargetUrl(raw, { allowPrivate = process.env.ALLOW_PRIVATE_URLS === 'true' } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, reason: 'URL must use http or https' };
  }
  if (allowPrivate) return { ok: true };

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, reason: 'Target host is not allowed' };
  }
  if (net.isIPv4(host) && isPrivateIPv4(host)) {
    return { ok: false, reason: 'Target IP is private' };
  }
  if (net.isIPv6(host) && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))) {
    return { ok: false, reason: 'Target IP is private' };
  }
  return { ok: true };
}

module.exports = { validateTargetUrl };
