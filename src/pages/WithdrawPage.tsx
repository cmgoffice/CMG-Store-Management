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
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
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
  if (record.type !== 'borrow' || record.status === 'Returned' || !record.dueDate) {
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
  const {
    projects,
    activeProjects,
    stockItems,
    withdrawRecords,
    createWithdraw,
    returnWithdraw,
    activeProjectNo,
  } = useInventory();
  const { activeRole, isReadOnly } = useRole();
  const [activeTab, setActiveTab] = useState<WithdrawTab>('records');
  const [query, setQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isItemPickerOpen, setIsItemPickerOpen] = useState(false);
  const [withdrawType, setWithdrawType] = useState<WithdrawType>('issue');
  const [requesterName, setRequesterName] = useState('');
  const [requesterPhone, setRequesterPhone] = useState('');
  const [withdrawDate, setWithdrawDate] = useState(getTodayInputValue);
  const [dueDate, setDueDate] = useState('');
  const [purpose, setPurpose] = useState('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [withdrawQuantities, setWithdrawQuantities] = useState<Record<string, string>>({});
  const [itemPickerQuery, setItemPickerQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [returningWithdrawId, setReturningWithdrawId] = useState<string | null>(null);
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
          record.requesterPhone,
          record.issuedByName,
          record.purpose,
          getWithdrawTypeLabel(record.type),
          getEffectiveStatus(record),
          ...record.items.map((item) => `${item.receiveNo} ${item.itemNo} ${item.itemDescription} ${item.vendorName}`),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      return isForActiveProject && matchesQuery;
    });
  }, [normalizedActiveProjectNo, normalizedQuery, withdrawRecords]);

  const waitingReturnRecords = useMemo(
    () => projectWithdrawRecords.filter((record) => record.type === 'borrow' && record.status !== 'Returned'),
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
      }))
      .filter(({ qty }) => Number.isFinite(qty) && qty > 0);
  }, [selectedItems, withdrawQuantities]);

  const totalAvailableQty = useMemo(
    () => availableItems.reduce((sum, item) => sum + item.qty, 0),
    [availableItems]
  );

  const invalidQtyItem = selectedItems.find((item) => {
    const qty = Number(withdrawQuantities[getStockItemId(item)] || 0);
    return Number.isFinite(qty) && qty > item.qty;
  });

  const withdrawUnavailableReason = !canCreateWithdraw
    ? `Withdraw creation is not available for ${activeRole}.`
    : !activeProjectNo
      ? 'Please select an active project first.'
      : availableItems.length === 0
        ? 'No available Store items with qty greater than 0 were found for the active project.'
        : '';
  const withdrawSubmitDisabledReason = !requesterName.trim()
    ? 'Please enter the requester or responsible person.'
    : !requesterPhone.trim()
      ? 'Please enter the requester phone number.'
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
                : invalidQtyItem
                  ? `Withdraw qty for ${invalidQtyItem.receiveNo} is greater than available qty.`
                  : '';

  const resetModalState = () => {
    photoUrls.forEach((url) => URL.revokeObjectURL(url));
    setWithdrawType('issue');
    setRequesterName('');
    setRequesterPhone('');
    setWithdrawDate(getTodayInputValue());
    setDueDate('');
    setPurpose('');
    setPhotoFiles([]);
    setPhotoUrls([]);
    setPhotoNames([]);
    setSelectedItemIds([]);
    setWithdrawQuantities({});
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

  const toggleSelectedItem = (stockItemId: string) => {
    setSubmitError('');
    setSelectedItemIds((current) => {
      if (current.includes(stockItemId)) {
        setWithdrawQuantities((quantities) => {
          const next = { ...quantities };
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
        requesterName,
        requesterPhone,
        withdrawDate,
        purpose,
        dueDate: withdrawType === 'borrow' ? dueDate : undefined,
        items: selectedDraftItems.map(({ item, qty }) => ({
          receiveNo: getStockItemId(item),
          qty,
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
      window.alert(error instanceof Error ? error.message : 'Failed to return borrowed items.');
    } finally {
      setReturningWithdrawId(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Stock"
        title="Withdraw"
        description={
          activeProject
            ? `Create and track stock withdrawals for Project ${activeProject.projectNo}. Borrowed items stay visible until returned.`
            : 'Create stock withdrawals from the active project store.'
        }
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search withdraw no, requester, item"
            />
            <button
              className={styles.primaryButton}
              type="button"
              disabled={!canCreateWithdraw || !activeProjectNo}
              onClick={handleOpenModal}
              title={withdrawUnavailableReason || 'Create withdraw request'}
            >
              <PackageMinus size={16} />
              <span>Create Withdraw</span>
            </button>
          </>
        }
      />

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
          Withdraw creation and item return are read-only for {activeRole}. You can still review records for the active project.
        </div>
      ) : null}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <PackageMinus size={20} />
          </div>
          <div>
            <div className={styles.summaryLabel}>Available Store Qty</div>
            <div className={styles.summaryValue}>{totalAvailableQty.toLocaleString()}</div>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <CalendarClock size={20} />
          </div>
          <div>
            <div className={styles.summaryLabel}>Waiting Return</div>
            <div className={styles.summaryValue}>{waitingReturnRecords.length.toLocaleString()}</div>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.summaryIconWarn}`}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <div className={styles.summaryLabel}>Overdue</div>
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
              <h2>Withdraw Records</h2>
              <p>Issued withdrawals deduct stock permanently, while borrowed withdrawals wait for return.</p>
            </div>
            <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
          </div>

          <div className="tableScroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Withdraw No.</th>
                  <th>Type</th>
                  <th>Requester</th>
                  <th>Date / Due</th>
                  <th>Items</th>
                  <th>Purpose / Photos</th>
                  <th>Issued By</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {projectWithdrawRecords.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <span className={styles.withdrawCode}>{record.withdrawNo}</span>
                      <small className={styles.subText}>Doc: {record.projectShortNo}</small>
                    </td>
                    <td>
                      <span className={record.type === 'borrow' ? styles.borrowType : styles.issueType}>
                        {getWithdrawTypeLabel(record.type)}
                      </span>
                    </td>
                    <td>
                      <div className={styles.stackCell}>
                        <strong>{record.requesterName || '-'}</strong>
                        <span>{record.requesterPhone || '-'}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.stackCell}>
                        <strong>{formatDate(record.withdrawDate)}</strong>
                        <span>{record.type === 'borrow' ? `Due ${formatDate(record.dueDate)}` : 'No return required'}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.itemStack}>
                        {record.items.map((item) => (
                          <span key={`${record.id}-${item.stockItemId}`} className={styles.itemChip}>
                            {item.receiveNo} / {item.itemDescription} / Qty {item.qty}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
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
                          <span className={styles.subText}>No photo</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className={styles.stackCell}>
                        <strong>{record.issuedByName || '-'}</strong>
                        <span>{formatDateTime(record.createdAt)}</span>
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={getEffectiveStatus(record)} />
                    </td>
                  </tr>
                ))}
                {projectWithdrawRecords.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.empty}>
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
              <h2>Waiting Return / Due</h2>
              <p>Borrowed tools and equipment remain here until returned into the active project store.</p>
            </div>
            <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
          </div>

          <div className="tableScroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Withdraw No.</th>
                  <th>Requester</th>
                  <th>Due Date</th>
                  <th>Items to Return</th>
                  <th>Purpose</th>
                  <th>Issued By</th>
                  <th>Status</th>
                  <th>Action</th>
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
                          <span>{record.requesterPhone || '-'}</span>
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
                          title={isReadOnly ? `Return action is not available for ${activeRole}.` : 'Return borrowed items to stock'}
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
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <h3>Create Withdraw Record</h3>
                <p>Select available Store items from the active project and choose whether they are consumed or borrowed.</p>
              </div>
              <button type="button" className={styles.iconButton} onClick={closeModal} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalInfo}>
                <span>Active Project</span>
                <strong>{activeProject ? `Project ${activeProject.projectNo} - ${activeProject.projectName}` : '-'}</strong>
              </div>

              <div className={styles.segmentedControl} role="group" aria-label="Withdraw type">
                <button
                  type="button"
                  className={`${styles.segmentButton} ${withdrawType === 'issue' ? styles.segmentButtonActive : ''}`}
                  onClick={() => {
                    setWithdrawType('issue');
                    setDueDate('');
                  }}
                >
                  <PackageMinus size={16} />
                  <span>Issue and Deduct</span>
                </button>
                <button
                  type="button"
                  className={`${styles.segmentButton} ${withdrawType === 'borrow' ? styles.segmentButtonActive : ''}`}
                  onClick={() => setWithdrawType('borrow')}
                >
                  <RotateCcw size={16} />
                  <span>Borrow and Return</span>
                </button>
              </div>

              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Requester / Responsible Person</span>
                  <input
                    className={styles.input}
                    type="text"
                    value={requesterName}
                    onChange={(event) => setRequesterName(event.target.value)}
                    placeholder="Requester name"
                  />
                </label>

                <label className={styles.field}>
                  <span>Requester Phone</span>
                  <input
                    className={styles.input}
                    type="tel"
                    value={requesterPhone}
                    onChange={(event) => setRequesterPhone(event.target.value)}
                    placeholder="Phone number"
                  />
                </label>

                <label className={styles.field}>
                  <span>Withdraw Date</span>
                  <input
                    className={styles.input}
                    type="date"
                    value={withdrawDate}
                    onChange={(event) => setWithdrawDate(event.target.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span>Return Due Date</span>
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
                  <span>Items and Quantity</span>
                  <button
                    className={styles.selectItemsButton}
                    type="button"
                    onClick={() => setIsItemPickerOpen(true)}
                  >
                    <ListPlus size={16} />
                    <span>Select</span>
                  </button>
                </div>

                {selectedItems.length === 0 ? (
                  <div className={styles.emptyInline}>
                    No items selected. Click Select to choose available Store items from this project.
                  </div>
                ) : (
                  <div className={styles.selectedItemsTable}>
                    <div className={styles.selectedItemsHead}>
                      <span>Receive No.</span>
                      <span>Item</span>
                      <span>Available</span>
                      <span>Withdraw Qty</span>
                      <span>Action</span>
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
                            <button
                              className={styles.removeItemButton}
                              type="button"
                              onClick={() => removeSelectedItem(stockItemId)}
                              aria-label={`Remove ${item.receiveNo}`}
                              title="Remove item"
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
                <span>Purpose / Usage Detail</span>
                <textarea
                  className={styles.textarea}
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder="Describe where and why these items are withdrawn"
                  rows={4}
                />
              </label>

              <div className={styles.field}>
                <span>Photos</span>
                <label className={styles.uploadBox}>
                  <input type="file" accept="image/*" multiple onChange={handleFileChange} />
                  <ImagePlus size={18} />
                  <div>
                    <strong>Upload to Firebase Storage</strong>
                    <p>Attach up to 5 photos for evidence or handover reference.</p>
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
                title={withdrawSubmitDisabledReason || 'Create withdraw record'}
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
                    <h3>Select Store Items</h3>
                    <p>Only active project items with qty greater than 0 are available.</p>
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
                      placeholder="Search receive no, PR, item, vendor, location"
                    />
                    <div className={styles.selectionNote}>
                      Selected: {selectedItems.length.toLocaleString()}
                    </div>
                  </div>

                  <div className={styles.itemPickerTableWrap}>
                    <table className={`table compact ${styles.itemPickerTable}`}>
                      <thead>
                        <tr>
                          <th>Select</th>
                          <th>Receive No.</th>
                          <th>Item</th>
                          <th>Current Location</th>
                          <th>Vendor</th>
                          <th>Unit</th>
                          <th className="numeric">Available Qty</th>
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
