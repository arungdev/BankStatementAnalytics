import test from 'node:test';
import assert from 'node:assert/strict';
import { browserStorage, createSafeStorage, readStoredStringSet, writeStoredStringSet } from '../src/utils/browserStorage.js';

test('blocked storage getters and methods never interrupt application actions', () => {
  for (const resolve of [
    () => { throw new Error('SecurityError'); },
    () => ({
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem() { throw new Error('blocked'); },
    }),
    () => undefined,
  ]) {
    const storage = createSafeStorage(resolve);
    assert.equal(storage.getItem('key'), null);
    assert.doesNotThrow(() => storage.setItem('key', 'value'));
    assert.doesNotThrow(() => storage.removeItem('key'));
  }
  assert.equal(browserStorage.getItem('missing'), null);
});

test('storage retains existing keys and string values without changing their format', () => {
  const values = new Map();
  const storage = createSafeStorage(() => ({
    getItem: key => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }));
  storage.setItem('bsp_gpay_split_filter', 'all');
  assert.equal(storage.getItem('bsp_gpay_split_filter'), 'all');
  storage.removeItem('bsp_gpay_split_filter');
  assert.equal(storage.getItem('bsp_gpay_split_filter'), null);
});

test('notification and transfer sets reject malformed saved shapes and retain valid identities', () => {
  for (const raw of ['bad json', 'null', '{}', '"abc"', '12']) {
    assert.deepEqual([...readStoredStringSet('key', { getItem: () => raw })], []);
  }
  const storage = { getItem: () => '["import.1","pair.2",null,42,"import.1"]' };
  assert.deepEqual([...readStoredStringSet('key', storage)], ['import.1', 'pair.2']);
  let saved;
  writeStoredStringSet('key', new Set(['older', 'recent', 'latest']), 2, { setItem: (_, value) => { saved = value; } });
  assert.equal(saved, '["recent","latest"]');
});
