import test from 'node:test';
import assert from 'node:assert/strict';
import { dehydrate, hydrate } from '../src/utils/dateRangePreferences.js';
import { resolvePreset } from '../src/utils/dateRanges.js';

test('remembered relative ranges resolve against today instead of an old saved date', () => {
  const range = hydrate({ preset: 'LAST_MONTH', start: '2000-01-01', end: '2000-02-01' });
  const expected = resolvePreset('LAST_MONTH');
  assert.equal(range.start.getTime(), expected.start.getTime());
  assert.equal(range.end.getTime(), expected.end.getTime());
  assert.equal(dehydrate(range).start, null);
});

test('custom ranges survive a JSON round trip as Date values', () => {
  const range = { preset: 'CUSTOM', label: 'My dates', start: new Date(2026, 9, 1), end: new Date(2026, 9, 31) };
  const restored = hydrate(JSON.parse(JSON.stringify(dehydrate(range))));
  assert.equal(restored.start.getTime(), range.start.getTime());
  assert.equal(restored.end.getTime(), range.end.getTime());
  assert.equal(restored.label, 'My dates');
});

test('bad or reversed custom dates and removed presets return to All Time', () => {
  for (const value of [{ preset: 'CUSTOM', start: 'bad-date', end: '2026-01-01' }, { preset: 'CUSTOM', start: '2026-12-01', end: '2026-01-01' }, { preset: 'removed' }, null])
    assert.equal(hydrate(value).preset, 'ALL');
});
