import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { initializeApp } from 'firebase/app';
import { collection, doc, getDoc, getDocs, getFirestore, runTransaction, terminate } from 'firebase/firestore';

// Incident-specific repair. Requires the read-only audit saved before repair.
// Dry run by default; --apply uses an atomic, idempotent transaction.
const root = 'CMG-Store-Management';
const repairId = 'J02B-DSP-20261006-081838-stock-identity-v1';
const audit = JSON.parse(fs.readFileSync('.local-stock-repair/audit-before.json', 'utf8'));
const compiled = ts.transpileModule(fs.readFileSync('src/utils/stockIdentity.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createStockIdentityDocumentId } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const pairs = [
  { board: 'FORMWORK-084', corner: 'FORMWORK-052', oldId: 'stock_20ptwlivpm5p_j2b_formwork-084', expectedBefore: 427, expectedBoard: 400, expectedCorner: 327 },
  { board: 'FORMWORK-085', corner: 'FORMWORK-053', oldId: 'stock_1qq87m1phg36c_j2b_formwork-085', expectedBefore: 625, expectedBoard: 600, expectedCorner: 325 },
];
assert.equal(audit.receivingRequests.length, 3);
for (const key of ['withdrawRecords', 'projectBorrowRequests', 'repairshop']) assert.equal(audit[key].length, 0);
const repairedAt = new Date().toISOString();
const stocks = new Map();
const requestChanges = audit.receivingRequests.map(({ id, data }) => {
  assert.equal(data.requestStatus, 'approved');
  const items = data.items.map(item => {
    const pair = pairs.find(p => p.oldId === item.stockReceiveNo);
    if (!pair) return item;
    const before = audit.stockItems.find(s => s.id === pair.oldId).data;
    // The initial CSV used 084/085 for corners; the descriptions and later
    // corrected CSV identify them as 052/053. Preserve the original in audit.
    const isCorner = item.itemDescription === before.itemDescription;
    const materialNo = isCorner ? pair.corner : pair.board;
    assert.equal(isCorner || String(item.materialNo).toUpperCase() === pair.board, true);
    const stockId = createStockIdentityDocumentId('J2B', materialNo);
    const current = stocks.get(stockId) ?? { qty: 0, amount: 0, lines: [] };
    current.qty += item.receivedQty;
    current.amount += item.amount ?? 0;
    current.lines.push({ requestId: id, date: data.receiveDate, item, request: data });
    stocks.set(stockId, current);
    return { ...item, itemNo: isCorner ? pair.corner : item.itemNo, materialNo, stockReceiveNo: stockId };
  });
  return { id, data, patch: { items, stockReceiveNos: items.map(i => i.stockReceiveNo).filter(Boolean), stockRepairId: repairId } };
});
const plannedStocks = [...stocks].map(([id, aggregate]) => {
  const pair = pairs.find(p => [p.board, p.corner].some(code => createStockIdentityDocumentId('J2B', code) === id));
  const old = audit.stockItems.find(s => s.id === pair.oldId).data;
  const isBoard = id === pair.oldId;
  assert.equal(aggregate.qty, isBoard ? pair.expectedBoard : pair.expectedCorner);
  assert.equal(old.qty, pair.expectedBefore);
  const latest = [...aggregate.lines].sort((a, b) => b.date.localeCompare(a.date))[0];
  const first = [...aggregate.lines].sort((a, b) => a.date.localeCompare(b.date))[0];
  const itemNo = isBoard ? latest.item.itemNo : pair.corner;
  return { id, data: {
    ...old,
    stockItemId: id, itemNo, materialNo: isBoard ? pair.board : pair.corner,
    itemDescription: latest.item.itemDescription, qty: aggregate.qty, amount: aggregate.amount,
    location: 'Store PRJ-2026-J-02B', purchasedForProject: 'Project PRJ-2026-J-02B',
    projectId: 'PRJ-2026-J-02B', cmgProjectCode: 'J2B', status: 'Received at Site',
    receiveNo: first.requestId, sourceReceiveNo: latest.requestId,
    prNo: latest.item.prNo || latest.request.prNo || '',
    poNo: latest.request.poNo || '', poType: latest.request.poType,
    receiveDate: latest.date, lastReceivedAt: latest.date, lastReceiveEventId: latest.requestId,
    lastReceivedQty: latest.item.receivedQty,
    lastDispatchNo: isBoard ? 'DSP-20261006-081838' : '',
    vendorName: latest.request.vendorName || old.vendorName,
    unit: latest.item.unit || 'pcs.', itemType: 'FWPR', itemTypeGroup: 'Type 2',
    receiveName: latest.request.receiveName || old.receiveName,
    receivedByUid: latest.request.receivedByUid || old.receivedByUid,
    receivedByName: latest.request.receivedByName || old.receivedByName,
    receivedByEmail: latest.request.receivedByEmail || latest.request.approvedByEmail || old.receivedByEmail,
    stockRepairId: repairId, stockRepairedAt: repairedAt,
  } };
});
assert.equal(plannedStocks.reduce((sum, s) => sum + s.data.qty, 0), 1652);
assert.equal(plannedStocks.reduce((sum, s) => sum + s.data.amount, 0), 95700);
fs.writeFileSync('.local-stock-repair/plan.json', JSON.stringify({ repairId, plannedStocks, requestChanges }, null, 2));
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', stocks: plannedStocks.map(s => ({ id: s.id, itemNo: s.data.itemNo, qty: s.data.qty, amount: s.data.amount })), restoredOverwrittenQty: 600 }));
if (!process.argv.includes('--apply')) process.exit();

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(line => /^VITE_FIREBASE_[A-Z_]+=/.test(line)).map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const db = getFirestore(initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, projectId: env.VITE_FIREBASE_PROJECT_ID }));
const repairRef = doc(db, root, 'root', 'stockRepairs', repairId);
const timer = setTimeout(() => { console.error('Timed out; check stockRepairs before retrying.'); process.exit(1); }, 45000);
try {
  const done = await getDoc(repairRef);
  if (!done.exists()) {
    const relatedIds = new Set(plannedStocks.map(s => s.id));
    // Refuse an outdated plan if new stock movements have been recorded.
    for (const col of ['withdrawRecords', 'projectBorrowRequests', 'repairshop', 'dispatchRecords', 'stockItems', 'receivingRequests']) {
      const snapshot = await getDocs(collection(db, root, 'root', col));
      const related = snapshot.docs.map(d => ({ id: d.id, data: d.data() })).filter(d => [...relatedIds].some(id => JSON.stringify(d.data).includes(id)));
      assert.deepEqual(related, audit[col], `Live ${col} changed since audit; rebuild the plan.`);
    }
  }
  await runTransaction(db, async transaction => {
    const marker = await transaction.get(repairRef);
    if (marker.exists()) return;
    const refs = [
      ...plannedStocks.map(s => doc(db, root, 'root', 'stockItems', s.id)),
      ...requestChanges.map(r => doc(db, root, 'root', 'receivingRequests', r.id)),
    ];
    const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
    plannedStocks.forEach((s, index) => {
      const before = audit.stockItems.find(old => old.id === s.id);
      if (before) assert.deepEqual(snapshots[index].data(), before.data, 'Stock changed; repair aborted.');
      else assert.equal(snapshots[index].exists(), false, 'Corner destination already exists; repair aborted.');
    });
    requestChanges.forEach((r, index) => assert.deepEqual(snapshots[plannedStocks.length + index].data(), r.data, 'Receipt changed; repair aborted.'));
    plannedStocks.forEach((s, index) => transaction.set(refs[index], s.data));
    requestChanges.forEach((r, index) => transaction.update(refs[plannedStocks.length + index], r.patch));
    transaction.set(repairRef, {
      id: repairId, repairedAt, reason: 'Split mixed CSV stock identities and restore overwritten approved receipt quantities; reconcile transfer DSP-20261006-081838.',
      before: { stockItems: audit.stockItems, receivingRequests: audit.receivingRequests },
      after: plannedStocks, restoredOverwrittenQty: 600,
    });
  });
  const verified = [];
  for (const planned of plannedStocks) {
    const snapshot = await getDoc(doc(db, root, 'root', 'stockItems', planned.id));
    const data = snapshot.data();
    for (const key of ['itemNo', 'materialNo', 'itemDescription', 'qty', 'amount', 'cmgProjectCode', 'stockRepairId']) assert.deepEqual(data[key], planned.data[key]);
    verified.push({ id: planned.id, itemNo: data.itemNo, qty: data.qty, itemDescription: data.itemDescription });
  }
  for (const request of requestChanges) {
    const snapshot = await getDoc(doc(db, root, 'root', 'receivingRequests', request.id));
    assert.deepEqual(snapshot.data().items, request.patch.items);
  }
  fs.writeFileSync('.local-stock-repair/verified-after.json', JSON.stringify({ repairId, verified }, null, 2));
  console.log(JSON.stringify({ verified }));
} finally {
  clearTimeout(timer);
  await terminate(db);
}
