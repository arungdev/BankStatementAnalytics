import test from 'node:test';
import assert from 'node:assert/strict';
import { oneOf, preferenceValidators, readViewPreference, viewPreferenceKey, writeViewPreference } from '../src/utils/viewPreferences.js';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('view filters and page sizes stay isolated by user, account, screen and table', () => {
  const store = storage();
  const key = viewPreferenceKey('alice', 10, 'transactions', 'pageSize');
  writeViewPreference(store, key, 100);
  assert.equal(readViewPreference(store, key, 20, preferenceValidators.pageSize), 100);
  for (const other of [viewPreferenceKey('bob', 10, 'transactions', 'pageSize'), viewPreferenceKey('alice', 11, 'transactions', 'pageSize'), viewPreferenceKey('alice', 10, 'merchants', 'pageSize'), viewPreferenceKey('alice', 10, 'transactions', 'sort')])
    assert.equal(readViewPreference(store, other, 20), 20);
  assert.notEqual(viewPreferenceKey('a:b', 'c', 'table', 'size'), viewPreferenceKey('a', 'b:c', 'table', 'size'));
});

test('restored settings reject malformed JSON, obsolete sorts, wrong types and unbounded page sizes', () => {
  const store = storage();
  for (const raw of ['{broken', 'null', '"100"', '-1', '0', '1000000']) {
    store.setItem('pageSize', raw);
    assert.equal(readViewPreference(store, 'pageSize', 20, preferenceValidators.pageSize), 20);
  }
  writeViewPreference(store, 'sort', 'obsolete');
  assert.equal(readViewPreference(store, 'sort', 'date', oneOf('date', 'amount')), 'date');
  writeViewPreference(store, 'sort', { field: 'date' });
  assert.deepEqual(readViewPreference(store, 'sort', { field: 'date', direction: 'desc' }), { field: 'date', direction: 'desc' });
  writeViewPreference(store, 'filter', 'false');
  assert.equal(readViewPreference(store, 'filter', false), false);
});

test('a saved preference wins over migration defaults and supports functional clear values', () => {
  const store = storage();
  writeViewPreference(store, 'oldPageSize', 100);
  assert.equal(readViewPreference(store, 'newPageSize', 20, preferenceValidators.pageSize, 'oldPageSize'), 100);
  writeViewPreference(store, 'newPageSize', 5);
  assert.equal(readViewPreference(store, 'newPageSize', 20, preferenceValidators.pageSize, 'oldPageSize'), 5);
  writeViewPreference(store, 'search', '');
  assert.equal(readViewPreference(store, 'search', 'default'), '');
  writeViewPreference(store, 'amount', null);
  assert.equal(readViewPreference(store, 'amount', 20, preferenceValidators.amount), null);
});

test('blocked or full browser storage does not prevent browsing', () => {
  const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Full'); } };
  assert.equal(readViewPreference(blocked, 'filters', 'all'), 'all');
  assert.equal(readViewPreference(null, 'filters', 'all'), 'all');
  assert.doesNotThrow(() => writeViewPreference(blocked, 'filters', 'uncategorized'));
});

test('amount and width validation prevents corrupt saved values from breaking views', () => {
  assert.equal(preferenceValidators.amount(-10), false);
  assert.equal(preferenceValidators.amount(Infinity), false);
  assert.equal(preferenceValidators.amount(0), true);
  assert.equal(preferenceValidators.width(0), false);
  assert.equal(preferenceValidators.width(480), true);
  assert.equal(preferenceValidators.width(10000), false);
});
