// Offline audit: no Firebase SDK imports, credentials, network, or production writes.
// Extracts the actual TypeScript callbacks and injects an in-memory Firestore double.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/context/InventoryContext.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('InventoryContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const helpers = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name.text !== 'InventoryProvider' && n.name.text !== 'useInventory' && n.name.text !== 'logInventoryActivity').map(n => n.getText(ast)).join('\n');
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === 'useCallback') callbacks.set(node.name.getText(ast), node.initializer.arguments[0].getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const helperJs = compile(helpers);
const callbackJs = new Map([...callbacks].map(([name, callback]) => [name, compile(`const callback = ${callback};`)]));
async function utility(path) {
  return import(`data:text/javascript;base64,${Buffer.from(compile(readFileSync(new URL(path, import.meta.url), 'utf8'))).toString('base64')}`);
}
const stockUtility = await utility('../src/utils/stockItem.ts');
const identityUtility = await utility('../src/utils/stockIdentity.ts');
const typeUtility = await utility('../src/constants/itemTypes.ts');
const clone = value => structuredClone(value);
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-07T05:00:00.123Z'])); }
  static now() { return new FixedDate().getTime(); }
}
function harness(seed = {}, options = {}) {
  const records = new Map(Object.entries(seed).map(([key, value]) => [key, clone(value)]));
  const versions = new Map();
  let autoId = 0;
  const refFor = (...args) => {
    const parts = args.filter(a => a !== null && a !== undefined).map(a => typeof a === 'object' ? a.path : a);
    const path = parts.join('/');
    return { path, id: path.split('/').at(-1) };
  };
  const snapshot = ref => {
    const data = clone(records.get(ref.path));
    return { id: ref.id, exists: () => data !== undefined, data: () => clone(data) };
  };
  const apply = (op, ref, data, config) => {
    if (op === 'delete') records.delete(ref.path);
    else {
      if (op === 'update' && !records.has(ref.path)) throw new Error('Missing document');
      const previous = records.get(ref.path) ?? {};
      const resolved = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v && v.__increment !== undefined ? (previous[k] ?? 0) + v.__increment : v]));
      records.set(ref.path, clone(op === 'update' || config?.merge ? { ...previous, ...resolved } : resolved));
    }
    versions.set(ref.path, (versions.get(ref.path) ?? 0) + 1);
  };
  const context = {
    items: [], dispatchList: [], withdrawList: [], projectBorrowList: [], receivingRequestList: [], cancellationRequestList: [],
    visibleProjectBorrowRequests: [], visibleCancellationRequests: [], visibleStockItems: [],
    projectList: ['J1', 'J2', 'J3'].map(projectNo => ({ projectNo, projectName: projectNo, status: 'Active' })),
    activeProjectNo: 'J1',
    userProfile: { uid: 'approver-2', role: ['MasterAdmin'], assignedProjects: ['J1', 'J2', 'J3'], email: 'audit@example.invalid' },
    db: null, storage: null, APP_NAME: 'CMG-Store-Management', Date: FixedDate,
    ...stockUtility, ...identityUtility, matchesProjectBorrowItemType: typeUtility.matchesProjectBorrowItemType,
    logInventoryActivity: async () => {},
    canApproveCancellation: () => true,
    getProjectBorrowApprover: () => true,
    collection: (...args) => refFor(...args),
    doc: (...args) => args.length === 1 ? refFor(args[0], options.fixedDocumentSuffix ?? `auto-${++autoId}`) : refFor(...args),
    increment: value => ({ __increment: value }), serverTimestamp: () => 'MOCK_TIMESTAMP',
    setDoc: async (ref, data, config) => apply('set', ref, data, config),
    runTransaction: async (_db, action) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const reads = new Map();
        const pending = [];
        const transaction = {
          get: async ref => {
            if (pending.length) throw new Error('Transaction read after write');
            reads.set(ref.path, versions.get(ref.path) ?? 0);
            return snapshot(ref);
          },
          set: (ref, data, config) => pending.push(['set', ref, data, config]),
          update: (ref, data) => pending.push(['update', ref, data]),
          delete: ref => pending.push(['delete', ref]),
        };
        const result = await action(transaction);
        if ([...reads].some(([path, version]) => (versions.get(path) ?? 0) !== version)) continue;
        for (const operation of pending) apply(...operation);
        return result;
      }
      throw new Error('Mock transaction conflict retry limit');
    },
    ref: () => { throw new Error('Storage is forbidden in this offline audit'); },
    uploadBytes: () => { throw new Error('Storage is forbidden in this offline audit'); },
    getDownloadURL: () => { throw new Error('Storage is forbidden in this offline audit'); },
    ...options,
  };
  context.visibleProjects = context.projectList;
  const normalize = new Function(...Object.keys(context), helperJs + '\nreturn {normalizeStockItem, normalizeWithdrawRecord, normalizeProjectBorrowRequest, normalizeReceivingRequest};')(...Object.values(context));
  function refresh() {
    for (const [list, collectionName, normalizer] of [
      ['items', 'stockItems', normalize.normalizeStockItem], ['dispatchList', 'dispatchRecords', (x, id) => ({ ...x, id })],
      ['withdrawList', 'withdrawRecords', normalize.normalizeWithdrawRecord], ['projectBorrowList', 'projectBorrowRequests', normalize.normalizeProjectBorrowRequest],
      ['receivingRequestList', 'receivingRequests', normalize.normalizeReceivingRequest], ['cancellationRequestList', 'cancellationRequests', (x, id) => ({ ...x, id })],
    ]) {
      const prefix = `CMG-Store-Management/root/${collectionName}/`;
      context[list].splice(0, context[list].length, ...[...records].filter(([path]) => path.startsWith(prefix)).map(([path, data]) => normalizer(clone(data), path.split('/').at(-1))));
    }
    for (const [visible, list] of [['visibleProjectBorrowRequests', 'projectBorrowList'], ['visibleCancellationRequests', 'cancellationRequestList'], ['visibleStockItems', 'items']]) context[visible].splice(0, context[visible].length, ...context[list]);
  }
  refresh();
  const operations = {};
  // Compile each function without its React hook or any module imports.
  for (const [name, code] of callbackJs) operations[name] = new Function(...Object.keys(context), helperJs + code + '\nreturn callback;')(...Object.values(context));
  return { operations, records, context, refresh, get: (col, id) => records.get(path(col, id)), all: col => [...records].filter(([key]) => key.startsWith(`CMG-Store-Management/root/${col}/`)).map(([, value]) => value), mutate: (col, id, data) => apply('set', refFor(path(col, id)), data) };
}
const path = (col, id) => `CMG-Store-Management/root/${col}/${id}`;
const stock = (id, project = 'J1', qty = 100, extra = {}) => ({ stockItemId: id, receiveNo: id, itemNo: 'EQM-1', materialNo: 'EQM-1', itemDescription: 'Audit tool', qty, amount: qty * 10, status: 'Available', location: `Store ${project}`, purchasedForProject: `Project ${project}`, cmgProjectCode: project, itemType: 'EQM', ...(extra.status === 'Borrowed' ? { projectBorrowRequestNo: 'B1' } : {}), ...extra });
const borrow = (id = 'B1', extra = {}) => ({ id, requestNo: id, lenderProjectNo: 'J1', borrowerProjectNo: 'J2', status: 'Return Requested', items: [{ sourceStockItemId: 'S1', borrowedStockItemId: 'D1', receiveNo: 'S1', itemNo: 'EQM-1', materialNo: 'EQM-1', qty: 30, receivedQty: 30, amount: 300, sourceLocation: 'Store J1', sourceStatus: 'Available' }], ...extra });
const cancellation = (entityType, entityId) => ({ id: 'C1', cancellationNo: 'C1', entityType, entityId, referenceNo: entityId, reason: 'Offline audit', status: 'Pending Approval', approvalStep: 1, requestedByUid: 'requester', firstApprovedByUid: 'approver-1', projectNos: ['J1', 'J2'] });
const receiving = (id = 'R1', lines = [30], extra = {}) => ({ id, receiveNo: id, projectNo: 'J1', cmgProjectCode: 'J1', projectName: 'J1', location: 'Store J1', requestStatus: 'pending', items: lines.map(qty => ({ itemNo: 'EQM-1', materialNo: 'EQM-1', receivedQty: qty, amount: qty * 10 })), ...extra });
const dispatchInput = (qty = 30) => ({ sourceProjectNo: 'J1', projectNo: 'J2', items: [{ receiveNo: 'S1', qty }], transport: '', note: '', photos: [] });
const withdrawInput = (type = 'borrow', qty = 30) => ({ projectNo: 'J1', type, items: [{ receiveNo: 'S1', qty, requesterName: 'Audit' }], withdrawDate: '2026-10-07', dueDate: '2026-10-10', purpose: 'Offline audit', photos: [] });
function check(name, _kind, action) {
  test(name, action);
}

await check('Receive once; replay does not add stock', 'PASS', async () => {
  const h = harness({ [path('receivingRequests', 'R1')]: receiving() });
  await h.operations.approveReceivingRequest('R1');
  await h.operations.approveReceivingRequest('R1');
  assert.equal(h.all('stockItems')[0].qty, 30); return { qty: 30 };
});
await check('Partial transfer 40 + 60; replay remains 100', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createDispatch(dispatchInput(100)); h.refresh();
  const d = h.all('dispatchRecords')[0];
  await h.operations.receiveDispatch(d.id, [{ stockReceiveNo: d.items[0].stockReceiveNo, receivedQty: 40 }]); h.refresh();
  assert.equal(h.all('stockItems').reduce((s, x) => s + x.qty, 0), 100);
  await h.operations.receiveDispatch(d.id); h.refresh(); await h.operations.receiveDispatch(d.id);
  assert.equal(h.all('stockItems').reduce((s, x) => s + x.qty, 0), 100); return { total: 100 };
});
await check('Cancel dispatch restores source once', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createDispatch(dispatchInput()); h.refresh(); const d = h.all('dispatchRecords')[0];
  await h.operations.cancelDispatch(d.id); h.refresh(); await h.operations.cancelDispatch(d.id);
  assert.equal(h.get('stockItems', 'S1').qty, 100); return { source: 100 };
});
await check('Cannot cancel a partially received dispatch', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createDispatch(dispatchInput()); h.refresh(); const d = h.all('dispatchRecords')[0];
  await h.operations.receiveDispatch(d.id, [{ stockReceiveNo: d.items[0].stockReceiveNo, receivedQty: 10 }]); h.refresh();
  await assert.rejects(h.operations.cancelDispatch(d.id), /บางส่วน/); return { blocked: true };
});
await check('Borrow withdrawal return and replay conserve 100', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createWithdraw(withdrawInput()); h.refresh(); const w = h.all('withdrawRecords')[0];
  await h.operations.returnWithdraw(w.id); await h.operations.returnWithdraw(w.id);
  assert.equal(h.get('stockItems', 'S1').qty, 100); return { source: 100 };
});
await check('Issue cancellation and return after cancellation add only once', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createWithdraw(withdrawInput()); h.refresh(); const w = h.all('withdrawRecords')[0];
  await h.operations.cancelWithdraw(w.id); await h.operations.returnWithdraw(w.id);
  assert.equal(h.get('stockItems', 'S1').qty, 100); return { source: 100 };
});
await check('Concurrent withdrawals beyond stock reject one atomically', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  const outcomes = await Promise.allSettled([h.operations.createWithdraw(withdrawInput('issue', 70)), h.operations.createWithdraw(withdrawInput('issue', 70))]);
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1); assert.equal(h.get('stockItems', 'S1').qty, 30); return { source: 30, rejected: 1 };
});
await check('Same-second dispatches have unique IDs and conserve stock', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createDispatch(dispatchInput()); h.refresh(); await h.operations.createDispatch(dispatchInput());
  assert.equal(h.all('dispatchRecords').length, 2); assert.equal(h.all('stockItems').reduce((s, x) => s + x.qty, 0), 100);
});
await check('Same-millisecond withdrawals retain both liability records', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createWithdraw(withdrawInput()); h.refresh(); await h.operations.createWithdraw(withdrawInput()); h.refresh();
  assert.equal(h.all('withdrawRecords').length, 2);
  for (const w of h.all('withdrawRecords')) await h.operations.returnWithdraw(w.id);
  assert.equal(h.get('stockItems', 'S1').qty, 100);
});
await check('Duplicate material receipt lines cancel the aggregated quantity', 'PASS', async () => {
  const h = harness({ [path('receivingRequests', 'R1')]: receiving('R1', [20, 30]) });
  await h.operations.approveReceivingRequest('R1'); h.refresh();
  h.mutate('cancellationRequests', 'C1', cancellation('receiving', 'R1')); h.refresh();
  await h.operations.approveCancellationRequest('C1');
  assert.equal(h.all('stockItems').length, 0); assert.equal(h.get('receivingRequests', 'R1').requestStatus, 'cancelled');
});
await check('MasterAdmin delete groups duplicate material lines correctly', 'PASS', async () => {
  const h = harness({ [path('receivingRequests', 'R1')]: receiving('R1', [20, 30]) });
  await h.operations.approveReceivingRequest('R1'); h.refresh(); await h.operations.deleteReceivingRequest('R1');
  assert.equal(h.all('stockItems').length, 0); return { remainingDocuments: 0 };
});
await check('Project borrow return without borrower stock is blocked atomically', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 70), [path('projectBorrowRequests', 'B1')]: borrow() });
  const before = JSON.stringify([...h.records]);
  await assert.rejects(h.operations.completeProjectBorrowReturn('B1'), /สต็อกผู้ยืม/);
  assert.equal(JSON.stringify([...h.records]), before);
});
await check('Project borrow cancellation preserves unrelated balance', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 70), [path('stockItems', 'D1')]: stock('D1', 'J2', 50, { status: 'Borrowed' }), [path('projectBorrowRequests', 'B1')]: borrow('B1', { status: 'Borrowed' }), [path('cancellationRequests', 'C1')]: cancellation('projectBorrow', 'B1') });
  await h.operations.approveCancellationRequest('C1');
  assert.equal(h.get('stockItems', 'D1').qty, 20); assert.equal(h.get('stockItems', 'D1').amount, 200); assert.equal(h.get('stockItems', 'S1').qty, 100);
});
await check('Project borrow return apportions amount to returned quantity', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 70), [path('stockItems', 'D1')]: stock('D1', 'J2', 50, { status: 'Borrowed' }), [path('projectBorrowRequests', 'B1')]: borrow() });
  await h.operations.completeProjectBorrowReturn('B1');
  assert.equal(h.get('stockItems', 'D1').qty, 20); assert.equal(h.get('stockItems', 'D1').amount, 200); assert.equal(h.get('stockItems', 'S1').amount, 1000);
});
await check('One dispatch links only its explicitly selected borrow request', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1'), [path('projectBorrowRequests', 'B1')]: borrow('B1', { status: 'Pending Dispatch' }), [path('projectBorrowRequests', 'B2')]: borrow('B2', { status: 'Pending Dispatch' }) });
  await h.operations.createDispatch({ ...dispatchInput(), projectBorrowRequestId: 'B1' }); h.refresh(); const d = h.all('dispatchRecords')[0];
  await h.operations.receiveDispatch(d.id); h.refresh();
  const [b1, b2] = h.all('projectBorrowRequests'); assert.equal(b2.status, 'Pending Dispatch'); assert.notEqual(b1.items[0].borrowedStockItemId, b2.items[0].borrowedStockItemId);
  h.mutate('projectBorrowRequests', 'B1', { ...b1, status: 'Return Requested' }); h.refresh(); await h.operations.completeProjectBorrowReturn('B1');
  assert.equal(h.get('stockItems', 'S1').qty, 100); assert.equal(h.get('projectBorrowRequests', 'B2').status, 'Pending Dispatch');
});
await check('Cancel linked dispatch resets borrow to Pending Dispatch', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1'), [path('projectBorrowRequests', 'B1')]: borrow('B1', { status: 'Pending Dispatch' }) });
  await h.operations.createDispatch({ ...dispatchInput(), projectBorrowRequestId: 'B1' }); h.refresh(); const d = h.all('dispatchRecords')[0]; await h.operations.cancelDispatch(d.id);
  assert.equal(h.get('projectBorrowRequests', 'B1').status, 'Pending Dispatch'); assert.equal(h.get('stockItems', 'S1').qty, 100);
});
await check('Cancel transfer receiving history is forbidden without a reverse transfer', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createDispatch(dispatchInput()); h.refresh(); const d = h.all('dispatchRecords')[0]; await h.operations.receiveDispatch(d.id); h.refresh();
  h.mutate('cancellationRequests', 'C1', cancellation('receiving', `${d.id}-RECEIVE`)); h.refresh();
  await assert.rejects(h.operations.approveCancellationRequest('C1'), /ย้ายคืน/);
  await assert.rejects(h.operations.deleteReceivingRequest(`${d.id}-RECEIVE`), /ย้ายคืน/);
  assert.equal(h.all('stockItems').reduce((s, x) => s + x.qty, 0), 100);
});
await check('Fractional dispatch is rejected before stock is changed', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await assert.rejects(h.operations.createDispatch(dispatchInput(0.5)), /จำนวนเต็ม/); assert.equal(h.get('stockItems', 'S1').qty, 100);
});
await check('Repair stock cannot be issued or dispatched', 'PASS', async () => {
  const a = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 100, { status: 'Repair' }) });
  await assert.rejects(a.operations.createWithdraw(withdrawInput('issue')), /available/);
  const b = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 100, { status: 'Repair' }) }); await assert.rejects(b.operations.createDispatch(dispatchInput()), /available/);
  assert.equal(a.get('stockItems', 'S1').qty, 100); assert.equal(b.get('stockItems', 'S1').qty, 100);
});
await check('Receiving stale pending document is blocked', 'PASS', async () => {
  const h = harness({ [path('receivingRequests', 'R1')]: receiving() });
  h.mutate('receivingRequests', 'R1', receiving('R1', [5]));
  await assert.rejects(h.operations.approveReceivingRequest('R1'), /รีเฟรช/); assert.equal(h.all('stockItems').length, 0);
});
await check('Partial PO approval tracks outstanding quantity for subsequent receipt', 'PASS', async () => {
  const h = harness({ [path('receivingRequests', 'R1')]: receiving('R1', [100]) });
  await h.operations.approveReceivingRequest('R1', [{ itemIndex: 0, receivedQty: 40 }]); h.refresh();
  assert.equal(h.get('receivingRequests', 'R1').requestStatus, 'pending'); assert.equal(h.context.receivingRequestList[0].items[0].receivedQty, 60);
  await h.operations.approveReceivingRequest('R1', [{ itemIndex: 0, receivedQty: 60 }]);
  assert.equal(h.all('stockItems')[0].qty, 100); assert.equal(h.get('receivingRequests', 'R1').requestStatus, 'approved'); assert.equal(h.get('receivingRequests', 'R1').items[0].amount, 1000);
});
await check('Corrupt stock identity blocks ordinary receiving', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 100, { itemNo: 'OTHER', materialNo: 'EQM-1' }), [path('receivingRequests', 'R1')]: receiving() });
  await assert.rejects(h.operations.approveReceivingRequest('R1'), /รหัสขัดกัน/); assert.equal(h.get('stockItems', 'S1').qty, 100); assert.equal(h.get('stockItems', 'S1').itemNo, 'OTHER');
});
await check('Ordinary project borrow return conserves stock; replay is blocked', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 70), [path('stockItems', 'D1')]: stock('D1', 'J2', 30, { status: 'Borrowed' }), [path('projectBorrowRequests', 'B1')]: borrow() });
  await h.operations.completeProjectBorrowReturn('B1');
  await assert.rejects(h.operations.completeProjectBorrowReturn('B1'), /รอรับคืน/);
  assert.equal(h.get('stockItems', 'S1').qty, 100); assert.equal(h.get('stockItems', 'S1').amount, 1000);
  return { qty: 100, amount: 1000, replayBlocked: true };
});
await check('Over-receipt leaves all documents unchanged', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createDispatch(dispatchInput()); h.refresh(); const d = h.all('dispatchRecords')[0];
  const before = JSON.stringify([...h.records]);
  await assert.rejects(h.operations.receiveDispatch(d.id, [{ stockReceiveNo: d.items[0].stockReceiveNo, receivedQty: 31 }]), /จำนวนรับเข้า/);
  assert.equal(JSON.stringify([...h.records]), before); return { noChanges: true };
});

test('Transfer receipt accepts reordered Firestore map keys and remains idempotent', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createDispatch(dispatchInput()); h.refresh();
  const d = h.all('dispatchRecords')[0];
  const reorderedItems = d.items.map(item => Object.fromEntries(Object.entries(item).reverse()));
  assert.notEqual(JSON.stringify(reorderedItems), JSON.stringify(d.items));
  h.mutate('dispatchRecords', d.id, { ...d, items: reorderedItems });
  await h.operations.receiveDispatch(d.id, [{ stockReceiveNo: d.items[0].stockReceiveNo, receivedQty: 10 }]);
  h.refresh();
  assert.equal(h.get('dispatchRecords', d.id).totalReceivedQty, 10);
  assert.equal(h.get('stockItems', d.items[0].stockReceiveNo).qty, 20);
  await h.operations.receiveDispatch(d.id); h.refresh();
  assert.equal(h.get('dispatchRecords', d.id).totalReceivedQty, 30);
  assert.equal(h.get('dispatchRecords', d.id).status, 'Received at Site');
  const after = JSON.stringify([...h.records]);
  await h.operations.receiveDispatch(d.id);
  assert.equal(JSON.stringify([...h.records]), after);
  assert.equal(h.all('stockItems').reduce((sum, item) => sum + item.qty, 0), 100);
});

test('Transfer receipt still rejects actual changes without writing any documents', async () => {
  for (const change of [
    d => ({ ...d, items: d.items.map(item => ({ ...item, qty: item.qty - 1 })) }),
    d => ({ ...d, items: d.items.map(item => ({ ...item, receivedQty: 1 })) }),
    d => ({ ...d, items: d.items.map(item => ({ ...item, materialNo: 'OTHER' })) }),
    d => ({ ...d, sourceProjectNo: 'J3' }),
    d => ({ ...d, destinationProjectNo: 'J3' }),
    d => ({ ...d, projectBorrowRequestId: 'B2' }),
  ]) {
    const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
    await h.operations.createDispatch(dispatchInput()); h.refresh();
    const d = h.all('dispatchRecords')[0];
    h.mutate('dispatchRecords', d.id, change(d));
    const before = JSON.stringify([...h.records]);
    await assert.rejects(h.operations.receiveDispatch(d.id), /รายการรับเข้ามีการเปลี่ยนแปลง/);
    assert.equal(JSON.stringify([...h.records]), before);
  }
});
await check('Borrow short return remains open without moving any stock', 'PASS', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 70), [path('stockItems', 'D1')]: stock('D1', 'J2', 10, { status: 'Borrowed' }), [path('projectBorrowRequests', 'B1')]: borrow() });
  await assert.rejects(h.operations.completeProjectBorrowReturn('B1'), /ไม่ครบ/);
  assert.equal(h.get('stockItems', 'S1').qty, 70); assert.equal(h.get('projectBorrowRequests', 'B1').status, 'Return Requested');
});

test('Forced ID collision is rejected without overwriting dispatch or withdrawal', async () => {
  for (const type of ['dispatch', 'withdraw']) {
    const h = harness({ [path('stockItems', 'S1')]: stock('S1') }, { fixedDocumentSuffix: 'COLLISION' });
    const create = () => type === 'dispatch' ? h.operations.createDispatch(dispatchInput()) : h.operations.createWithdraw(withdrawInput());
    await create(); h.refresh(); const before = JSON.stringify([...h.records]);
    await assert.rejects(create(), /ซ้ำ|already exists/); assert.equal(JSON.stringify([...h.records]), before);
  }
});
test('Concurrent dispatches of the same borrow request commit only once', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1'), [path('projectBorrowRequests', 'B1')]: borrow('B1', { status: 'Pending Dispatch' }) });
  const input = { ...dispatchInput(), projectBorrowRequestId: 'B1' };
  const results = await Promise.allSettled([h.operations.createDispatch(input), h.operations.createDispatch(input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(h.get('stockItems', 'S1').qty, 70); assert.equal(h.all('dispatchRecords').length, 1);
});
test('Two borrow requests keep separate stock and concurrent returns conserve quantity and amount', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1'), [path('projectBorrowRequests', 'B1')]: borrow('B1', { status: 'Pending Dispatch' }), [path('projectBorrowRequests', 'B2')]: borrow('B2', { status: 'Pending Dispatch' }) });
  for (const id of ['B1', 'B2']) {
    await h.operations.createDispatch({ ...dispatchInput(), projectBorrowRequestId: id }); h.refresh();
    const d = h.all('dispatchRecords').find(record => record.projectBorrowRequestId === id);
    await h.operations.receiveDispatch(d.id); h.refresh();
  }
  const b1 = h.get('projectBorrowRequests', 'B1'); const b2 = h.get('projectBorrowRequests', 'B2');
  assert.notEqual(b1.items[0].borrowedStockItemId, b2.items[0].borrowedStockItemId);
  for (const id of ['B1', 'B2']) await h.operations.requestProjectBorrowReturn(id);
  h.refresh();
  await Promise.all([h.operations.completeProjectBorrowReturn('B1'), h.operations.completeProjectBorrowReturn('B2')]);
  assert.equal(h.get('stockItems', 'S1').qty, 100); assert.equal(h.get('stockItems', 'S1').amount, 1000);
});
test('Borrow receiving and dispatch cancellation use persisted link even when listener list is stale', async () => {
  for (const action of ['receive', 'cancel']) {
    const h = harness({ [path('stockItems', 'S1')]: stock('S1'), [path('projectBorrowRequests', 'B1')]: borrow('B1', { status: 'Pending Dispatch' }) });
    await h.operations.createDispatch({ ...dispatchInput(), projectBorrowRequestId: 'B1' }); h.refresh();
    const d = h.all('dispatchRecords')[0]; h.context.projectBorrowList.splice(0);
    if (action === 'receive') await h.operations.receiveDispatch(d.id); else await h.operations.cancelDispatch(d.id);
    assert.equal(h.get('projectBorrowRequests', 'B1').status, action === 'receive' ? 'Borrowed' : 'Pending Dispatch');
    assert.equal(h.all('stockItems').reduce((sum, item) => sum + item.qty, 0), 100);
  }
});
test('Partial borrower receipts retain In Transit until all requested stock arrives', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1'), [path('projectBorrowRequests', 'B1')]: borrow('B1', { status: 'Pending Dispatch' }) });
  await h.operations.createDispatch({ ...dispatchInput(), projectBorrowRequestId: 'B1' }); h.refresh();
  const d = h.all('dispatchRecords')[0]; const line = d.items[0].stockReceiveNo;
  await h.operations.receiveDispatch(d.id, [{ stockReceiveNo: line, receivedQty: 10 }]); h.refresh();
  assert.equal(h.get('projectBorrowRequests', 'B1').status, 'In Transit');
  await h.operations.receiveDispatch(d.id, [{ stockReceiveNo: line, receivedQty: 20 }]); h.refresh();
  assert.equal(h.get('projectBorrowRequests', 'B1').status, 'Borrowed');
  await h.operations.requestProjectBorrowReturn('B1'); h.refresh(); await h.operations.completeProjectBorrowReturn('B1');
  assert.equal(h.get('stockItems', 'S1').qty, 100);
});
test('Legacy requests sharing a transit document cannot double-claim a receipt', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1'), [path('projectBorrowRequests', 'B1')]: borrow('B1', { status: 'Pending Dispatch' }) });
  await h.operations.createDispatch({ ...dispatchInput(), projectBorrowRequestId: 'B1' }); h.refresh();
  const d = h.all('dispatchRecords')[0]; h.mutate('dispatchRecords', d.id, { ...d, projectBorrowRequestId: undefined });
  const b1 = h.get('projectBorrowRequests', 'B1'); h.mutate('projectBorrowRequests', 'B2', { ...b1, id: 'B2', requestNo: 'B2' }); h.refresh();
  const before = JSON.stringify([...h.records]); await assert.rejects(h.operations.receiveDispatch(d.id), /ยอดจัดส่งเดียวกัน/);
  assert.equal(JSON.stringify([...h.records]), before);
});
test('Borrow stock ownership mismatch blocks return and cancellation', async () => {
  for (const action of ['return', 'cancel']) {
    const h = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 70), [path('stockItems', 'D1')]: stock('D1', 'J2', 30, { status: 'Borrowed', projectBorrowRequestNo: 'B2' }), [path('projectBorrowRequests', 'B1')]: borrow(), [path('cancellationRequests', 'C1')]: cancellation('projectBorrow', 'B1') });
    const before = JSON.stringify([...h.records]);
    await assert.rejects(action === 'return' ? h.operations.completeProjectBorrowReturn('B1') : h.operations.approveCancellationRequest('C1'), /ไม่ตรงกับคำขอยืม/);
    assert.equal(JSON.stringify([...h.records]), before);
  }
});
test('Short borrower stock blocks cancellation without closing the request', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 70), [path('stockItems', 'D1')]: stock('D1', 'J2', 10, { status: 'Borrowed' }), [path('projectBorrowRequests', 'B1')]: borrow(), [path('cancellationRequests', 'C1')]: cancellation('projectBorrow', 'B1') });
  const before = JSON.stringify([...h.records]); await assert.rejects(h.operations.approveCancellationRequest('C1'), /ไม่ครบ/);
  assert.equal(JSON.stringify([...h.records]), before);
});
test('Duplicate receipt cancellation checks aggregate availability before deducting', async () => {
  const h = harness({ [path('receivingRequests', 'R1')]: receiving('R1', [20, 30]) });
  await h.operations.approveReceivingRequest('R1'); h.refresh(); const item = h.all('stockItems')[0];
  h.mutate('stockItems', item.stockItemId, { ...item, qty: 40, amount: 400 });
  h.mutate('cancellationRequests', 'C1', cancellation('receiving', 'R1')); h.refresh();
  const before = JSON.stringify([...h.records]); await assert.rejects(h.operations.approveCancellationRequest('C1'), /ไม่พอ/);
  assert.equal(JSON.stringify([...h.records]), before);
});
test('Concurrent borrower return and cancellation restore stock at most once', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 70), [path('stockItems', 'D1')]: stock('D1', 'J2', 30, { status: 'Borrowed' }), [path('projectBorrowRequests', 'B1')]: borrow(), [path('cancellationRequests', 'C1')]: cancellation('projectBorrow', 'B1') });
  const results = await Promise.allSettled([h.operations.completeProjectBorrowReturn('B1'), h.operations.approveCancellationRequest('C1')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(h.get('stockItems', 'S1').qty, 100); assert.equal(h.get('stockItems', 'S1').amount, 1000);
});
test('Concurrent dispatch receipt and cancellation conserve total stock', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createDispatch(dispatchInput()); h.refresh(); const d = h.all('dispatchRecords')[0];
  await Promise.allSettled([h.operations.receiveDispatch(d.id), h.operations.cancelDispatch(d.id)]);
  assert.equal(h.all('stockItems').reduce((sum, item) => sum + item.qty, 0), 100);
  assert.equal(h.all('stockItems').reduce((sum, item) => sum + item.amount, 0), 1000);
});
test('Withdrawal return restores server quantities rather than stale dialog quantities', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createWithdraw(withdrawInput()); h.refresh(); const w = h.all('withdrawRecords')[0];
  h.mutate('withdrawRecords', w.id, { ...w, items: w.items.map(item => ({ ...item, qty: 5, amount: 50 })) });
  h.mutate('stockItems', 'S1', stock('S1', 'J1', 95));
  await h.operations.returnWithdraw(w.id); assert.equal(h.get('stockItems', 'S1').qty, 100);
});
test('Withdrawal return restores only quantities that have not previously returned', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await h.operations.createWithdraw(withdrawInput()); h.refresh(); const w = h.all('withdrawRecords')[0];
  h.mutate('withdrawRecords', w.id, { ...w, items: w.items.map(item => ({ ...item, returnedQty: 10 })) });
  h.mutate('stockItems', 'S1', stock('S1', 'J1', 80));
  await h.operations.returnWithdraw(w.id); assert.equal(h.get('stockItems', 'S1').qty, 100); assert.equal(h.get('stockItems', 'S1').amount, 1000);
});
test('Stale return request does not resurrect a cancelled borrower record', async () => {
  const h = harness({ [path('projectBorrowRequests', 'B1')]: borrow('B1', { status: 'Borrowed' }) });
  h.mutate('projectBorrowRequests', 'B1', borrow('B1', { status: 'Cancelled' }));
  await assert.rejects(h.operations.requestProjectBorrowReturn('B1'), /รีเฟรช/); assert.equal(h.get('projectBorrowRequests', 'B1').status, 'Cancelled');
});
test('Partial multiline PO receipts preserve completed lines and aggregate their reversal', async () => {
  const h = harness({ [path('receivingRequests', 'R1')]: receiving('R1', [20, 30]) });
  await h.operations.approveReceivingRequest('R1', [{ itemIndex: 0, receivedQty: 20 }, { itemIndex: 1, receivedQty: 0 }]); h.refresh();
  assert.equal(h.context.receivingRequestList[0].items.length, 1);
  await h.operations.approveReceivingRequest('R1', [{ itemIndex: 0, receivedQty: 30 }]); h.refresh();
  assert.equal(h.all('stockItems')[0].qty, 50); assert.equal(h.get('receivingRequests', 'R1').items[0].receivedQty, 20);
  h.mutate('cancellationRequests', 'C1', cancellation('receiving', 'R1')); h.refresh(); await h.operations.approveCancellationRequest('C1');
  assert.equal(h.all('stockItems').length, 0);
});
test('New stock receiving cannot replace an existing document', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') }); const before = JSON.stringify([...h.records]);
  await assert.rejects(h.operations.receiveNewItem(stock('S1', 'J1', 5)), /ทับยอดเดิม/);
  assert.equal(JSON.stringify([...h.records]), before);
});
test('Incoming stock cannot make existing repair stock ready for use', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1', 'J1', 100, { status: 'Repair' }), [path('receivingRequests', 'R1')]: receiving() });
  const before = JSON.stringify([...h.records]); await assert.rejects(h.operations.approveReceivingRequest('R1'));
  assert.equal(JSON.stringify([...h.records]), before);
});
test('Fractional withdrawal and empty or fractional project borrow quantities are rejected', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  await assert.rejects(h.operations.createWithdraw(withdrawInput('issue', 0.5)), /whole numbers/);
  for (const qty of [-1, 0, 0.5, NaN]) await assert.rejects(h.operations.createProjectBorrowRequest({ borrowerProjectNo: 'J2', lenderProjectNo: 'J1', items: [{ stockItemId: 'S1', qty }], purpose: 'Test' }), /จำนวนเต็ม/);
  assert.equal(h.get('stockItems', 'S1').qty, 100);
});
test('Same-time project borrow requests have distinct document IDs', async () => {
  const h = harness({ [path('stockItems', 'S1')]: stock('S1') });
  const input = { borrowerProjectNo: 'J2', lenderProjectNo: 'J1', items: [{ stockItemId: 'S1', qty: 30 }], purpose: 'Test' };
  await h.operations.createProjectBorrowRequest(input); h.refresh(); await h.operations.createProjectBorrowRequest(input);
  assert.equal(h.all('projectBorrowRequests').length, 2); assert.equal(h.get('stockItems', 'S1').qty, 100);
});
test('Stale rejection cannot replace a dispatched project borrow status', async () => {
  const h = harness({ [path('projectBorrowRequests', 'B1')]: borrow('B1', { status: 'Pending Approval' }) });
  h.mutate('projectBorrowRequests', 'B1', borrow('B1', { status: 'In Transit' }));
  await assert.rejects(h.operations.rejectProjectBorrowRequest('B1'), /status/); assert.equal(h.get('projectBorrowRequests', 'B1').status, 'In Transit');
});
test('Stale rejection cannot replace a completed cancellation status', async () => {
  const h = harness({ [path('cancellationRequests', 'C1')]: cancellation('projectBorrow', 'B1') });
  h.mutate('cancellationRequests', 'C1', { ...cancellation('projectBorrow', 'B1'), status: 'Approved' });
  await assert.rejects(h.operations.rejectCancellationRequest('C1'), /status/); assert.equal(h.get('cancellationRequests', 'C1').status, 'Approved');
});
