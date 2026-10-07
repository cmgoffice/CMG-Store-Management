import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeApp } from 'firebase/app';
import { doc, getDocFromServer, getFirestore, runTransaction, terminate } from 'firebase/firestore';

// User-confirmed correction: the August CSV board rows are not additional receipts.
// Default: write a reviewable plan only. Apply is atomic, guarded and idempotent.
const audit = JSON.parse(fs.readFileSync('.local-stock-repair/audit-20261007-server.json', 'utf8'));
const repairId = 'FORMWORK-084-085-20261007-reconcile-v2';
const at = new Date().toISOString();
const root = 'CMG-Store-Management';
const board84 = 'stock_20ptwlivpm5p_j2b_formwork-084';
const board85 = 'stock_1qq87m1phg36c_j2b_formwork-085';
const transitId = `${board84}-DSP-20261007-100748-01`;
const csvId = 'J2B-IMP-20260817081817932-RA24I';
const dispatchId = 'DSP-20261007-100748';
const get = (name, id) => {
  const row = audit[name].find(row => row.id === id);
  assert.ok(row, `Missing audited ${name}/${id}`);
  return row.data;
};
assert.equal(get('stockItems', board84).qty, 300);
assert.equal(get('stockItems', board84).amount, 23400);
assert.equal(get('stockItems', board85).qty, 600);
assert.equal(get('stockItems', transitId).qty, 100);
assert.equal(get('stockItems', transitId).amount, 7800);
assert.equal(get('dispatchRecords', dispatchId).status, 'Pending Receipt');
for (const name of ['withdrawRecords', 'stockCancellationHistory', 'projectBorrowRequests', 'repairshop']) {
  assert.equal(audit[name].length, 0, `New movements require a new repair plan: ${name}`);
}
const csv = get('receivingRequests', csvId);
const items = csv.items.map(item => {
  if (!['FORMWORK-084', 'FORMWORK-085'].includes(item.materialNo)) return item;
  assert.equal(item.receivedQty, 300);
  assert.equal(item.amount, 0);
  return { ...item, receivedQty: 0, originalReceivedQty: 300,
    stockReconciliationReason: 'Duplicate opening balance excluded per user-confirmed physical receipt timeline.',
    stockRepairId: repairId };
});
assert.equal(items.filter(item => item.stockRepairId === repairId).length, 2);
const dispatch = get('dispatchRecords', dispatchId);
const dispatchItems = dispatch.items.map(item => item.stockReceiveNo === transitId ? { ...item, amount: 31200 } : item);
const changes = [
  { name: 'stockItems', id: board84, patch: { qty: 0, amount: 0 } },
  { name: 'stockItems', id: board85, patch: { qty: 300, amount: 64500 } },
  { name: 'stockItems', id: transitId, patch: { amount: 31200, unitPrice: 312 } },
  { name: 'receivingRequests', id: csvId, patch: {
    items, totalQty: items.reduce((sum, item) => sum + item.receivedQty, 0),
    stockReceiveNos: items.filter(item => item.receivedQty > 0).map(item => item.stockReceiveNo).filter(Boolean),
  } },
  { name: 'dispatchRecords', id: dispatchId, patch: { items: dispatchItems } },
];
for (const change of changes) Object.assign(change.patch, { stockRepairId: repairId, stockRepairedAt: at });
const expectedStocks = audit.stockItems.map(row => ({ id: row.id, data: {
  ...row.data, ...(changes.find(change => change.name === 'stockItems' && change.id === row.id)?.patch ?? {}),
} }));
for (const code of ['FORMWORK-084', 'FORMWORK-085']) {
  assert.equal(expectedStocks.filter(row => row.data.materialNo === code).reduce((sum, row) => sum + row.data.qty, 0), 300);
}
assert.equal(expectedStocks.reduce((sum, row) => sum + row.data.amount, 0), 158100);
fs.writeFileSync('.local-stock-repair/plan-20261007-v2.json', JSON.stringify({ repairId, changes, expectedStocks }, null, 2));
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', repairId,
  stocks: expectedStocks.map(row => ({ id: row.id, qty: row.data.qty, amount: row.data.amount, status: row.data.status })) }));
if (!process.argv.includes('--apply')) process.exit();
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter(line => /^VITE_FIREBASE_[A-Z_]+=/.test(line)).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
const db = getFirestore(initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, projectId: env.VITE_FIREBASE_PROJECT_ID }));
const markerRef = doc(db, root, 'root', 'stockRepairs', repairId);
const timer = setTimeout(() => { console.error('Timed out; inspect repair marker before retrying.'); process.exit(2); }, 45000);
try {
  await runTransaction(db, async transaction => {
    const marker = await transaction.get(markerRef);
    if (marker.exists()) return;
    const guarded = ['stockItems', 'receivingRequests', 'dispatchRecords'].flatMap(name => audit[name].map(row => ({ name, ...row })));
    const refs = guarded.map(row => doc(db, root, 'root', row.name, row.id));
    const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
    guarded.forEach((row, index) => assert.deepEqual(snapshots[index].data(), row.data, `Changed since audit: ${row.name}/${row.id}`));
    changes.forEach(change => transaction.update(doc(db, root, 'root', change.name, change.id), change.patch));
    transaction.set(markerRef, { id: repairId, repairedAt: at,
      reason: 'User confirmed total physical stock of 300 per board; exclude duplicate CSV lines and restore transfer valuation.',
      before: guarded, changes, after: expectedStocks,
    });
  });
  // Verify against the committed marker, including safe reruns after success.
  const marker = await getDocFromServer(markerRef);
  const committed = marker.data();
  for (const change of committed.changes) {
    const snapshot = await getDocFromServer(doc(db, root, 'root', change.name, change.id));
    for (const [key, value] of Object.entries(change.patch)) assert.deepEqual(snapshot.data()[key], value, `Verify ${change.id}/${key}`);
  }
  fs.writeFileSync('.local-stock-repair/verified-20261007-v2.json', JSON.stringify({ repairId, verifiedAt: new Date().toISOString(), stocks: committed.after }, null, 2));
  console.log('Verified all repaired quantities, values, CSV lines and dispatch lines on the server.');
} finally {
  clearTimeout(timer);
  await terminate(db);
}
