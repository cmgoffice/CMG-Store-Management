import { Check, ClipboardX, PackageMinus, Plus, Search, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useDialog } from '../context/DialogContext';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import type { CancellationRequest, StockItem } from '../types/models';
import { getStockItemId } from '../utils/stockItem';
import styles from './CancellationPage.module.css';

function normalizeProjectNo(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = text.match(/\bJ[-\s]?0*([0-9]+[a-z0-9]*)\b/i);
  return match ? `J${match[1].toUpperCase()}` : text.toUpperCase();
}

function projectNoFromStock(item: StockItem) {
  const candidates = [item.cmgProjectCode, item.purchasedForProject, item.location, item.projectId];
  for (const value of candidates) {
    const text = String(value || '').trim();
    const match = text.match(/(?:Project|Store|In Transit to Project|In Transit to Store)\s+(.+)/i);
    const projectNo = normalizeProjectNo(match?.[1] || text);
    if (projectNo) return projectNo;
  }
  return '';
}

function dateText(value?: string) {
  return value ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-';
}

function requestStatus(request: CancellationRequest) {
  if (request.status === 'Approved') return 'ตัดยอดแล้ว';
  if (request.status === 'Rejected') return 'ไม่อนุมัติ';
  return request.approvalStep === 0 ? 'รออนุมัติขั้นที่ 1' : 'รออนุมัติขั้นที่ 2';
}

export function CancellationPage() {
  const {
    stockItems,
    activeProjectNo,
    cancellationRequests,
    createCancellationRequest,
    approveCancellationRequest,
    rejectCancellationRequest,
  } = useInventory();
  const { hasAnyRole } = useRole();
  const { showAlert, showConfirm } = useDialog();
  const [query, setQuery] = useState('');
  const [itemQuery, setItemQuery] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
  const [cancelQty, setCancelQty] = useState('');
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'history'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const canReview = hasAnyRole(['MasterAdmin', 'Store Center', 'Admin Site', 'Store Site', 'Keeper']);
  const normalizedActiveProjectNo = normalizeProjectNo(activeProjectNo);

  const pendingKeys = useMemo(
    () => new Set(cancellationRequests.filter((request) => request.entityType === 'projectStock' && request.status === 'Pending Approval').map((request) => request.entityId)),
    [cancellationRequests]
  );

  const projectStock = useMemo(() => {
    return stockItems
      .filter((item) => {
        const isProjectStock = projectNoFromStock(item) === normalizedActiveProjectNo;
        const isInStore = item.qty > 0 && item.status !== 'In Transit' && item.status !== 'Pending Dispatch';
        return isProjectStock && isInStore;
      })
      .sort((a, b) => a.itemDescription.localeCompare(b.itemDescription));
  }, [normalizedActiveProjectNo, stockItems]);

  const pickerItems = useMemo(() => {
    const search = itemQuery.trim().toLowerCase();
    if (search.length < 2) return [];
    return projectStock.filter((item) => [item.itemNo, item.itemDescription, item.receiveNo, item.materialNo, item.location].join(' ').toLowerCase().includes(search)).slice(0, 50);
  }, [itemQuery, projectStock]);

  const history = useMemo(() => cancellationRequests
    .filter((request) => request.entityType === 'projectStock')
    .filter((request) => request.projectNos.some((projectNo) => normalizeProjectNo(projectNo) === normalizedActiveProjectNo))
    .filter((request) => filter === 'all' || (filter === 'pending' ? request.status === 'Pending Approval' : request.status !== 'Pending Approval'))
    .filter((request) => {
      const search = query.trim().toLowerCase();
      return !search || [request.referenceNo, request.projectLabel, request.reason, request.requestedByName].join(' ').toLowerCase().includes(search);
    }), [cancellationRequests, filter, normalizedActiveProjectNo, query]);

  const openRequest = (item: StockItem) => {
    setSelectedItem(item);
    setCancelQty('');
    setReason('');
  };

  const submitRequest = async () => {
    if (!selectedItem) return;
    try {
      setIsSubmitting(true);
      await createCancellationRequest({ entityType: 'projectStock', entityId: getStockItemId(selectedItem), qty: Number(cancelQty), reason });
      setSelectedItem(null);
      setIsCreateOpen(false);
      setItemQuery('');
      await showAlert('ส่งคำขอตัดยอดแล้ว รออนุมัติครบ 2 ขั้น', { variant: 'success' });
    } catch (error) {
      await showAlert(error instanceof Error ? error.message : 'ไม่สามารถส่งคำขอตัดยอดได้', { variant: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const runApproval = async (request: CancellationRequest, action: 'approve' | 'reject') => {
    if (!(await showConfirm(action === 'approve' ? `ยืนยันตัดยอด ${request.cancelQty?.toLocaleString() || 0} ชิ้น ขั้นที่ ${request.approvalStep + 1} หรือไม่` : `ยืนยันปฏิเสธคำขอ ${request.cancellationNo} หรือไม่`, { variant: 'warning', confirmLabel: action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ' }))) return;
    try {
      setWorkingId(request.id);
      if (action === 'approve') await approveCancellationRequest(request.id);
      else await rejectCancellationRequest(request.id);
      await showAlert(action === 'approve' && request.approvalStep === 1 ? 'อนุมัติครบ 2 ขั้นและตัดยอดแล้ว' : action === 'approve' ? 'อนุมัติขั้นที่ 1 แล้ว' : 'ปฏิเสธคำขอแล้ว', { variant: 'success' });
    } catch (error) {
      await showAlert(error instanceof Error ? error.message : 'ไม่สามารถดำเนินการได้', { variant: 'error' });
    } finally {
      setWorkingId(null);
    }
  };

  const availableQty = projectStock.reduce((sum, item) => sum + item.qty, 0);
  const pendingCount = history.filter((request) => request.status === 'Pending Approval').length;
  const completedCount = history.filter((request) => request.status === 'Approved').length;

  return (
    <div className={styles.page}>
      <div className={styles.toolbarTop}>
        <button type="button" className={styles.createButton} onClick={() => { setIsCreateOpen(true); setSelectedItem(null); setCancelQty(''); setReason(''); setItemQuery(''); }} disabled={!activeProjectNo}><Plus size={16} /> สร้างรายการยกเลิก</button>
      </div>
      <div className={styles.contextBar}><PackageMinus size={17} /><span>คลังโครงการ: <strong>{activeProjectNo || '-'}</strong></span><span className={styles.contextHint}>ตัดยอดจริงหลังอนุมัติครบ 2 ขั้นเท่านั้น</span></div>
      <div className={styles.workflowBanner}><ShieldCheck size={20} /><div><strong>Approval Flow 2 Step</strong><span>ผู้ขอระบุจำนวนและเหตุผล → อนุมัติขั้นที่ 1 → ผู้อนุมัติคนละคนยืนยันขั้นที่ 2 → ระบบตัดยอดและเก็บประวัติ</span></div></div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}><PackageMinus size={20} /><div><span>สินค้าในคลัง</span><strong>{projectStock.length}</strong></div></div>
        <div className={styles.summaryCard}><span className={styles.summaryIconText}>QTY</span><div><span>ยอดคงเหลือรวม</span><strong>{availableQty.toLocaleString()}</strong></div></div>
        <div className={styles.summaryCard}><ShieldCheck size={20} /><div><span>รออนุมัติ / ตัดยอดแล้ว</span><strong>{pendingCount} / {completedCount}</strong></div></div>
      </div>

      <div className={styles.toolbar}><span className={styles.pageHint}>คลังนี้มีสินค้า {projectStock.length.toLocaleString()} รายการ · กด “สร้างรายการยกเลิก” เพื่อค้นหา Item</span><div className={styles.searchBox}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาประวัติการยกเลิก" /></div></div>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}><div><h2>ประวัติการยกเลิก / คำขออนุมัติ</h2><p>รายการนี้เก็บเหตุผล จำนวนก่อนตัดยอด และผู้อนุมัติไว้ตรวจสอบย้อนหลัง</p></div><div className={styles.tabs}><button className={filter === 'all' ? styles.tabActive : ''} onClick={() => setFilter('all')}>ทั้งหมด</button><button className={filter === 'pending' ? styles.tabActive : ''} onClick={() => setFilter('pending')}>รออนุมัติ</button><button className={filter === 'history' ? styles.tabActive : ''} onClick={() => setFilter('history')}>ประวัติ</button></div></div>
        <div className={styles.tableWrap}><table><thead><tr><th>เลขที่คำขอ</th><th>สินค้า</th><th className={styles.numeric}>จำนวนตัด</th><th>เหตุผล</th><th>สถานะ</th><th>ผู้ขอ / ดำเนินการ</th></tr></thead><tbody>
          {history.map((request) => <tr key={request.id}><td><strong>{request.cancellationNo}</strong><small>{dateText(request.requestedAt)}</small></td><td><strong>{request.referenceNo}</strong><small>{request.projectLabel || '-'}</small></td><td className={styles.numeric}><strong>{(request.cancelQty || 0).toLocaleString()}</strong></td><td className={styles.reasonCell}>{request.reason}</td><td><span className={`${styles.status} ${request.status === 'Approved' ? styles.statusSuccess : request.status === 'Rejected' ? styles.statusDanger : styles.statusPending}`}>{requestStatus(request)}</span>{request.status === 'Pending Approval' ? <small>ขั้นที่ {request.approvalStep + 1}/2</small> : null}</td><td><span>{request.requestedByName || '-'}</span>{canReview && request.status === 'Pending Approval' ? <div className={styles.actions}><button type="button" className={styles.approveButton} disabled={workingId === request.id} onClick={() => void runApproval(request, 'approve')}><Check size={13} /> อนุมัติขั้น {request.approvalStep + 1}</button><button type="button" className={styles.rejectButton} disabled={workingId === request.id} onClick={() => void runApproval(request, 'reject')}><X size={13} /> ปฏิเสธ</button></div> : null}</td></tr>)}
          {history.length === 0 ? <tr><td colSpan={6} className={styles.empty}>ยังไม่มีประวัติการยกเลิก</td></tr> : null}
        </tbody></table></div>
      </section>

      {isCreateOpen ? <div className={styles.modalOverlay}><section className={`${styles.modal} ${styles.modalLarge}`} role="dialog" aria-modal="true"><div className={styles.modalHeader}><div><span className={styles.entityTag}>สร้างรายการยกเลิก</span><h2>ค้นหา Item ในคลังโครงการ</h2><p>พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา จากทั้งหมด {projectStock.length.toLocaleString()} รายการ</p></div><button type="button" className={styles.closeButton} onClick={() => { setIsCreateOpen(false); setSelectedItem(null); }} aria-label="ปิด"><X size={18} /></button></div><div className={styles.modalBody}><div className={styles.pickerLayout}><div className={styles.pickerPane}><label className={styles.searchLabel}>ค้นหา Item / รายละเอียด / Receive No.<div className={styles.searchBox}><Search size={17} /><input autoFocus value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} placeholder="เช่น ML-BN-0633 หรือคำอธิบายสินค้า" /></div></label>{itemQuery.trim().length < 2 ? <div className={styles.pickerEmpty}>เริ่มพิมพ์เพื่อค้นหารายการ</div> : pickerItems.length === 0 ? <div className={styles.pickerEmpty}>ไม่พบ Item ที่ค้นหา</div> : <div className={styles.pickerList}>{pickerItems.map((item) => { const id = getStockItemId(item); const hasPending = pendingKeys.has(id); return <button type="button" key={id} className={`${styles.pickerItem} ${selectedItem && getStockItemId(selectedItem) === id ? styles.pickerItemActive : ''}`} disabled={hasPending} onClick={() => openRequest(item)}><span><strong>{item.itemNo || item.materialNo || '-'}</strong><small>{item.itemDescription || '-'}</small><small>{item.receiveNo} · {item.location || '-'}</small></span><b>{hasPending ? 'รออนุมัติ' : `${item.qty.toLocaleString()} ${item.unit || 'ชิ้น'}`}</b></button>})}</div>}{itemQuery.trim().length >= 2 && pickerItems.length >= 50 ? <small className={styles.resultLimit}>แสดง 50 รายการแรก กรุณาระบุคำค้นหาให้ละเอียดขึ้น</small> : null}</div><div className={styles.selectionPane}>{selectedItem ? <><div className={styles.selectedHeader}><span className={styles.entityTag}>เลือกแล้ว</span><button type="button" onClick={() => { setSelectedItem(null); setCancelQty(''); setReason(''); }}>เปลี่ยน Item</button></div><h3>{selectedItem.itemNo || selectedItem.materialNo || '-'}</h3><p>{selectedItem.itemDescription}</p><small>{selectedItem.receiveNo} · คงเหลือ {selectedItem.qty.toLocaleString()} {selectedItem.unit || 'ชิ้น'}</small><label className={styles.reasonLabel}>จำนวนที่ต้องการตัดยอด <span>*</span><input className={styles.qtyInput} type="number" min="1" max={selectedItem.qty} step="1" value={cancelQty} onChange={(event) => setCancelQty(event.target.value)} placeholder={`สูงสุด ${selectedItem.qty.toLocaleString()}`} /></label><label className={styles.reasonLabel}>เหตุผลการยกเลิก <span>*</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="เช่น สินค้าชำรุด, สูญหาย หรือปรับยอดตามผลตรวจนับ" rows={5} maxLength={500} /><small>{reason.length}/500</small></label></> : <div className={styles.noSelection}><PackageMinus size={30} /><strong>ยังไม่ได้เลือก Item</strong><span>ค้นหาจากด้านซ้าย แล้วกดเลือกรายการที่ต้องการตัดยอด</span></div>}</div></div><div className={styles.confirmHint}>รายการจะแสดงในประวัติทันทีหลังส่งคำขอ และจะตัดยอดจริงเมื่ออนุมัติครบ 2 ขั้น</div></div><div className={styles.modalFooter}><button type="button" className={styles.secondaryButton} onClick={() => { setIsCreateOpen(false); setSelectedItem(null); }} disabled={isSubmitting}>ปิด</button><button type="button" className={styles.primaryButton} onClick={() => void submitRequest()} disabled={!selectedItem || isSubmitting || !cancelQty || Number(cancelQty) <= 0 || Number(cancelQty) > (selectedItem?.qty || 0) || reason.trim().length < 5}><ClipboardX size={16} />{isSubmitting ? 'กำลังส่งคำขอ...' : 'ส่งคำขอตัดยอด'}</button></div></section></div> : null}
    </div>
  );
}
