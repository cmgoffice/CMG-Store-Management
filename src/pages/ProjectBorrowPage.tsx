import { ArrowLeftRight, Check, ClipboardList, Package, Plus, RotateCcw, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { matchesItemType } from '../constants/itemTypes';
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

function isEqm(item: StockItem) {
  return matchesItemType(item, 'EQM');
}

function dateText(value: string) {
  return value ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(new Date(value)) : '-';
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

  const activeProject = allProjects.find((project) => project.projectNo === activeProjectNo);
  const borrowerProjectNo = activeProject?.projectNo || activeProjectNo;
  const lenderProjects = allProjects.filter((project) => project.status !== 'Disactive' && project.projectNo !== borrowerProjectNo);

  const availableEqm = useMemo(() => {
    const query = itemQuery.trim().toLowerCase();
    return allStockItems.filter((item) => {
      if (!lenderProjectNo || itemProjectNo(item) !== projectNo(lenderProjectNo) || !isStockItemAvailableForMovement(item) || !isEqm(item)) return false;
      return !query || [item.itemNo, item.itemDescription, item.materialNo, item.receiveNo, item.location].join(' ').toLowerCase().includes(query);
    });
  }, [allStockItems, itemQuery, lenderProjectNo]);

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
      <PageHeader
        eyebrow="PROJECT ASSET FLOW"
        title="ยืม-คืนระหว่างโครงการ"
        description="ขอใช้ EQM จากโครงการอื่น ให้เจ้าของอนุมัติก่อน แล้ว Store ดำเนินการย้ายโครงการตามปกติ"
        actions={<button type="button" className={styles.primaryButton} onClick={() => { resetModal(); setIsModalOpen(true); }} disabled={!borrowerProjectNo || lenderProjects.length === 0}><Plus size={17} /> ขอรีเควสยืม</button>}
      />

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
                return <tr key={request.id}>
                  <td><strong className={styles.requestNo}>{request.requestNo}</strong><small>{request.requestedByName}</small></td>
                  <td><span className={isBorrower ? styles.roleBorrow : styles.roleLend}>{isBorrower ? 'ยืมมา' : 'ให้ยืม'}</span></td>
                  <td><strong>{isBorrower ? request.lenderProjectNo : request.borrowerProjectNo}</strong><small>{isBorrower ? request.lenderProjectName : request.borrowerProjectName}</small></td>
                  <td><strong>{request.items.length} รายการ / {request.totalQty.toLocaleString()} ชิ้น</strong><small>{request.items.slice(0, 2).map((item) => item.itemNo).join(', ')}{request.items.length > 2 ? ' ...' : ''}</small></td>
                  <td><span className={`${styles.status} ${statusClass(request.status)}`}>{statusLabel(request.status)}</span><small>{request.status === 'Pending Approval' ? 'รอเจ้าของ EQM ตรวจสอบ' : request.dispatchNo ? `Dispatch ${request.dispatchNo}` : request.dueDate ? `กำหนดคืน ${dateText(request.dueDate)}` : ''}</small></td>
                  <td>{dateText(request.createdAt)}</td>
                  <td><div className={styles.actions}>
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
        <div className={styles.modalHeader}><div><p className={styles.eyebrow}>NEW REQUEST</p><h2>ขอรีเควสยืม EQM</h2><p>เลือกโครงการเจ้าของ แล้วเลือกเฉพาะ EQM ที่พร้อมให้ยืม</p></div><button className={styles.closeButton} onClick={() => setIsModalOpen(false)} aria-label="ปิด"><X size={19} /></button></div>
        <div className={styles.modalBody}>
          <div className={styles.formGrid}><label>โครงการผู้ยืม<input value={`${borrowerProjectNo} — ${activeProject?.projectName || ''}`} readOnly /></label><label>โครงการที่จะยืม<select value={lenderProjectNo} onChange={(event) => { setLenderProjectNo(event.target.value); setSelectedItems({}); }}>{lenderProjects.map((project) => <option key={project.projectNo} value={project.projectNo}>{project.projectNo} — {project.projectName}</option>)}</select></label><label>วัตถุประสงค์<input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="เช่น ใช้งานชั่วคราวในพื้นที่..." /></label><label>กำหนดคืน (ถ้ามี)<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>
          <div className={styles.pickerHeader}><div><h3>รายการ EQM ที่พร้อมให้ยืม</h3><span>เลือกแล้ว {Object.keys(selectedItems).length} รายการ</span></div><SearchField value={itemQuery} onChange={setItemQuery} placeholder="ค้นหา EQM / รายละเอียด" /></div>
          <div className={styles.itemList}>{availableEqm.map((item) => { const id = getStockItemId(item); const selected = selectedItems[id] !== undefined; return <div className={`${styles.itemRow} ${selected ? styles.itemSelected : ''}`} key={id}><input type="checkbox" checked={selected} onChange={() => toggleItem(item)} /><div className={styles.itemInfo}><strong>{item.itemNo || item.materialNo}</strong><span>{item.itemDescription || '-'} · {item.receiveNo}</span></div><span className={styles.available}>พร้อมให้ยืม {item.qty.toLocaleString()} {item.unit || 'ชิ้น'}</span>{selected ? <input className={styles.qtyInput} type="number" min="1" max={item.qty} value={selectedItems[id]} onChange={(event) => setSelectedItems((current) => ({ ...current, [id]: event.target.value }))} aria-label={`จำนวน ${item.itemNo}`} /> : null}</div>; })}{availableEqm.length === 0 ? <div className={styles.empty}><Search size={18} />ไม่พบ EQM ที่พร้อมให้ยืมของโครงการนี้</div> : null}</div>
        </div>
        <div className={styles.modalFooter}><button className={styles.secondaryButton} onClick={() => setIsModalOpen(false)}>ยกเลิก</button><button className={styles.primaryButton} disabled={isSubmitting || Object.keys(selectedItems).length === 0 || !purpose.trim()} onClick={submitRequest}>{isSubmitting ? 'กำลังบันทึก...' : 'สร้างคำขอ'}</button></div>
      </section></div> : null}
    </div>
  );
}
