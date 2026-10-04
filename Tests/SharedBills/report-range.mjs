import assert from 'node:assert/strict';
import { sharedBillReportRange } from '../../Client/src/utils/sharedBills.js';
assert.deepEqual(sharedBillReportRange('month', '2026-09'), { startDate: '2026-09-01', endDate: '2026-09-30' });
assert.deepEqual(sharedBillReportRange('month', '2028-02'), { startDate: '2028-02-01', endDate: '2028-02-29' });
assert.deepEqual(sharedBillReportRange('month', '2026-02'), { startDate: '2026-02-01', endDate: '2026-02-28' });
for (const type of ['year', 'annual']) assert.deepEqual(sharedBillReportRange(type, '2026'), { startDate: '2026-01-01', endDate: '2026-12-31' });
for (const [type, period] of [['year','2026-09'], ['month','2026'], ['month','2026-13'], ['month',''], ['unknown','2026-09']]) assert.equal(sharedBillReportRange(type, period), null);
console.log('10 report-range checks passed.');
