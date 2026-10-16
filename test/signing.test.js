const test = require('node:test');
const assert = require('node:assert');
const { sign, verify, generateSecret } = require('../src/signing');

const secret = 'whsec_test';
const body = JSON.stringify({ hello: 'world' });

test('sign produces t= and v1= parts', () => {
  const header = sign(secret, body, 1700000000);
  assert.match(header, /^t=1700000000,v1=[0-9a-f]{64}$/);
});

test('verify accepts a valid, fresh signature', () => {
  assert.strictEqual(verify(secret, body, sign(secret, body)), true);
});

test('verify rejects a tampered body', () => {
  const header = sign(secret, body);
  assert.strictEqual(verify(secret, body + ' ', header), false);
});

test('verify rejects the wrong secret', () => {
  const header = sign('whsec_other', body);
  assert.strictEqual(verify(secret, body, header), false);
});

test('verify rejects an old timestamp (replay protection)', () => {
  const old = Math.floor(Date.now() / 1000) - 3600;
  assert.strictEqual(verify(secret, body, sign(secret, body, old)), false);
});

test('verify rejects malformed headers', () => {
  assert.strictEqual(verify(secret, body, undefined), false);
  assert.strictEqual(verify(secret, body, 'garbage'), false);
});

test('generateSecret returns unique prefixed secrets', () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.match(a, /^whsec_[0-9a-f]{48}$/);
  assert.notStrictEqual(a, b);
});
