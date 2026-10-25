import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditWorkspace } from '../src/utils/workspacePermissions.js';

test('regular users can manage their own financial workspace without administrator privileges', () => {
  assert.equal(canEditWorkspace('User'), true);
  assert.equal(canEditWorkspace('Admin'), true);
});
test('viewer and unknown roles cannot edit workspace data', () => {
  for (const role of ['Viewer', '', undefined, 'admin', 'Administrator']) assert.equal(canEditWorkspace(role), false);
});
