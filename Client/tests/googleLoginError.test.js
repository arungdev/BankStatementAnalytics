import test from 'node:test';
import assert from 'node:assert/strict';
import { googleLoginError } from '../src/utils/googleLoginError.js';

test('Google login shows actionable messages for allowlisted failure categories', () => {
  assert.match(googleLoginError('credentials'), /Client ID and Client Secret/);
  assert.match(googleLoginError('correlation'), /original browser session/);
  assert.match(googleLoginError('failed'), /server logs/);
});
test('Google login never reflects arbitrary query text or prototype properties', () => {
  for (const input of [null, '', '<script>secret</script>', 'constructor', '__proto__', 'token=synthetic-private-token']) {
    assert.equal(googleLoginError(input), '');
  }
});
