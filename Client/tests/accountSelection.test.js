import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccountSelection } from '../src/utils/accountSelection.js';

test('an empty or not-yet-loaded workspace never reuses another database account', () => {
  for (const saved of [1, '1', 'all', null]) assert.equal(resolveAccountSelection(saved, []), null);
});
test('selection is restricted to current real accounts after switching workspaces', () => {
  const accounts = [{ id: 5 }, { id: 7 }, { id: 'temporary' }];
  assert.equal(resolveAccountSelection(1, accounts), 5);
  assert.equal(resolveAccountSelection('7', accounts), 7);
  assert.equal(resolveAccountSelection('all', accounts), 'all');
  assert.equal(resolveAccountSelection(null, [{ id: 'temporary' }]), null);
});
