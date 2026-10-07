import fs from 'node:fs';
import { initializeApp } from 'firebase/app';
import { collection, getDocsFromServer, getFirestore, terminate } from 'firebase/firestore';

// Read-only incident audit. Server reads must succeed; offline data is not evidence.
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter(line => /^VITE_FIREBASE_[A-Z_]+=/.test(line)).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
const db = getFirestore(initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, projectId: env.VITE_FIREBASE_PROJECT_ID }));
const audit = { auditedAt: new Date().toISOString() };
const timer = setTimeout(() => { console.error('Server audit timed out; no verified audit saved.'); process.exit(2); }, 45000);
try {
  for (const name of ['stockItems', 'receivingRequests', 'dispatchRecords', 'stockRepairs', 'withdrawRecords', 'stockCancellationHistory', 'projectBorrowRequests', 'repairshop']) {
    const snapshot = await getDocsFromServer(collection(db, 'CMG-Store-Management', 'root', name));
    audit[name] = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }))
      .filter(row => /formwork-08[45]/i.test(JSON.stringify(row)) || name === 'stockRepairs');
  }
  fs.mkdirSync('.local-stock-repair', { recursive: true });
  fs.writeFileSync('.local-stock-repair/audit-20261007-server.json', JSON.stringify(audit, null, 2));
  console.log(JSON.stringify({
    auditedAt: audit.auditedAt,
    savedTo: '.local-stock-repair/audit-20261007-server.json',
    stockItems: audit.stockItems.map(({ id, data }) => ({
      id, itemNo: data.itemNo, project: data.cmgProjectCode,
      status: data.status, qty: data.qty, amount: data.amount,
    })),
    recordCounts: Object.fromEntries(Object.entries(audit)
      .filter(([, value]) => Array.isArray(value)).map(([name, rows]) => [name, rows.length])),
  }));
} finally {
  clearTimeout(timer);
  await terminate(db);
}
