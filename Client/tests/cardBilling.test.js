import test from 'node:test';
import assert from 'node:assert/strict';
import { billingDates, billingCycles, isCreditCard, calendarDate } from '../src/utils/cardBilling.js';
const key = d => [d.getFullYear(), d.getMonth()+1, d.getDate()];
test('card detection excludes all other selections', () => {
 for (const a of [undefined, {}, {bankName:'HDFC'}, {bankName:'IOB'}]) assert.equal(isCreditCard(a), false);
 assert.equal(isCreditCard({bankName:'HDFCCreditCard'}), true);
});
test('per-card days clamp to month end across leap years', () => {
 assert.deepEqual(key(billingDates(2024,1,{statementDay:31})[0]),[2024,2,29]);
 assert.deepEqual(key(billingDates(2025,1,{statementDay:31})[0]),[2025,2,28]);
 assert.deepEqual(key(billingDates(2026,3,{statementDay:31})[0]),[2026,4,30]);
 assert.equal(billingDates(2026,3,{statementDay:23})[0].getDate(),23);
 for (const statementDay of [null,0,32,1.5]) assert.deepEqual(billingDates(2026,1,{statementDay}),[]);
});
test('imported dates override estimates only in their month', () => {
 const data={statementDay:23,statements:[{statementDate:'2026-12-24T00:00:00'}]};
 assert.equal(billingDates(2026,11,data)[0].getDate(),24);
 assert.deepEqual(key(billingDates(2027,0,data)[0]),[2027,1,23]);
 assert.deepEqual(key(calendarDate('2026-12-24T00:00:00Z')),[2026,12,24]);
});
test('cycles cross year and respect actual periods and statement day itself', () => {
 const data={statementDay:31,statements:[{statementDate:'2025-12-30',periodStart:'2025-12-02',periodEnd:'2025-12-30'}]};
 const result=billingCycles(data,new Date(2026,0,15));
 assert.deepEqual(key(result.previous),[2025,12,30]);
 assert.deepEqual(key(result.upcoming),[2026,1,31]);
 assert.deepEqual(key(result.current.start),[2025,12,31]);
 assert.deepEqual(key(result.last.start),[2025,12,2]);
 assert.deepEqual(key(billingCycles(data,new Date(2026,0,31)).upcoming),[2026,2,28]);
 assert.deepEqual(key(billingCycles(data,new Date(2026,1,1)).upcoming),[2026,2,28]);
 assert.equal(billingCycles(null),null);
});

test('statement day starts the next cycle, matching the existing card summary', () => {
 const result=billingCycles({statementDay:23},new Date(2026,9,23));
 assert.deepEqual(key(result.previous),[2026,10,23]);
 assert.deepEqual(key(result.upcoming),[2026,11,23]);
 assert.deepEqual(key(result.current.start),[2026,10,24]);
});
test('duplicate imports do not create empty billing cycles', () => {
 const data={statementDay:23,statements:[{statementDate:'2026-10-23'},{statementDate:'2026-10-23'}]};
 assert.equal(billingDates(2026,9,data).length,1);
 const result=billingCycles(data,new Date(2026,9,25));
 assert.deepEqual(key(result.last.start),[2026,9,24]);
 assert.equal(calendarDate('2026-02-31'),null);
 assert.equal(calendarDate('not-a-date'),null);
});
