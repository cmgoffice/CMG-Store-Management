import { ArrowLeftRight, Check, ClipboardList, Eye, Package, Plus, RotateCcw, Search, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { SearchField } from '../components/SearchField';
import { inferItemTypeCode, matchesProjectBorrowItemType } from '../constants/itemTypes';
import { useDialog } from '../context/DialogContext';
import { useInventory } from '../context/InventoryContext';
import type { ProjectBorrowRequest, StockItem } from '../types/models';
import { getStockItemId, isStockItemAvailableForMovement } from '../utils/stockItem';
import '../styles/tables.css';
import styles from './ProjectBorrowPage.module.css';

function projectNo(value: string) {
  const match = value.trim().match(/\bJ[-\s]?0*([0-9]+[a-z0-9]*)\b/i);
  return match ? `J${match[1].toUpperCase()}` : value.trim().toUpperCase();
}

function itemProjectNo(item: StockItem) {
  const value = item.cmgProjectCode || item.purchasedForProject || item.location || item.projectId || '';
  return projectNo(value.replace(/^Store\s+|^Project\s+|^In Transit to\s+(Store|Project)\s+/i, ''));
}

function dateText(value: string) {
  return value ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(new Date(value)) : '-';
}

function amountText(value: number) {
  return `${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
}

function statusLabel(status: ProjectBorrowRequest['status']) {
  return {
    'Pending Approval': 'รออนุมัติ',
    'Pending Dispatch': 'อนุมัติแล้ว / รอจัดส่ง',
    'In Transit': 'กำลังย้ายโครงการ',
    Borrowed: 'ยืมมา',
    Rejected: 'ไม่อนุมัติ',
    'Return Requested': 'แจ้งคืนแล้ว',
    Returned: 'คืนแล้ว',
    Cancelled: 'ยกเลิกแล้ว',
  }[status];
}

function statusHint(status: ProjectBorrowRequest['status']) {
  return {
    'Pending Approval': 'รอเจ้าของ EQM ตรวจสอบ',
    'Pending Dispatch': 'อนุมัติแล้ว รอ Store จัดส่ง',
    'In Transit': 'กำลังจัดส่งไปโครงการผู้ยืม',
    Borrowed: 'รับเข้าโครงการผู้ยืมแล้ว',
    Rejected: 'เจ้าของ EQM ไม่อนุมัติ',
    'Return Requested': 'รอเจ้าของ EQM ยืนยันรับคืน',
    Returned: 'รับคืนเข้าคลังต้นทางแล้ว',
    Cancelled: 'ยกเลิกคำขอแล้ว',
  }[status];
}

function isWaitingToBorrow(status: ProjectBorrowRequest['status']) {
  return status === 'Pending Approval' || status === 'Pending Dispatch' || status === 'In Transit';
}

function receivedBorrowQty(request: ProjectBorrowRequest, qty: number, receivedQty?: number) {
  if (request.status === 'Borrowed' || request.status === 'Return Requested' || request.status === 'Returned') {
    return qty;
  }

  return Math.min(qty, receivedQty ?? 0);
}

function pendingBorrowQty(request: ProjectBorrowRequest, qty: number, receivedQty?: number) {
  if (!isWaitingToBorrow(request.status)) {
    return 0;
  }

  return Math.max(0, qty - receivedBorrowQty(request, qty, receivedQty));
}

function isBorrowReservationPending(status: ProjectBorrowRequest['status']) {
  return status === 'Pending Approval' || status === 'Pending Dispatch';
}

function itemLookupKey(value: string | undefined) {
  return value?.trim().toLowerCase() || '';
}

function statusClass(status: ProjectBorrowRequest['status']) {
  return status === 'Borrowed' ? styles.statusSuccess : status === 'Rejected' || status === 'Cancelled' ? styles.statusDanger : status === 'Returned' ? styles.statusDone : styles.statusPending;
}

export function ProjectBorrowPage() {
  const {
    allProjects,
    allStockItems,
    activeProjectNo,
    projectBorrowRequests,
    createProjectBorrowRequest,
    approveProjectBorrowRequest,
    rejectProjectBorrowRequest,
    requestProjectBorrowReturn,
    completeProjectBorrowReturn,
  } = useInventory();
  const { showAlert, showConfirm } = useDialog();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lenderProjectNo, setLenderProjectNo] = useState('');
  const [purpose, setPurpose] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [itemQuery, setItemQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState<Record<string, string>>({});
  const [requestFilter, setRequestFilter] = useState<'all' | 'borrow' | 'lend'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ProjectBorrowRequest | null>(null);

  const activeProject = allProjects.find((project) => project.projectNo === activeProjectNo);
  const borrowerProjectNo = activeProject?.projectNo || activeProjectNo;
  const lenderProjects = allProjects.filter((project) => project.status !== 'Disactive' && project.projectNo !== borrowerProjectNo);

  const reservedQtyByItemKey = useMemo(() => {
    const reservedQty = new Map<string, number>();

      projectBorrowRequests
      .filter((request) => isBorrowReservationPending(request.status))
      .forEach((request) => {
        request.items.forEach((item) => {
          const keys = [...new Set([itemLookupKey(item.sourceStockItemId), itemLookupKey(item.receiveNo)].filter(Boolean))];
          keys.forEach((key) => {
            reservedQty.set(key, (reservedQty.get(key) ?? 0) + item.qty);
          });
        });
      });

    return reservedQty;
  }, [projectBorrowRequests]);

  const getAvailableBorrowQty = useCallback((item: StockItem) => {
    const reservedQty = reservedQtyByItemKey.get(itemLookupKey(getStockItemId(item))) ??
      reservedQtyByItemKey.get(itemLookupKey(item.receiveNo)) ??
      0;
    return Math.max(0, item.qty - reservedQty);
  }, [reservedQtyByItemKey]);

  const availableEqm = useMemo(() => {
    const query = itemQuery.trim().toLowerCase();
    return allStockItems.filter((item) => {
      if (!lenderProjectNo || itemProjectNo(item) !== projectNo(lenderProjectNo) || !isStockItemAvailableForMovement(item) || !matchesProjectBorrowItemType(item)) return false;
      if (getAvailableBorrowQty(item) <= 0) return false;
      return !query || [item.itemNo, item.itemDescription, item.materialNo, item.receiveNo, item.location].join(' ').toLowerCase().includes(query);
    });
  }, [allStockItems, getAvailableBorrowQty, itemQuery, lenderProjectNo]);

  const visibleRequests = useMemo(() => {
    return projectBorrowRequests.filter((request) => {
      const isBorrower = request.borrowerProjectNo === projectNo(borrowerProjectNo);
      const isLender = request.lenderProjectNo === projectNo(borrowerProjectNo);
      return (requestFilter === 'all' && (isBorrower || isLender)) || (requestFilter === 'borrow' && isBorrower) || (requestFilter === 'lend' && isLender);
    });
  }, [borrowerProjectNo, projectBorrowRequests, requestFilter]);

  const pendingCount = projectBorrowRequests.filter((request) => request.status === 'Pending Approval' && request.lenderProjectNo === projectNo(borrowerProjectNo)).length;
  const activeBorrowCount = projectBorrowRequests.filter((request) => request.status === 'Borrowed' && request.borrowerProjectNo === projectNo(borrowerProjectNo)).length;
  const returnCount = projectBorrowRequests.filter((request) => request.status === 'Return Requested' && request.lenderProjectNo === projectNo(borrowerProjectNo)).length;

  const selectedPendingBorrowQty = selectedRequest
    ? selectedRequest.items.reduce(
        (sum, item) => sum + pendingBorrowQty(selectedRequest, item.qty, item.receivedQty),
        0,
      )
    : 0;

  const resetModal = () => {
    setLenderProjectNo(lenderProjects[0]?.projectNo || '');
    setPurpose('');
    setDueDate('');
    setItemQuery('');
    setSelectedItems({});
  };

  const toggleItem = (item: StockItem) => {
    const id = getStockItemId(item);
    setSelectedItems((current) => {
      if (current[id] !== undefined) {
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: '1' };
    });
  };

  const submitRequest = async () => {
    const items = Object.entries(selectedItems).map(([stockItemId, qty]) => ({ stockItemId, qty: Number(qty) }));
    try {
      setIsSubmitting(true);
      await createProjectBorrowRequest({ borrowerProjectNo, lenderProjectNo, items, purpose, dueDate });
      setIsModalOpen(false);
      resetModal();
      await showAlert('สร้างคำขอยืมแล้ว รอเจ้าของ EQM ตรวจสอบอนุมัติ', { variant: 'success' });
    } catch (error) {
      await showAlert(error instanceof Error ? error.message : 'ไม่สามารถสร้างคำขอยืมได้', { variant: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const runAction = async (action: () => Promise<void>, success: string) => {
    try {
      await action();
      await showAlert(success, { variant: 'success' });
    } catch (error) {
      await showAlert(error instanceof Error ? error.message : 'ไม่สามารถดำเนินการได้', { variant: 'error' });
    }
  };

  const handleApprove = async (request: ProjectBorrowRequest) => {
    if (await showConfirm(`ยืนยันอนุมัติคำขอ ${request.requestNo} หรือไม่`, { variant: 'warning', confirmLabel: 'อนุมัติ' })) {
      await runAction(() => approveProjectBorrowRequest(request.id), 'อนุมัติคำขอแล้ว รายการพร้อมให้ Store ดำเนินการจัดส่งตามปกติ');
    }
  };

  const handleReject = async (request: ProjectBorrowRequest) => {
    if (await showConfirm(`ยืนยันไม่อนุมัติ ${request.requestNo} หรือไม่`, { variant: 'warning', confirmLabel: 'ไม่อนุมัติ' })) {
      await runAction(() => rejectProjectBorrowRequest(request.id), 'ปฏิเสธคำขอยืมแล้ว');
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.primaryButton} onClick={() => { resetModal(); setIsModalOpen(true); }} disabled={!borrowerProjectNo || lenderProjects.length === 0}><Plus size={17} /> ขอรีเควสยืม</button>
      </div>

      <div className={styles.contextBar}><ArrowLeftRight size={16} /><span>โครงการที่กำลังใช้งาน: <strong>{borrowerProjectNo || '-'}</strong> {activeProject?.projectName ? `— ${activeProject.projectName}` : ''}</span><span className={styles.contextHint}>สิทธิ์อนุมัติจะตรวจจากโครงการผู้ให้ยืม</span></div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}><ClipboardList size={20} /><div><span>รออนุมัติฝั่งให้ยืม</span><strong>{pendingCount}</strong></div></div>
        <div className={styles.summaryCard}><Package size={20} /><div><span>กำลังยืมอยู่</span><strong>{activeBorrowCount}</strong></div></div>
        <div className={styles.summaryCard}><RotateCcw size={20} /><div><span>รอรับคืน</span><strong>{returnCount}</strong></div></div>
      </div>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}><div><h2>รายการยืม-คืน</h2><p>ฝั่งผู้ยืมเห็น “ยืม” ฝั่งเจ้าของเห็น “ให้ยืม” ตามโครงการที่เลือก</p></div><div className={styles.tabs}><button className={requestFilter === 'all' ? styles.tabActive : ''} onClick={() => setRequestFilter('all')}>ทั้งหมด</button><button className={requestFilter === 'borrow' ? styles.tabActive : ''} onClick={() => setRequestFilter('borrow')}>รายการที่ยืม</button><button className={requestFilter === 'lend' ? styles.tabActive : ''} onClick={() => setRequestFilter('lend')}>รายการที่ให้ยืม</button></div></div>
        <div className="tableScroll">
          <table className={`table compact ${styles.table}`}>
            <thead><tr><th>เลขที่รีเควส</th><th>ยืม / ให้ยืม</th><th>โครงการคู่รายการ</th><th>รายการ</th><th>สถานะ</th><th>วันที่</th><th>ดำเนินการ</th></tr></thead>
            <tbody>
              {visibleRequests.map((request) => {
                const isBorrower = request.borrowerProjectNo === projectNo(borrowerProjectNo);
                const isLender = request.lenderProjectNo === projectNo(borrowerProjectNo);
                const requiresAction = isLender && (request.status === 'Pending Approval' || request.status === 'Return Requested');
                return <tr
                  key={request.id}
                  className={`${styles.clickableRow} ${requiresAction ? styles.actionRequiredRow : ''}`}
                  onClick={() => setSelectedRequest(request)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedRequest(request);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`ดูรายละเอียด ${request.requestNo}`}
                >
                  <td><button type="button" className={styles.requestLink} onClick={(event) => { event.stopPropagation(); setSelectedRequest(request); }}><strong className={styles.requestNo}>{request.requestNo}</strong><small>{request.requestedByName}</small></button></td>
                  <td><span className={isBorrower ? styles.roleBorrow : styles.roleLend}>{isBorrower ? 'ยืมมา' : 'ให้ยืม'}</span></td>
                  <td><strong>{isBorrower ? request.lenderProjectNo : request.borrowerProjectNo}</strong><small>{isBorrower ? request.lenderProjectName : request.borrowerProjectName}</small></td>
                  <td><button type="button" className={styles.itemSummaryButton} onClick={(event) => { event.stopPropagation(); setSelectedRequest(request); }}><strong>{request.items.length} รายการ / {request.totalQty.toLocaleString()} ชิ้น</strong><small>{request.items.slice(0, 2).map((item) => item.itemNo).join(', ')}{request.items.length > 2 ? ' ...' : ''}</small><span className={styles.detailHint}><Eye size={12} /> ดูรายละเอียด</span></button></td>
                  <td><span className={`${styles.status} ${statusClass(request.status)}`}>{statusLabel(request.status)}</span><small>{statusHint(request.status)}{request.dispatchNo ? ` · Dispatch ${request.dispatchNo}` : request.dueDate ? ` · กำหนดคืน ${dateText(request.dueDate)}` : ''}</small></td>
                  <td>{dateText(request.createdAt)}</td>
                  <td><div className={styles.actions} onClick={(event) => event.stopPropagation()}>
                    {isLender && request.status === 'Pending Approval' ? <><button className={styles.actionApprove} onClick={() => handleApprove(request)}><Check size={14} /> อนุมัติ</button><button className={styles.actionReject} onClick={() => handleReject(request)}><X size={14} /> ปฏิเสธ</button></> : null}
                    {isBorrower && request.status === 'Borrowed' ? <button className={styles.actionReturn} onClick={() => { void showConfirm('ยืนยันแจ้งคืนรายการนี้หรือไม่', { variant: 'warning', confirmLabel: 'แจ้งคืน' }).then(async (ok) => { if (ok) await runAction(() => requestProjectBorrowReturn(request.id), 'แจ้งคืนแล้ว รอฝั่งเจ้าของยืนยันรับคืน'); }); }}><RotateCcw size={14} /> แจ้งคืน</button> : null}
                    {isLender && request.status === 'Return Requested' ? <button className={styles.actionApprove} onClick={() => { void showConfirm('ยืนยันรับคืนและคืนสถานะ EQM เป็น Available หรือไม่', { variant: 'warning', confirmLabel: 'ยืนยันรับคืน' }).then(async (ok) => { if (ok) await runAction(() => completeProjectBorrowReturn(request.id), 'รับคืนแล้ว สถานะ EQM กลับเป็น Available'); }); }}><Check size={14} /> ยืนยันรับคืน</button> : null}
                  </div></td>
                </tr>;
              })}
              {visibleRequests.length === 0 ? <tr><td colSpan={7} className={styles.empty}>ยังไม่มีรายการในมุมมองของโครงการนี้</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {isModalOpen ? <div className={styles.modalOverlay}><section className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.modalHeader}><div><p className={styles.eyebrow}>NEW REQUEST</p><h2>ขอรีเควสยืม EQM</h2><p>เลือกโครงการเจ้าของ แล้วเลือก EQM, นั่งร้าน หรือแบบเหล็กที่พร้อมให้ยืม</p></div><button className={styles.closeButton} onClick={() => setIsModalOpen(false)} aria-label="ปิด"><X size={19} /></button></div>
        <div className={styles.modalBody}>
          <div className={styles.formGrid}><label>โครงการผู้ยืม<input value={`${borrowerProjectNo} — ${activeProject?.projectName || ''}`} readOnly /></label><label>โครงการที่จะยืม<select value={lenderProjectNo} onChange={(event) => { setLenderProjectNo(event.target.value); setSelectedItems({}); }}>{lenderProjects.map((project) => <option key={project.projectNo} value={project.projectNo}>{project.projectNo} — {project.projectName}</option>)}</select></label><label>วัตถุประสงค์<input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="เช่น ใช้งานชั่วคราวในพื้นที่..." /></label><label>กำหนดคืน (ถ้ามี)<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>
          <div className={styles.pickerHeader}><div><h3>รายการ EQM / นั่งร้าน / แบบเหล็ก ที่พร้อมให้ยืม</h3><span>เลือกแล้ว {Object.keys(selectedItems).length} รายการ · หักจำนวนที่มีคำขออนุมัติหรือรอจัดส่งแล้ว</span></div><SearchField value={itemQuery} onChange={setItemQuery} placeholder="ค้นหา EQM / รายละเอียด" /></div>
          <div className={styles.itemList}>
            <div className={styles.itemListHeader} role="row">
              <span>เลือก</span><span>รหัสรายการ</span><span>รายละเอียด</span><span>หมวด</span><span>เลขที่รับเข้า</span><span>พร้อมให้ยืม</span><span>จำนวนที่ขอยืม</span>
            </div>
            {availableEqm.map((item) => {
              const id = getStockItemId(item);
              const selected = selectedItems[id] !== undefined;
              const availableQty = getAvailableBorrowQty(item);
              const itemTypeCode = inferItemTypeCode(item);
              const itemTypeLabel = itemTypeCode === 'SCAFF' ? 'นั่งร้าน' : itemTypeCode === 'EQM' ? 'EQM' : 'แบบเหล็ก';
              return <div className={`${styles.itemRow} ${selected ? styles.itemSelected : ''}`} key={id} role="row">
                <input type="checkbox" checked={selected} onChange={() => toggleItem(item)} aria-label={`เลือกรายการ ${item.itemNo || item.materialNo}`} />
                <strong className={styles.itemNo}>{item.itemNo || item.materialNo}</strong>
                <span className={styles.itemDescription}>{item.itemDescription || '-'}</span>
                <span className={styles.itemCategory}>{itemTypeLabel}</span>
                <span className={styles.itemReceiveNo}>{item.receiveNo || '-'}</span>
                <span className={styles.available} aria-label={`พร้อมให้ยืม ${availableQty.toLocaleString()} ${item.unit || 'ชิ้น'}`}>{availableQty.toLocaleString()}</span>
                {selected ? <input className={styles.qtyInput} type="number" min="1" max={availableQty} value={selectedItems[id]} onChange={(event) => setSelectedItems((current) => ({ ...current, [id]: event.target.value }))} aria-label={`จำนวน ${item.itemNo}`} /> : <span className={styles.qtyPlaceholder}>-</span>}
              </div>;
            })}
            {availableEqm.length === 0 ? <div className={styles.empty}><Search size={18} />ไม่พบรายการที่พร้อมให้ยืม หรือจำนวนคงเหลือถูกจองไว้แล้ว</div> : null}
          </div>
        </div>
        <div className={styles.modalFooter}><button className={styles.secondaryButton} onClick={() => setIsModalOpen(false)}>ยกเลิก</button><button className={styles.primaryButton} disabled={isSubmitting || Object.keys(selectedItems).length === 0 || !purpose.trim()} onClick={submitRequest}>{isSubmitting ? 'กำลังบันทึก...' : 'สร้างคำขอ'}</button></div>
      </section></div> : null}

      {selectedRequest ? <div className={styles.modalOverlay} onClick={() => setSelectedRequest(null)}><section className={`${styles.modal} ${styles.detailModal}`} role="dialog" aria-modal="true" aria-labelledby="borrow-request-detail-title" onClick={(event) => event.stopPropagation()}>
        <div className={styles.modalHeader}><div><p className={styles.eyebrow}>REQUEST DETAIL</p><h2 id="borrow-request-detail-title">รายละเอียด {selectedRequest.requestNo}</h2><p>ตรวจสอบรายการทั้งหมดของคำขอยืม-คืนนี้</p></div><button className={styles.closeButton} onClick={() => setSelectedRequest(null)} aria-label="ปิดรายละเอียด"><X size={19} /></button></div>
        <div className={`${styles.modalBody} ${styles.detailBody}`}>
          <div className={styles.detailSummary}>
            <div className={styles.detailStat}><span>สถานะ</span><strong className={`${styles.status} ${statusClass(selectedRequest.status)}`}>{statusLabel(selectedRequest.status)}</strong></div>
            <div className={styles.detailStat}><span>จำนวนรายการ</span><strong>{selectedRequest.items.length.toLocaleString()} รายการ</strong></div>
            <div className={styles.detailStat}><span>จำนวนที่ขอยืม</span><strong>{selectedRequest.totalQty.toLocaleString()} ชิ้น</strong></div>
            <div className={styles.detailStat}><span>รอให้ยืม</span><strong>{selectedPendingBorrowQty.toLocaleString()} ชิ้น</strong></div>
            <div className={styles.detailStat}><span>วันที่สร้าง</span><strong>{dateText(selectedRequest.createdAt)}</strong></div>
          </div>

          <div className={styles.detailGrid}>
            <div className={styles.detailField}><span>โครงการผู้ยืม</span><strong>{selectedRequest.borrowerProjectNo}</strong><small>{selectedRequest.borrowerProjectName}</small></div>
            <div className={styles.detailField}><span>โครงการผู้ให้ยืม</span><strong>{selectedRequest.lenderProjectNo}</strong><small>{selectedRequest.lenderProjectName}</small></div>
            <div className={styles.detailField}><span>ผู้ขอรายการ</span><strong>{selectedRequest.requestedByName || '-'}</strong></div>
            <div className={styles.detailField}><span>กำหนดคืน</span><strong>{selectedRequest.dueDate ? dateText(selectedRequest.dueDate) : 'ไม่ได้ระบุ'}</strong></div>
            <div className={`${styles.detailField} ${styles.detailFieldWide}`}><span>วัตถุประสงค์</span><strong>{selectedRequest.purpose || '-'}</strong></div>
            {selectedRequest.dispatchNo ? <div className={styles.detailField}><span>เลขที่จัดส่ง</span><strong>{selectedRequest.dispatchNo}</strong></div> : null}
          </div>

          <div className={styles.detailSectionHeader}><div><h3>รายการในคำขอ</h3><span>แสดงจำนวนที่ขอยืม, รับแล้ว และจำนวนที่ยังรอให้ยืม</span></div></div>
          <div className={styles.detailItems}>
            {selectedRequest.items.map((item, index) => <div className={styles.detailItem} key={`${item.sourceStockItemId}-${index}`}>
              <div className={styles.detailItemIdentity}><strong>{item.itemNo || item.materialNo || '-'}</strong><span>{item.itemDescription || '-'}</span>{item.materialNo && item.materialNo !== item.itemNo ? <small>Material No. {item.materialNo}</small> : null}</div>
              <div className={styles.detailItemField}><span>เลขที่รับเข้า</span><strong>{item.receiveNo || '-'}</strong></div>
              <div className={styles.detailItemField}><span>จำนวนที่ขอยืม</span><strong>{item.qty.toLocaleString()} {item.unit || 'ชิ้น'}</strong></div>
              <div className={styles.detailItemField}><span>รอให้ยืม</span><strong className={pendingBorrowQty(selectedRequest, item.qty, item.receivedQty) > 0 ? styles.pendingQty : styles.receivedQty}>{pendingBorrowQty(selectedRequest, item.qty, item.receivedQty).toLocaleString()} {item.unit || 'ชิ้น'}</strong><small>รับแล้ว {receivedBorrowQty(selectedRequest, item.qty, item.receivedQty).toLocaleString()} {item.unit || 'ชิ้น'}</small></div>
              <div className={styles.detailItemField}><span>สถานที่/ผู้ขาย</span><strong>{item.sourceLocation || '-'}</strong><small>{item.vendorName || '-'}</small></div>
              <div className={`${styles.detailItemField} ${styles.detailAmount}`}><span>มูลค่า</span><strong>{amountText(item.amount || 0)}</strong></div>
            </div>)}
          </div>
        </div>
        <div className={styles.modalFooter}><button className={styles.secondaryButton} onClick={() => setSelectedRequest(null)}>ปิดรายละเอียด</button></div>
      </section></div> : null}
    </div>
  );
}
