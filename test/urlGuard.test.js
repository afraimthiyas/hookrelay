const test = require('node:test');
const assert = require('node:assert');
const { validateTargetUrl } = require('../src/urlGuard');

const opts = { allowPrivate: false };

test('allows normal public https URLs', () => {
  assert.strictEqual(validateTargetUrl('https://example.com/hook', opts).ok, true);
});

test('rejects non-http protocols', () => {
  assert.strictEqual(validateTargetUrl('ftp://example.com', opts).ok, false);
  assert.strictEqual(validateTargetUrl('file:///etc/passwd', opts).ok, false);
});

test('rejects invalid URLs', () => {
  assert.strictEqual(validateTargetUrl('not a url', opts).ok, false);
});

test('rejects localhost and private IPv4 ranges', () => {
  for (const u of [
    'http://localhost:8080',
    'http://127.0.0.1',
    'http://10.0.0.5',
    'http://172.16.4.1',
    'http://192.168.1.1',
    'http://169.254.169.254/latest/meta-data', // cloud metadata endpoint
  ]) {
    assert.strictEqual(validateTargetUrl(u, opts).ok, false, u);
  }
});

test('rejects IPv6 loopback', () => {
  assert.strictEqual(validateTargetUrl('http://[::1]:3000', opts).ok, false);
});

test('allowPrivate override permits local targets (dev only)', () => {
  assert.strictEqual(validateTargetUrl('http://localhost:8080', { allowPrivate: true }).ok, true);
});
