// Production access is READ ONLY. No Auth, Storage, transaction, write, or repair API.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { collection, getDocsFromServer, getFirestore, terminate } from 'firebase/firestore';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter(line => /^VITE_FIREBASE_[A-Z_]+=/.test(line)).map(line => {
  const at = line.indexOf('=');
  return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const db = getFirestore(initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, projectId: env.VITE_FIREBASE_PROJECT_ID }, 'inventory-readonly-audit'));
const timer = setTimeout(() => { console.error('Read-only server audit timed out; no verified server report produced.'); process.exit(2); }, 20000);
try {
  const names = ['stockItems', 'receivingRequests', 'dispatchRecords', 'withdrawRecords', 'projectBorrowRequests', 'cancellationRequests'];
  const results = await Promise.allSettled(names.map(async name => {
    const snapshot = await getDocsFromServer(collection(db, 'CMG-Store-Management', 'root', name));
    return [name, snapshot.docs.map(document => ({ id: document.id, ...document.data() }))];
  }));
  const failed = results.flatMap((result, index) => result.status === 'rejected' ? [{ collection: names[index], code: result.reason?.code ?? 'unknown', message: String(result.reason?.message ?? result.reason) }] : []);
  if (failed.length) { console.error(JSON.stringify({ readOnly: true, errors: failed })); process.exitCode = 1; }
  else {
    const data = Object.fromEntries(results.map(result => result.value));
    const anomalies = [];
    const stocks = new Map(data.stockItems.map(item => [item.id, item]));
    for (const item of data.stockItems) {
      if (!Number.isFinite(Number(item.qty)) || Number(item.qty) < 0) anomalies.push({ type: 'invalid_stock_qty', id: item.id, qty: item.qty });
      if (item.itemNo && item.materialNo && String(item.itemNo).trim().toUpperCase() !== String(item.materialNo).trim().toUpperCase()) anomalies.push({ type: 'conflicting_stock_identity', id: item.id, itemNo: item.itemNo, materialNo: item.materialNo });
    }
    const borrowerLinks = new Map();
    for (const request of data.projectBorrowRequests) {
      if (request.status === 'In Transit') {
        const dispatch = data.dispatchRecords.find(record => record.dispatchNo === request.dispatchNo);
        if (!dispatch || dispatch.status === 'Dispatch Cancelled') anomalies.push({ type: 'borrow_stuck_in_transit', id: request.id, dispatchNo: request.dispatchNo });
      }
      if (!['Borrowed', 'Return Requested'].includes(request.status)) continue;
      for (const item of request.items ?? []) {
        if (!item.borrowedStockItemId || !stocks.has(item.borrowedStockItemId)) anomalies.push({ type: 'active_borrow_missing_stock', id: request.id, stockId: item.borrowedStockItemId });
        if (item.borrowedStockItemId) borrowerLinks.set(item.borrowedStockItemId, [...(borrowerLinks.get(item.borrowedStockItemId) ?? []), request.id]);
      }
    }
    for (const [stockId, requests] of borrowerLinks) if (new Set(requests).size > 1) anomalies.push({ type: 'shared_borrower_stock', stockId, requests });
    for (const request of data.receivingRequests) {
      if (request.requestStatus !== 'approved' || !Array.isArray(request.items)) continue;
      const ids = request.items.filter(item => Number(item.receivedQty) > 0).map(item => item.stockReceiveNo).filter(Boolean);
      if (new Set(ids).size < ids.length) anomalies.push({ type: 'receipt_duplicate_stock_lines_cancellation_risk', id: request.id });
    }
    const report = { auditedAt: new Date().toISOString(), readOnly: true, source: 'getDocsFromServer', counts: Object.fromEntries(names.map(name => [name, data[name].length])), anomalies, limitations: ['Separate server collection reads are not a globally atomic snapshot.', 'Anomalies are candidates for investigation, not proof of historical stock loss.', 'No Firebase rules, deployed version, or physical stock reconciliation performed.'] };
    mkdirSync(new URL('../.local-stock-repair/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../.local-stock-repair/flow-audit-server-readonly-20261007.json', import.meta.url), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
} finally { clearTimeout(timer); await terminate(db); }
