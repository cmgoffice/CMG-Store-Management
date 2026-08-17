import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ImagePlus,
  ListPlus,
  PackageMinus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { SearchField } from '../components/SearchField';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import { useDialog } from '../context/DialogContext';
import type { StockItem, WithdrawRecord, WithdrawRecordStatus, WithdrawType } from '../types/models';
import { getStockItemId } from '../utils/stockItem';
import '../styles/tables.css';
import styles from './WithdrawPage.module.css';

type WithdrawTab = 'records' | 'returns';

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function formatDate(value?: string) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
  }).format(parsed);
}

function getTodayInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function normalizeProjectNo(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return '';
  }

  const projectMatch = text.match(/\bJ[-\s]?0*([0-9]+[a-z0-9]*)\b/i);
  if (projectMatch) {
    return `J${projectMatch[1].toUpperCase()}`;
  }

  return text.toUpperCase();
}

function extractProjectNoFromLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const patterns = [
    /^Project\s+(.+)$/i,
    /^Store\s+(.+)$/i,
    /^In Transit to\s+Project\s+(.+)$/i,
    /^In Transit to\s+Store\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return normalizeProjectNo(match[1]);
    }
  }

  return '';
}

function getStockItemProjectNo(item: StockItem) {
  return (
    normalizeProjectNo(item.cmgProjectCode) ||
    extractProjectNoFromLabel(item.purchasedForProject) ||
    extractProjectNoFromLabel(item.location) ||
    normalizeProjectNo(item.projectId)
  );
}

function isWithdrawOverdue(record: WithdrawRecord) {
  if (record.type !== 'borrow' || record.status === 'Returned' || record.status === 'Cancelled' || !record.dueDate) {
    return false;
  }

  const dueDate = new Date(record.dueDate.includes('T') ? record.dueDate : `${record.dueDate}T23:59:59`);
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  return dueDate.getTime() < Date.now();
}

function getEffectiveStatus(record: WithdrawRecord): WithdrawRecordStatus {
  return isWithdrawOverdue(record) ? 'Overdue' : record.status;
}

function getWithdrawTypeLabel(type: WithdrawType) {
  return type === 'borrow' ? 'Borrow / Return' : 'Issue / Consume';
}

export function WithdrawPage() {
  const { showAlert, showConfirm } = useDialog();
  const {
    projects,
    activeProjects,
    stockItems,
    withdrawRecords,
    createWithdraw,
    returnWithdraw,
    cancelWithdraw,
    activeProjectNo,
  } = useInventory();
  const { roleLabel, isReadOnly, hasRole } = useRole();
  const isMasterAdmin = hasRole('MasterAdmin');
  const [activeTab, setActiveTab] = useState<WithdrawTab>('records');
  const [query, setQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isItemPickerOpen, setIsItemPickerOpen] = useState(false);
  const [withdrawType, setWithdrawType] = useState<WithdrawType>('issue');
  const [requesterName, setRequesterName] = useState('');
  const [withdrawDate, setWithdrawDate] = useState(getTodayInputValue);
  const [dueDate, setDueDate] = useState('');
  const [purpose, setPurpose] = useState('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [withdrawQuantities, setWithdrawQuantities] = useState<Record<string, string>>({});
  const [requesterNames, setRequesterNames] = useState<Record<string, string>>({});
  const [itemPickerQuery, setItemPickerQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [returningWithdrawId, setReturningWithdrawId] = useState<string | null>(null);
  const [cancellingWithdrawId, setCancellingWithdrawId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedActiveProjectNo = normalizeProjectNo(activeProjectNo);
  const activeProject =
    activeProjects.find((project) => project.projectNo === activeProjectNo) ??
    projects.find((project) => project.projectNo === activeProjectNo);
  const canCreateWithdraw = !isReadOnly;

  useEffect(() => {
    return () => {
      photoUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photoUrls]);

  const availableItems = useMemo(() => {
    if (!normalizedActiveProjectNo) {
      return [];
    }

    return stockItems.filter((item) => {
      const itemProjectNo = getStockItemProjectNo(item);
      return (
        itemProjectNo === normalizedActiveProjectNo &&
        item.qty > 0 &&
        item.status !== 'In Transit' &&
        item.status !== 'Borrowed' &&
        item.status !== 'Withdrawn'
      );
    });
  }, [normalizedActiveProjectNo, stockItems]);

  const selectedItems = useMemo(() => {
    const availableItemById = new Map(availableItems.map((item) => [getStockItemId(item), item]));

    return selectedItemIds
      .map((stockItemId) => availableItemById.get(stockItemId))
      .filter((item): item is StockItem => Boolean(item));
  }, [availableItems, selectedItemIds]);

  const pickerItems = useMemo(() => {
    const normalizedPickerQuery = itemPickerQuery.trim().toLowerCase();

    if (!normalizedPickerQuery) {
      return availableItems;
    }

    return availableItems.filter((item) =>
      [
        item.receiveNo,
        item.prNo,
        item.poNo,
        item.itemNo,
        item.itemDescription,
        item.vendorName,
        item.location,
        item.unit,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedPickerQuery)
    );
  }, [availableItems, itemPickerQuery]);

  const projectWithdrawRecords = useMemo(() => {
    return withdrawRecords.filter((record) => {
      const isForActiveProject = normalizeProjectNo(record.projectNo) === normalizedActiveProjectNo;
      const matchesQuery =
        !normalizedQuery ||
        [
          record.withdrawNo,
          record.projectNo,
          record.projectName,
          record.requesterName,
          record.issuedByName,
          record.purpose,
          getWithdrawTypeLabel(record.type),
          getEffectiveStatus(record),
          ...record.items.map((item) => `${item.receiveNo} ${item.itemNo} ${item.itemDescription} ${item.vendorName} ${item.requesterName}`),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      return isForActiveProject && matchesQuery;
    });
  }, [normalizedActiveProjectNo, normalizedQuery, withdrawRecords]);

  const waitingReturnRecords = useMemo(
    () => projectWithdrawRecords.filter((record) => record.type === 'borrow' && record.status !== 'Returned' && record.status !== 'Cancelled'),
    [projectWithdrawRecords]
  );

  const overdueRecords = useMemo(
    () => waitingReturnRecords.filter((record) => isWithdrawOverdue(record)),
    [waitingReturnRecords]
  );

  const selectedDraftItems = useMemo(() => {
    return selectedItems
      .map((item) => ({
        item,
        qty: Number(withdrawQuantities[getStockItemId(item)] || 0),
        requesterName:
          withdrawType === 'issue'
            ? requesterNames[getStockItemId(item)]?.trim() || ''
            : requesterName.trim(),
      }))
      .filter(({ qty }) => Number.isFinite(qty) && qty > 0);
  }, [requesterName, requesterNames, selectedItems, withdrawQuantities, withdrawType]);

  const totalAvailableQty = useMemo(
    () => availableItems.reduce((sum, item) => sum + item.qty, 0),
    [availableItems]
  );

  const invalidQtyItem = selectedItems.find((item) => {
    const qty = Number(withdrawQuantities[getStockItemId(item)] || 0);
    return Number.isFinite(qty) && qty > item.qty;
  });

  const missingRequesterItem =
    withdrawType === 'issue' ? selectedDraftItems.find(({ requesterName }) => !requesterName) : undefined;

  const withdrawUnavailableReason = !canCreateWithdraw
    ? `Withdraw creation is not available for ${roleLabel}.`
    : !activeProjectNo
      ? 'Please select an active project first.'
      : availableItems.length === 0
        ? 'No available Store items with qty greater than 0 were found for the active project.'
        : '';
  const withdrawSubmitDisabledReason =
    withdrawType === 'borrow' && !requesterName.trim()
      ? 'Please enter the requester or responsible person.'
      : !withdrawDate.trim()
          ? 'Please select the withdrawal date.'
          : withdrawType === 'borrow' && !dueDate.trim()
            ? 'Please select the return due date.'
            : !purpose.trim()
              ? 'Please enter the withdrawal purpose.'
              : selectedItems.length === 0
                ? 'Please select at least one Store item.'
                : selectedDraftItems.length === 0
                  ? 'Please enter withdraw qty greater than 0 for at least one selected item.'
                  : missingRequesterItem
                    ? `Please enter the requester or responsible person for ${missingRequesterItem.item.receiveNo}.`
                    : invalidQtyItem
                      ? `Withdraw qty for ${invalidQtyItem.receiveNo} is greater than available qty.`
                      : '';

  const resetModalState = () => {
    photoUrls.forEach((url) => URL.revokeObjectURL(url));
    setWithdrawType('issue');
    setRequesterName('');
    setWithdrawDate(getTodayInputValue());
    setDueDate('');
    setPurpose('');
    setPhotoFiles([]);
    setPhotoUrls([]);
    setPhotoNames([]);
    setSelectedItemIds([]);
    setWithdrawQuantities({});
    setRequesterNames({});
    setItemPickerQuery('');
    setUploadError('');
    setSubmitError('');
    setIsItemPickerOpen(false);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetModalState();
  };

  const handleOpenModal = () => {
    if (!canCreateWithdraw || !activeProjectNo) {
      return;
    }

    resetModalState();
    setIsModalOpen(true);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }

    const allowedCount = Math.max(0, 5 - photoFiles.length);
    const nextFiles = files.slice(0, allowedCount);

    if (!nextFiles.length) {
      setUploadError('You can attach up to 5 photos per withdraw request.');
      event.target.value = '';
      return;
    }

    setUploadError('');
    const nextUrls = nextFiles.map((file) => URL.createObjectURL(file));
    setPhotoFiles((current) => [...current, ...nextFiles]);
    setPhotoUrls((current) => [...current, ...nextUrls]);
    setPhotoNames((current) => [...current, ...nextFiles.map((file) => file.name)]);
    event.target.value = '';
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photoUrls[index]);
    setPhotoFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setPhotoUrls((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setPhotoNames((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleQtyChange = (stockItemId: string, value: string) => {
    if (value !== '' && !/^\d+$/.test(value)) {
      return;
    }

    setSubmitError('');
    setWithdrawQuantities((current) => ({
      ...current,
      [stockItemId]: value,
    }));
  };

  const handleRequesterNameChange = (stockItemId: string, value: string) => {
    setSubmitError('');
    setRequesterNames((current) => ({
      ...current,
      [stockItemId]: value,
    }));
  };

  const toggleSelectedItem = (stockItemId: string) => {
    setSubmitError('');
    setSelectedItemIds((current) => {
      if (current.includes(stockItemId)) {
        setWithdrawQuantities((quantities) => {
          const next = { ...quantities };
          delete next[stockItemId];
          return next;
        });
        setRequesterNames((names) => {
          const next = { ...names };
          delete next[stockItemId];
          return next;
        });
        return current.filter((id) => id !== stockItemId);
      }

      setWithdrawQuantities((quantities) => ({
        ...quantities,
        [stockItemId]: quantities[stockItemId] || '1',
      }));
      return [...current, stockItemId];
    });
  };

  const removeSelectedItem = (stockItemId: string) => {
    setSubmitError('');
    setSelectedItemIds((current) => current.filter((id) => id !== stockItemId));
    setWithdrawQuantities((current) => {
      const next = { ...current };
      delete next[stockItemId];
      return next;
    });
    setRequesterNames((current) => {
      const next = { ...current };
      delete next[stockItemId];
      return next;
    });
  };

  const handleWithdrawSubmit = async () => {
    if (isSubmitting) {
      return;
    }

    if (!activeProjectNo) {
      setSubmitError('Please select an active project.');
      return;
    }

    if (withdrawSubmitDisabledReason) {
      setSubmitError(withdrawSubmitDisabledReason);
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    try {
      await createWithdraw({
        projectNo: activeProjectNo,
        type: withdrawType,
        withdrawDate,
        purpose,
        dueDate: withdrawType === 'borrow' ? dueDate : undefined,
        items: selectedDraftItems.map(({ item, qty, requesterName }) => ({
          receiveNo: getStockItemId(item),
          qty,
          requesterName,
        })),
        photos: photoFiles,
      });
      closeModal();
    } catch (error) {
      console.error('Failed to create withdraw:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to create withdraw. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReturnWithdraw = async (record: WithdrawRecord) => {
    if (returningWithdrawId || isReadOnly) {
      return;
    }

    setReturningWithdrawId(record.id);
    try {
      await returnWithdraw(record.id);
    } catch (error) {
      console.error('Failed to return withdraw:', error);
      await showAlert(error instanceof Error ? error.message : 'Failed to return borrowed items.', { variant: 'error' });
    } finally {
      setReturningWithdrawId(null);
    }
  };

  const handleCancelWithdraw = async (record: WithdrawRecord) => {
    if (cancellingWithdrawId || !isMasterAdmin || record.status === 'Returned' || record.status === 'Cancelled') {
      return;
    }

    const confirmed = await showConfirm(
      `ยืนยันการยกเลิกการเบิก ${record.withdrawNo}? จำนวนสินค้าจะถูกคืนกลับไปยัง Store ของโครงการที่ตัดยอดรายการนี้`,
      {
        title: 'ยืนยันการยกเลิกการเบิก',
        variant: 'warning',
        confirmLabel: 'ยืนยันยกเลิก',
        cancelLabel: 'ไม่ใช่',
      }
    );
    if (!confirmed) {
      return;
    }

    setCancellingWithdrawId(record.id);
    try {
      await cancelWithdraw(record.id);
    } catch (error) {
      console.error('Failed to cancel withdraw:', error);
      await showAlert(error instanceof Error ? error.message : 'Failed to cancel the withdrawal. Please try again.', { variant: 'error' });
    } finally {
      setCancellingWithdrawId(null);
    }
  };

  return (
    <div>
      <div className={styles.toolbar}>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="ค้นหาเลขที่เบิก ผู้ขอเบิก หรือรายการสินค้า"
        />
        <button
          className={styles.primaryButton}
          type="button"
          disabled={!canCreateWithdraw || !activeProjectNo}
          onClick={handleOpenModal}
          title={withdrawUnavailableReason || 'สร้างรายการเบิก'}
        >
          <PackageMinus size={16} />
          <span>สร้างรายการเบิก</span>
        </button>
      </div>

      {overdueRecords.length > 0 ? (
        <div className={styles.alertNotice}>
          <AlertTriangle size={18} />
          <span>
            {overdueRecords.length.toLocaleString()} borrowed withdraw record(s) are overdue for Project{' '}
            {activeProject?.projectNo ?? '-'}.
          </span>
        </div>
      ) : null}

      {!canCreateWithdraw ? (
        <div className={styles.notice}>
          Withdraw creation and item return are read-only for {roleLabel}. You can still review records for the active project.
        </div>
      ) : null}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <PackageMinus size={20} />
          </div>
          <div>
            <div className={styles.summaryLabel}>จำนวนคงเหลือในคลัง</div>
            <div className={styles.summaryValue}>{totalAvailableQty.toLocaleString()}</div>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <CalendarClock size={20} />
          </div>
          <div>
            <div className={styles.summaryLabel}>รอคืน</div>
            <div className={styles.summaryValue}>{waitingReturnRecords.length.toLocaleString()}</div>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.summaryIconWarn}`}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <div className={styles.summaryLabel}>เกินกำหนด</div>
            <div className={styles.summaryValue}>{overdueRecords.length.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Withdraw views">
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'records' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('records')}
        >
          All Records
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'returns' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('returns')}
        >
          Waiting Return
        </button>
      </div>

      {activeTab === 'records' ? (
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>รายการเบิกสินค้า</h2>
              <p>การเบิกจ่ายจะตัดสต็อกถาวร ส่วนการยืมจะรอคืนเข้าคลัง</p>
            </div>
            <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
          </div>

          <div className="tableScroll">
            <table className={`table compact ${styles.withdrawTable}`}>
              <thead>
                <tr>
                  <th>เลขที่เบิก</th><th>ประเภท</th><th>ผู้ขอเบิก</th><th>วันที่ / กำหนดคืน</th><th>รายการ</th><th className="numeric">QTY</th><th>วัตถุประสงค์ / รูปภาพ</th><th>ผู้จ่าย</th><th>สถานะ</th>
                  <th>การดำเนินการ</th>
                </tr>
              </thead>
              <tbody>
                {projectWithdrawRecords.flatMap((record) => (
                  record.items.map((item, itemIndex) => (
                    <tr key={`${record.id}-${item.stockItemId}`} className={itemIndex === 0 ? styles.withdrawRowStart : undefined}>
                      {itemIndex === 0 ? (
                        <>
                          <td rowSpan={record.items.length}>
                            <span className={styles.withdrawCode}>{record.withdrawNo}</span>
                            <small className={styles.subText}>Doc: {record.projectShortNo}</small>
                          </td>
                          <td rowSpan={record.items.length}>
                            <span className={record.type === 'borrow' ? styles.borrowType : styles.issueType}>
                              {getWithdrawTypeLabel(record.type)}
                            </span>
                          </td>
                          <td rowSpan={record.items.length}>
                            <div className={styles.stackCell}>
                              <strong>{record.requesterName || '-'}</strong>
                            </div>
                          </td>
                          <td rowSpan={record.items.length}>
                            <div className={styles.stackCell}>
                              <strong>{formatDate(record.withdrawDate)}</strong>
                              <span>{record.type === 'borrow' ? `Due ${formatDate(record.dueDate)}` : 'No return required'}</span>
                            </div>
                          </td>
                        </>
                      ) : null}
                      <td className={styles.withdrawItemCell}>{item.itemDescription || '-'}</td>
                      <td className={`numeric ${styles.withdrawQtyCell}`}>{item.qty.toLocaleString()}</td>
                      {itemIndex === 0 ? (
                        <>
                          <td rowSpan={record.items.length}>
                            <div className={styles.stackCell}>
                              <span>{record.purpose || '-'}</span>
                              {record.photoUrls.length > 0 ? (
                                <div className={styles.photoList}>
                                  {record.photoUrls.map((url, index) => (
                                    <a
                                      key={`${record.id}-${index}`}
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={styles.photoLink}
                                    >
                                      Photo {index + 1}
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <span className={styles.subText}>ไม่มีรูปภาพ</span>
                              )}
                            </div>
                          </td>
                          <td rowSpan={record.items.length}>
                            <div className={styles.stackCell}>
                              <strong>{record.issuedByName || '-'}</strong>
                              <span>{formatDateTime(record.createdAt)}</span>
                            </div>
                          </td>
                          <td rowSpan={record.items.length}>
                            <StatusBadge status={getEffectiveStatus(record)} />
                          </td>
                          <td rowSpan={record.items.length}>
                            {isMasterAdmin && record.status !== 'Returned' && record.status !== 'Cancelled' ? (
                              <button
                                type="button"
                                className={styles.cancelButton}
                                disabled={cancellingWithdrawId === record.id}
                                onClick={() => handleCancelWithdraw(record)}
                                title="ยกเลิกการเบิกและคืนสินค้าเข้าคลังโครงการ"
                              >
                                {cancellingWithdrawId === record.id ? <span className={styles.spinner} /> : <X size={13} />}
                                <span>{cancellingWithdrawId === record.id ? 'กำลังยกเลิก...' : 'ยกเลิก'}</span>
                              </button>
                            ) : null}
                          </td>
                        </>
                      ) : null}
                    </tr>
                  ))
                ))}
                {projectWithdrawRecords.length === 0 ? (
                  <tr>
                    <td colSpan={10} className={styles.empty}>
                      No withdraw records matched the current active project and filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>รอคืน / กำหนดคืน</h2>
              <p>เครื่องมือและอุปกรณ์ที่ยืมจะแสดงที่นี่จนกว่าจะคืนเข้าคลังโครงการปัจจุบัน</p>
            </div>
            <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
          </div>

          <div className="tableScroll">
            <table className="table">
              <thead>
                <tr>
                  <th>เลขที่เบิก</th><th>ผู้ขอเบิก</th><th>กำหนดคืน</th><th>รายการที่ต้องคืน</th><th>วัตถุประสงค์</th><th>ผู้จ่าย</th><th>สถานะ</th><th>การดำเนินการ</th>
                </tr>
              </thead>
              <tbody>
                {waitingReturnRecords.map((record) => {
                  const effectiveStatus = getEffectiveStatus(record);

                  return (
                    <tr key={record.id} className={effectiveStatus === 'Overdue' ? styles.overdueRow : undefined}>
                      <td>
                        <span className={styles.withdrawCode}>{record.withdrawNo}</span>
                      </td>
                      <td>
                        <div className={styles.stackCell}>
                          <strong>{record.requesterName || '-'}</strong>
                        </div>
                      </td>
                      <td>{formatDate(record.dueDate)}</td>
                      <td>
                        <div className={styles.itemStack}>
                          {record.items.map((item) => (
                            <span key={`${record.id}-return-${item.stockItemId}`} className={styles.itemChip}>
                              {item.itemDescription} / Qty {item.qty}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>{record.purpose || '-'}</td>
                      <td>{record.issuedByName || '-'}</td>
                      <td>
                        <StatusBadge status={effectiveStatus} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          disabled={isReadOnly || returningWithdrawId === record.id}
                          onClick={() => handleReturnWithdraw(record)}
                          title={isReadOnly ? `บทบาท ${roleLabel} ไม่สามารถคืนสินค้าได้` : 'คืนสินค้าที่ยืมเข้าสต็อก'}
                        >
                          {returningWithdrawId === record.id ? (
                            <span className={styles.spinner} />
                          ) : (
                            <RotateCcw size={15} />
                          )}
                          <span>{returningWithdrawId === record.id ? 'Returning...' : 'Return'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {waitingReturnRecords.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.empty}>
                      No borrowed withdraw records are waiting for return.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isModalOpen ? (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modal} ${withdrawType === 'issue' ? styles.modalIssue : styles.modalBorrow}`}>
            <div className={styles.modalHeader}>
              <div>
                <h3>สร้างรายการเบิกสินค้า</h3>
                <p>เลือกรายการที่คงเหลือในคลังของโครงการปัจจุบัน และระบุว่าเบิกจ่ายหรือยืม</p>
              </div>
              <button type="button" className={styles.iconButton} onClick={closeModal} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalInfo}>
                <span>โครงการปัจจุบัน</span>
                <strong>{activeProject ? `Project ${activeProject.projectNo} - ${activeProject.projectName}` : '-'}</strong>
              </div>

              <div className={styles.segmentedControl} role="group" aria-label="Withdraw type">
                <button
                  type="button"
                  className={`${styles.segmentButton} ${styles.segmentButtonIssue} ${withdrawType === 'issue' ? styles.segmentButtonActive : ''}`}
                  onClick={() => {
                    setWithdrawType('issue');
                    setDueDate('');
                  }}
                >
                  <PackageMinus size={16} />
                  <span>เบิกจ่ายและตัดสต็อก</span>
                </button>
                <button
                  type="button"
                  className={`${styles.segmentButton} ${styles.segmentButtonBorrow} ${withdrawType === 'borrow' ? styles.segmentButtonActive : ''}`}
                  onClick={() => setWithdrawType('borrow')}
                >
                  <RotateCcw size={16} />
                  <span>ยืมและคืน</span>
                </button>
              </div>

              <div className={styles.formGrid}>
                {withdrawType === 'borrow' ? (
                  <label className={styles.field}>
                    <span>ผู้ขอเบิก / ผู้รับผิดชอบ</span>
                    <input
                      className={styles.input}
                      type="text"
                      value={requesterName}
                      onChange={(event) => setRequesterName(event.target.value)}
                      placeholder="ชื่อผู้ขอเบิก"
                    />
                  </label>
                ) : null}

                <label className={styles.field}>
                  <span>วันที่เบิก</span>
                  <input
                    className={styles.input}
                    type="date"
                    value={withdrawDate}
                    onChange={(event) => setWithdrawDate(event.target.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span>กำหนดคืน</span>
                  <input
                    className={styles.input}
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    disabled={withdrawType !== 'borrow'}
                  />
                </label>
              </div>

              <div className={styles.field}>
                <div className={styles.fieldHeader}>
                  <span>รายการและจำนวน</span>
                  <button
                    className={styles.selectItemsButton}
                    type="button"
                    onClick={() => setIsItemPickerOpen(true)}
                  >
                    <ListPlus size={16} />
                    <span>เลือก</span>
                  </button>
                </div>

                {selectedItems.length === 0 ? (
                  <div className={styles.emptyInline}>
                    No items selected. Click Select to choose available Store items from this project.
                  </div>
                ) : (
                  <div className={`${styles.selectedItemsTable} ${withdrawType === 'issue' ? styles.selectedItemsTableIssue : ''}`}>
                    <div className={styles.selectedItemsHead}>
                      <span>เลขที่รับ</span><span>รายการ</span><span>คงเหลือ</span><span>จำนวนเบิก</span>
                      {withdrawType === 'issue' ? <span>ผู้ขอเบิก / ผู้รับผิดชอบ</span> : null}
                      <span>การดำเนินการ</span>
                    </div>
                    <div className={styles.selectedItemsBody}>
                      {selectedItems.map((item) => {
                        const stockItemId = getStockItemId(item);

                        return (
                          <div key={stockItemId} className={styles.selectedItemRow}>
                            <span>{item.receiveNo}</span>
                            <span>
                              {item.itemDescription}
                              <small>{item.itemNo}</small>
                            </span>
                            <span>{item.qty.toLocaleString()}</span>
                            <input
                              className={styles.qtyInput}
                              type="text"
                              inputMode="numeric"
                              value={withdrawQuantities[stockItemId] ?? ''}
                              onChange={(event) => handleQtyChange(stockItemId, event.target.value)}
                              placeholder="0"
                            />
                            {withdrawType === 'issue' ? (
                              <input
                                className={styles.input}
                                type="text"
                                value={requesterNames[stockItemId] ?? ''}
                                onChange={(event) => handleRequesterNameChange(stockItemId, event.target.value)}
                                placeholder="ชื่อผู้ขอเบิก"
                              />
                            ) : null}
                            <button
                              className={styles.removeItemButton}
                              type="button"
                              onClick={() => removeSelectedItem(stockItemId)}
                              aria-label={`Remove ${item.receiveNo}`}
                              title="ลบรายการ"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <label className={styles.field}>
                <span>วัตถุประสงค์ / รายละเอียดการใช้งาน</span>
                <textarea
                  className={styles.textarea}
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder="ระบุสถานที่และเหตุผลในการเบิกสินค้า"
                  rows={4}
                />
              </label>

              <div className={styles.field}>
                <span>รูปภาพ</span>
                <label className={styles.uploadBox}>
                  <input type="file" accept="image/*" multiple onChange={handleFileChange} />
                  <ImagePlus size={18} />
                  <div>
                    <strong>อัปโหลดไปยัง Firebase Storage</strong>
                    <p>แนบรูปภาพประกอบหรืออ้างอิงการส่งมอบได้สูงสุด 5 รูป</p>
                  </div>
                </label>
                {uploadError ? <div className={styles.errorText}>{uploadError}</div> : null}
                {photoUrls.length > 0 ? (
                  <div className={styles.previewGrid}>
                    {photoUrls.map((url, index) => (
                      <div key={`${url.slice(0, 24)}-${index}`} className={styles.previewCard}>
                        <img src={url} alt={photoNames[index] || `Withdraw photo ${index + 1}`} />
                        <div className={styles.previewMeta}>
                          <span>{photoNames[index] || `Photo ${index + 1}`}</span>
                          <button type="button" onClick={() => removePhoto(index)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className={styles.ghostButton} onClick={closeModal} disabled={isSubmitting}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={isSubmitting}
                onClick={handleWithdrawSubmit}
                title={withdrawSubmitDisabledReason || 'สร้างรายการเบิก'}
              >
                {isSubmitting ? <span className={styles.spinner} /> : <CheckCircle2 size={16} />}
                <span>{isSubmitting ? 'Saving...' : 'Save Withdraw'}</span>
              </button>
            </div>
            {submitError ? <div className={styles.footerError}>{submitError}</div> : null}
          </div>

          {isItemPickerOpen ? (
            <div className={styles.modalOverlay}>
              <div className={`${styles.modal} ${styles.itemSelectModal}`}>
                <div className={styles.modalHeader}>
                  <div>
                    <h3>เลือกรายการในคลัง</h3>
                    <p>แสดงเฉพาะรายการของโครงการปัจจุบันที่มีจำนวนมากกว่า 0</p>
                  </div>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => setIsItemPickerOpen(false)}
                    aria-label="Close item selector"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className={styles.modalBody}>
                  <div className={styles.pickerToolbar}>
                    <input
                      className={styles.input}
                      type="search"
                      value={itemPickerQuery}
                      onChange={(event) => setItemPickerQuery(event.target.value)}
                      placeholder="ค้นหาเลขที่รับ, PR, รายการ, ผู้ขาย หรือสถานที่"
                    />
                    <div className={styles.selectionNote}>
                      Selected: {selectedItems.length.toLocaleString()}
                    </div>
                  </div>

                  <div className={styles.itemPickerTableWrap}>
                    <table className={`table compact ${styles.itemPickerTable}`}>
                      <thead>
                        <tr>
                          <th>เลือก</th><th>เลขที่รับ</th><th>รายการ</th><th>สถานที่ปัจจุบัน</th><th>ผู้ขาย</th><th>หน่วย</th><th className="numeric">จำนวนคงเหลือ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pickerItems.map((item) => {
                          const stockItemId = getStockItemId(item);
                          const isSelected = selectedItemIds.includes(stockItemId);

                          return (
                            <tr
                              key={stockItemId}
                              className={isSelected ? styles.pickerRowSelected : ''}
                              onClick={() => toggleSelectedItem(stockItemId)}
                            >
                              <td>
                                <input
                                  className={styles.checkbox}
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelectedItem(stockItemId)}
                                  onClick={(event) => event.stopPropagation()}
                                  aria-label={`Select ${item.receiveNo}`}
                                />
                              </td>
                              <td>
                                <span className={styles.withdrawCode}>{item.receiveNo}</span>
                              </td>
                              <td>
                                <span className="itemSummary">
                                  <strong>{item.itemDescription}</strong>
                                  <span className="itemCode">{item.itemNo}</span>
                                </span>
                              </td>
                              <td>{item.location || '-'}</td>
                              <td>{item.vendorName || '-'}</td>
                              <td>{item.unit || '-'}</td>
                              <td className="numeric">{item.qty.toLocaleString()}</td>
                            </tr>
                          );
                        })}
                        {pickerItems.length === 0 ? (
                          <tr>
                            <td colSpan={7} className={styles.empty}>
                              No available Store items matched the current search.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => setIsItemPickerOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
