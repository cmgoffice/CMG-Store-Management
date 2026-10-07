import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

async function loadUtility(name) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../src/utils/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const { getDispatchReceiptBalance, isStockItemReadyForUse } = await loadUtility('stockItem');
const { createStockImportFingerprint } = await loadUtility('stockIdentity');

test('in-transit stock remains counted physically but cannot be available for use', () => {
  assert.equal(isStockItemReadyForUse({ status: 'In Transit' }), false);
  for (const status of ['Pending Dispatch', 'Pending Repair', 'Repair', 'Withdrawn']) {
    assert.equal(isStockItemReadyForUse({ status }), false);
  }
  for (const status of ['Available', 'Received at Site', 'Borrowed']) {
    assert.equal(isStockItemReadyForUse({ status }), true);
  }
});

test('partial and subsequent receipts conserve stock and track only the remaining quantity', () => {
  let received = 0;
  let transit = 100;
  for (const amount of [40, 0, 25, 35]) {
    const balance = getDispatchReceiptBalance(100, received, amount);
    received += balance.delta;
    transit -= balance.delta;
    assert.equal(received, balance.received);
    assert.equal(transit, balance.remaining);
    assert.equal(200 + received + transit, 300);
  }
  assert.deepEqual(getDispatchReceiptBalance(100, received), { delta: 0, received: 100, remaining: 0 });
});

test('default receipt receives only the outstanding quantity', () => {
  assert.deepEqual(getDispatchReceiptBalance(100, 40), { delta: 60, received: 100, remaining: 0 });
});

test('rejects over-receiving, fractional, negative and nonfinite quantities', () => {
  for (const qty of [61, -1, 0.5, NaN, Infinity]) {
    assert.throws(() => getDispatchReceiptBalance(100, 40, qty));
  }
  assert.throws(() => getDispatchReceiptBalance(100, 101, 0));
});

test('CSV replay and row reordering have the same fingerprint, new receipts differ', () => {
  const rows = [{ itemNo: 'FORMWORK-084', qty: 300, prNo: 'BL-J74' }, { itemNo: 'FORMWORK-085', qty: 300 }];
  const original = createStockImportFingerprint('J2B', rows);
  assert.deepEqual(createStockImportFingerprint(' j2b ', [...rows].reverse()), original);
  assert.deepEqual(createStockImportFingerprint('J2B', rows.map(row => ({ ...row, itemNo: row.itemNo.toLowerCase() }))), original);
  assert.notEqual(createStockImportFingerprint('J74', rows).id, original.id);
  assert.notEqual(createStockImportFingerprint('J2B', [{ ...rows[0], qty: 100 }, rows[1]]).id, original.id);
  assert.notEqual(createStockImportFingerprint('J2B', [{ ...rows[0], prNo: 'NEW-RECEIPT' }, rows[1]]).id, original.id);
});
