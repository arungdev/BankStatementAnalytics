import test from 'node:test';
import assert from 'node:assert/strict';
import { startGuardedRequest } from '../src/utils/guardedRequest.js';
import { buildTransactionParams } from '../src/utils/transactionQuery.js';
import { resolvePreset } from '../src/utils/dateRanges.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('an older request cannot replace a newer account/filter result', async () => {
  let resolveOld;
  const seen = [];
  const stopOld = startGuardedRequest(() => new Promise(resolve => { resolveOld = resolve; }), value => seen.push(value), assert.fail);
  await tick();
  stopOld();
  const stopNew = startGuardedRequest(() => Promise.resolve('new account'), value => seen.push(value), assert.fail);
  await tick();
  resolveOld('old account');
  await tick();
  assert.deepEqual(seen, ['new account']);
  stopNew();
});

test('cleanup aborts transport and suppresses cancellation errors', async () => {
  let signal, rejectRequest;
  const stop = startGuardedRequest(s => { signal = s; return new Promise((_, reject) => { rejectRequest = reject; }); }, assert.fail, assert.fail);
  await tick();
  stop();
  assert.equal(signal.aborted, true);
  rejectRequest(new Error('cancelled'));
  await tick();
});

test('active failures reach the retry UI instead of looking like empty data', async () => {
  const errors = [];
  const stop = startGuardedRequest(() => Promise.reject(new Error('offline')), assert.fail, error => errors.push(error.message));
  await tick();
  assert.deepEqual(errors, ['offline']);
  stop();
});

test('CSV export and transaction listing use the same complete filter contract', () => {
  const filters = { accountIds: '1,2', category: 'Food', minAmount: 0, maxAmount: 200,
    search: 'a&b', sortBy: 'amount', sortDir: 'asc', uncategorizedOnly: true };
  const list = buildTransactionParams({ ...filters, page: 2, pageSize: 10 });
  const exported = buildTransactionParams({ ...filters, pageSize: 0 });
  for (const key of ['accountIds', 'category', 'minAmount', 'maxAmount', 'search', 'sortBy', 'sortDir', 'uncategorizedOnly'])
    assert.equal(list.get(key), exported.get(key), key);
  assert.equal(exported.get('pageSize'), '0');
});

test('upload drilldown takes precedence over a dashboard date range', () => {
  const params = buildTransactionParams({ uploadId: 'upload', startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.equal(params.get('uploadId'), 'upload');
  assert.equal(params.has('startDate'), false);
  assert.equal(params.has('endDate'), false);
});

test('relative date presets cover complete local days', () => {
  const today = resolvePreset('TODAY');
  const seven = resolvePreset('LAST_7');
  assert.equal(today.start.getHours(), 0);
  assert.equal(today.end.getHours(), 23);
  assert.equal(today.end.getMilliseconds(), 999);
  const expected = new Date(today.start); expected.setDate(expected.getDate() - 6);
  assert.equal(seven.start.getTime(), expected.getTime());
  assert.deepEqual(resolvePreset('ALL'), { start: null, end: null });
});
