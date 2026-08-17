import { ImagePlus, ListPlus, Send, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { SearchField } from '../components/SearchField';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import type { DispatchRecord } from '../types/models';
import { getStockItemId } from '../utils/stockItem';
import '../styles/tables.css';
import styles from './DispatchPage.module.css';

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
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

function getStockItemProjectNo(item: {
  cmgProjectCode?: string;
  purchasedForProject: string;
  location: string;
  projectId?: string;
}) {
  return (
    normalizeProjectNo(item.cmgProjectCode) ||
    extractProjectNoFromLabel(item.purchasedForProject) ||
    extractProjectNoFromLabel(item.location) ||
    normalizeProjectNo(item.projectId)
  );
}

export function DispatchPage() {
  const {
    projects,
    allProjects,
    activeProjects,
    stockItems,
    dispatchRecords,
    projectBorrowRequests,
    createDispatch,
    cancelDispatch,
    activeProjectNo,
  } = useInventory();
  const { canDispatch, canCancelDispatch, hasRole } = useRole();
  const [query, setQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [transport, setTransport] = useState('');
  const [note, setNote] = useState('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [dispatchQuantities, setDispatchQuantities] = useState<Record<string, string>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isItemPickerOpen, setIsItemPickerOpen] = useState(false);
  const [selectedPendingReceipt, setSelectedPendingReceipt] = useState<DispatchRecord | null>(null);
  const [itemPickerQuery, setItemPickerQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancellingDispatchId, setCancellingDispatchId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [submitError, setSubmitError] = useState('');

  const normalizedQuery = query.trim().toLowerCase();
  const activeProject = activeProjects.find((project) => project.projectNo === activeProjectNo)
    ?? projects.find((project) => project.projectNo === activeProjectNo);
  const canSelectAllDestinationProjects = hasRole('Store Site');
  const destinationProjects = useMemo(
    () => {
      const projectPool = canSelectAllDestinationProjects ? allProjects : activeProjects;
      return projectPool.filter(
        (project) => project.status !== 'Disactive' && project.projectNo !== activeProjectNo
      );
    },
    [activeProjectNo, activeProjects, allProjects, canSelectAllDestinationProjects]
  );
  const approvedBorrowRequests = useMemo(
    () => projectBorrowRequests.filter((request) =>
      request.status === 'Pending Dispatch' && request.lenderProjectNo === normalizeProjectNo(activeProjectNo)
    ),
    [activeProjectNo, projectBorrowRequests]
  );

  useEffect(() => {
    if (!selectedProject || selectedProject === activeProjectNo) {
      setSelectedProject(destinationProjects[0]?.projectNo ?? '');
    }
  }, [activeProjectNo, destinationProjects, selectedProject]);

  const dispatchableItems = useMemo(() => {
    const normalizedActiveProjectNo = normalizeProjectNo(activeProjectNo);

    return stockItems.filter((item) => {
      const itemProjectNo = getStockItemProjectNo(item);
      const isAvailableInStoreInventory =
        itemProjectNo === normalizedActiveProjectNo &&
        item.qty > 0 &&
        item.status !== 'In Transit';

      return isAvailableInStoreInventory;
    });
  }, [activeProjectNo, stockItems]);

  const selectedItems = useMemo(() => {
    const dispatchableItemById = new Map(dispatchableItems.map((item) => [getStockItemId(item), item]));

    return selectedItemIds
      .map((stockItemId) => dispatchableItemById.get(stockItemId))
      .filter((item): item is (typeof dispatchableItems)[number] => Boolean(item));
  }, [dispatchableItems, selectedItemIds]);

  const pickerItems = useMemo(() => {
    const normalizedPickerQuery = itemPickerQuery.trim().toLowerCase();

    if (!normalizedPickerQuery) {
      return dispatchableItems;
    }

    return dispatchableItems.filter((item) =>
      [
        item.receiveNo,
        item.prNo,
        item.poNo,
        item.itemNo,
        item.itemDescription,
        item.vendorName,
        item.location,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedPickerQuery)
    );
  }, [dispatchableItems, itemPickerQuery]);

  const pendingReceipts = useMemo(() => {
    return dispatchRecords.filter((record) => {
      const wasSentFromActiveProject = record.sourceProjectNo === activeProjectNo;
      const matchesQuery =
        !normalizedQuery ||
        [
          record.dispatchNo,
          record.sourceProjectNo,
          record.sourceProjectName,
          record.destinationProjectNo,
          record.destinationProjectName,
          record.transport,
          record.note,
          record.dispatchedByName,
          ...record.items.map((item) => `${item.receiveNo} ${item.prNo} ${item.itemDescription}`),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      return wasSentFromActiveProject &&
        (record.status === 'Pending Receipt' || record.status === 'Dispatch Cancelled') &&
        matchesQuery;
    });
  }, [activeProjectNo, dispatchRecords, normalizedQuery]);

  const selectedDraftItems = useMemo(() => {
    return selectedItems
      .map((item) => ({
        item,
        qty: Number(dispatchQuantities[getStockItemId(item)] || 0),
      }))
      .filter(({ qty }) => Number.isFinite(qty) && qty > 0);
  }, [dispatchQuantities, selectedItems]);

  const dispatchUnavailableReason = !canDispatch
    ? 'Dispatch creation is available for Store Center or Store Site.'
    : destinationProjects.length === 0
      ? 'No other active project is available as a destination.'
      : dispatchableItems.length === 0
        ? 'No available Store Inventory items with qty greater than 0 were found for the active project.'
        : '';
  const dispatchSubmitDisabledReason = !selectedProject
    ? 'Please select a destination project.'
    : selectedItems.length === 0
      ? 'Please select at least one Store Inventory item.'
      : selectedDraftItems.length === 0
        ? 'Please enter dispatch qty greater than 0 for at least one selected item.'
        : '';

  const resetModalState = () => {
    photoUrls.forEach((url) => URL.revokeObjectURL(url));
    setTransport('');
    setNote('');
    setPhotoFiles([]);
    setPhotoUrls([]);
    setPhotoNames([]);
    setSelectedItemIds([]);
    setUploadError('');
    setSubmitError('');
    setDispatchQuantities({});
    setSelectedProject(destinationProjects[0]?.projectNo ?? '');
    setItemPickerQuery('');
    setIsItemPickerOpen(false);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetModalState();
  };

  const handleOpenModal = () => {
    if (!canDispatch) {
      return;
    }

    resetModalState();
    setIsModalOpen(true);
  };

  const handleQtyChange = (stockItemId: string, value: string) => {
    if (value !== '' && !/^\d+$/.test(value)) {
      return;
    }

    setSubmitError('');
    setDispatchQuantities((current) => ({
      ...current,
      [stockItemId]: value,
    }));
  };

  const toggleSelectedItem = (stockItemId: string) => {
    setSubmitError('');
    setSelectedItemIds((current) => {
      if (current.includes(stockItemId)) {
        setDispatchQuantities((quantities) => {
          const next = { ...quantities };
          delete next[stockItemId];
          return next;
        });
        return current.filter((id) => id !== stockItemId);
      }

      setDispatchQuantities((quantities) => ({
        ...quantities,
        [stockItemId]: quantities[stockItemId] || '1',
      }));
      return [...current, stockItemId];
    });
  };

  const removeSelectedItem = (stockItemId: string) => {
    setSubmitError('');
    setSelectedItemIds((current) => current.filter((id) => id !== stockItemId));
    setDispatchQuantities((current) => {
      const next = { ...current };
      delete next[stockItemId];
      return next;
    });
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }

    const allowedCount = Math.max(0, 5 - photoFiles.length);
    const nextFiles = files.slice(0, allowedCount);

    if (!nextFiles.length) {
      setUploadError('You can attach up to 5 photos per dispatch request.');
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

  const handleDispatchSubmit = async () => {
    if (isSubmitting) {
      return;
    }

    if (!activeProjectNo) {
      setSubmitError('Please select an active source project.');
      return;
    }

    if (dispatchSubmitDisabledReason) {
      setSubmitError(dispatchSubmitDisabledReason);
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    try {
      await createDispatch({
        sourceProjectNo: activeProjectNo,
        items: selectedDraftItems.map(({ item, qty }) => ({
          receiveNo: getStockItemId(item),
          qty: Math.min(qty, item.qty),
        })),
        projectNo: selectedProject,
        transport,
        note,
        photos: photoFiles,
      });
      closeModal();
    } catch (error) {
      console.error('Failed to create dispatch:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to create dispatch. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openPendingReceiptDetail = (record: DispatchRecord) => {
    setSelectedPendingReceipt(record);
  };

  const closePendingReceiptDetail = () => {
    setSelectedPendingReceipt(null);
  };

  const handleCancelDispatch = async (record: DispatchRecord) => {
    if (!canCancelDispatch || cancellingDispatchId || record.status !== 'Pending Receipt') {
      return;
    }

    const confirmed = window.confirm(
      `ยืนยันการยกเลิกรายการจัดส่ง ${record.dispatchNo}? จำนวนสินค้าจะถูกคืนกลับไปยัง Store ต้นทาง`
    );
    if (!confirmed) {
      return;
    }

    setCancellingDispatchId(record.id);
    try {
      await cancelDispatch(record.id);
    } catch (error) {
      console.error('Failed to cancel dispatch:', error);
      window.alert(error instanceof Error ? error.message : 'Failed to cancel the dispatch. Please try again.');
    } finally {
      setCancellingDispatchId(null);
    }
  };

  return (
    <div>
      <div className={styles.toolbar}>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="ค้นหารายการจัดส่งที่รอรับ"
        />
        <button
          className={styles.primaryButton}
          type="button"
          disabled={!canDispatch}
          onClick={handleOpenModal}
          title={dispatchUnavailableReason || 'สร้างรายการจัดส่ง'}
        >
          <Send size={16} />
          <span>จัดส่งรายการที่เลือก</span>
        </button>
      </div>

      {!canDispatch ? (
        <div className={styles.notice}>
          Dispatch creation is available for Store Center or Store Site. Destination projects receive moved items from Receiving, tab ย้ายโครงการ.
        </div>
      ) : null}

      {canDispatch && approvedBorrowRequests.length > 0 ? (
        <div className={styles.notice}>
          มีคำขอยืมที่อนุมัติแล้ว {approvedBorrowRequests.length} รายการ — กรุณาเลือก EQM และโครงการปลายทางในหน้าจัดส่งนี้เพื่อทำ Dispatch ตามปกติ
        </div>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>รอการรับสินค้า</h2>
            <p>รายการที่โปรเจกต์ปัจจุบันส่งออกแล้ว รอปลายทางรับเข้าที่ Receiving แท็บ ย้ายโครงการ</p>
          </div>
          <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
        </div>

        <div className="tableScroll">
          <table className={`table compact ${styles.dispatchTable}`}>
            <thead>
              <tr>
                <th>เลขที่จัดส่ง</th><th>เส้นทาง</th><th>วันที่จัดส่ง</th><th>ทะเบียนรถ</th><th>รายการ</th><th>เอกสารแนบ</th><th>ผู้ส่ง</th><th>สถานะ</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingReceipts.map((record) => (
                <tr
                  key={record.id}
                  className={styles.clickableRow}
                  onClick={() => openPendingReceiptDetail(record)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openPendingReceiptDetail(record);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Open dispatch ${record.dispatchNo} details`}
                >
                  <td>
                    <span className={styles.dispatchCode}>{record.dispatchNo}</span>
                  </td>
                  <td>
                    <strong
                      className={styles.destinationProjectNo}
                      title={`ปลายทาง: ${record.destinationProjectNo}${record.destinationProjectName ? ` - ${record.destinationProjectName}` : ''}`}
                    >
                      {normalizeProjectNo(record.destinationProjectNo) || '-'}
                    </strong>
                  </td>
                  <td>{formatDateTime(record.dispatchedAt)}</td>
                  <td>{record.transport || '-'}</td>
                  <td>
                    <div className={styles.itemStack}>
                      {record.items.map((item) => (
                        <span key={`${record.id}-${item.stockReceiveNo}`} className={styles.itemChip}>
                          <span title={item.itemDescription}>{item.itemDescription}</span>
                        </span>
                      ))}
                      {record.note ? <span className={styles.noteText}>Note: {record.note}</span> : null}
                    </div>
                  </td>
                  <td>
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
                      <span className={styles.mutedText}>ไม่มีรูปภาพ</span>
                    )}
                  </td>
                  <td>{record.dispatchedByName}</td>
                  <td>
                    <StatusBadge status={record.status} />
                  </td>
                  <td className={styles.actionCell}>
                    {record.status === 'Pending Receipt' ? (
                      <button
                        type="button"
                        className={styles.cancelButton}
                        disabled={!canCancelDispatch || cancellingDispatchId === record.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCancelDispatch(record);
                        }}
                        title={canCancelDispatch ? 'ยกเลิกรายการจัดส่งและคืนยอดไปยัง Store ต้นทาง' : 'เฉพาะ Store Center สามารถยกเลิกรายการจัดส่งได้'}
                      >
                        {cancellingDispatchId === record.id ? <span className={styles.spinner} /> : <X size={12} />}
                        <span>{cancellingDispatchId === record.id ? 'กำลังยกเลิก...' : 'ยกเลิก'}</span>
                      </button>
                    ) : (
                      <span className={styles.mutedText}>-</span>
                    )}
                  </td>
                </tr>
              ))}
              {pendingReceipts.length === 0 ? (
                <tr>
                  <td colSpan={9} className={styles.empty}>
                    No outgoing dispatch records are waiting for receipt from this active project.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {isModalOpen ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <h3>สร้างรายการจัดส่ง</h3>
                <p>เลือกรายการจากคลังของโครงการปัจจุบัน ระบุจำนวน แล้วเลือกโครงการปลายทาง</p>
              </div>
              <button type="button" className={styles.iconButton} onClick={closeModal} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalInfo}>
                <span>โครงการต้นทาง</span>
                <strong>{activeProject ? `Project ${activeProject.projectNo} - ${activeProject.projectName}` : '-'}</strong>
              </div>

              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>โครงการปลายทาง</span>
                  {destinationProjects.length > 0 ? (
                    <select
                      className={styles.select}
                      value={selectedProject}
                      onChange={(event) => setSelectedProject(event.target.value)}
                    >
                      {destinationProjects.map((project) => (
                        <option key={project.projectNo} value={project.projectNo}>
                          Project {project.projectNo} - {project.projectName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className={styles.emptyInline}>ไม่มีโครงการที่ใช้งานอยู่อื่น</div>
                  )}
                </label>

                <label className={styles.field}>
                  <span>ทะเบียนรถ</span>
                  <input
                    className={styles.input}
                    type="text"
                    value={transport}
                    onChange={(event) => setTransport(event.target.value)}
                    placeholder="ทะเบียนรถบรรทุกหรือยานพาหนะ"
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
                    No items selected. Click Select to choose available Store Inventory items.
                  </div>
                ) : (
                  <div className={styles.selectedItemsTable}>
                    <div className={styles.selectedItemsHead}>
                      <span>เลขที่รับ</span><span>รายการ</span><span>คงเหลือ</span><span>จำนวนจัดส่ง</span><span>การดำเนินการ</span>
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
                              value={dispatchQuantities[stockItemId] ?? ''}
                              onChange={(event) => handleQtyChange(stockItemId, event.target.value)}
                              placeholder="0"
                            />
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
                <span>หมายเหตุ</span>
                <textarea
                  className={styles.textarea}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="ระบุหมายเหตุ คำขอเร่งด่วน หรือคำแนะนำในการจัดส่ง"
                  rows={4}
                />
              </label>

              <div className={styles.field}>
                <span>รูปภาพสินค้า</span>
                <label className={styles.uploadBox}>
                  <input type="file" accept="image/*" multiple onChange={handleFileChange} />
                  <ImagePlus size={18} />
                  <div>
                    <strong>อัปโหลดไปยัง Firebase Storage</strong>
                    <p>แนบรูปภาพสินค้าหรือยานพาหนะได้สูงสุด 5 รูป</p>
                  </div>
                </label>
                {uploadError ? <div className={styles.errorText}>{uploadError}</div> : null}
                {photoUrls.length > 0 ? (
                  <div className={styles.previewGrid}>
                    {photoUrls.map((url, index) => (
                      <div key={`${url.slice(0, 24)}-${index}`} className={styles.previewCard}>
                        <img src={url} alt={photoNames[index] || `Dispatch photo ${index + 1}`} />
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
                onClick={handleDispatchSubmit}
                title={dispatchSubmitDisabledReason || 'สร้างรายการจัดส่ง'}
              >
                {isSubmitting ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                <span>{isSubmitting ? 'Saving...' : 'Dispatch'}</span>
              </button>
            </div>
            {submitError ? <div className={styles.footerError}>{submitError}</div> : null}
          </div>

          {isItemPickerOpen ? (
            <div className={styles.modalOverlay}>
              <div className={`${styles.modal} ${styles.itemSelectModal}`}>
                <div className={styles.modalHeader}>
                  <div>
                    <h3>เลือกรายการสินค้าในคลัง</h3>
                    <p>เลือกรายการที่คงเหลืออย่างน้อยหนึ่งรายการจากคลังโครงการปัจจุบัน</p>
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
                          <th>เลือก</th><th>เลขที่รับ</th><th>รายการ</th><th>สถานที่ปัจจุบัน</th><th>ผู้ขาย</th><th className="numeric">จำนวนคงเหลือ</th>
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
                                <span className={styles.dispatchCode}>{item.receiveNo}</span>
                              </td>
                              <td>
                                <span className="itemSummary">
                                  <strong>{item.itemDescription}</strong>
                                  <span className="itemCode">{item.itemNo}</span>
                                </span>
                              </td>
                              <td>{item.location || '-'}</td>
                              <td>{item.vendorName || '-'}</td>
                              <td className="numeric">{item.qty.toLocaleString()}</td>
                            </tr>
                          );
                        })}
                        {pickerItems.length === 0 ? (
                          <tr>
                            <td colSpan={6} className={styles.empty}>
                              No available Store Inventory items matched the current search.
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

      {selectedPendingReceipt ? (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modal} ${styles.detailModal}`}>
            <div className={styles.modalHeader}>
              <div>
                <h3>รายละเอียดการจัดส่ง</h3>
                <p>ตรวจสอบรายการจัดส่งที่รอรับ ณ โครงการปลายทาง</p>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                onClick={closePendingReceiptDetail}
                aria-label="Close dispatch details"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.detailHero}>
                <div className={styles.modalInfo}>
                  <span>เลขที่จัดส่ง</span>
                  <strong>{selectedPendingReceipt.dispatchNo}</strong>
                </div>
                <StatusBadge status={selectedPendingReceipt.status} />
              </div>

              <div className={styles.detailGrid}>
                <div className={styles.detailCard}>
                  <span>เส้นทาง</span>
                  <strong>
                    {selectedPendingReceipt.sourceProjectNo || '-'} to {selectedPendingReceipt.destinationProjectNo || '-'}
                  </strong>
                  <p>
                    {selectedPendingReceipt.sourceProjectName || 'Unknown source project'} to{' '}
                    {selectedPendingReceipt.destinationProjectName || 'Unknown destination project'}
                  </p>
                </div>

                <div className={styles.detailCard}>
                  <span>ทะเบียนรถ</span>
                  <strong>{selectedPendingReceipt.transport || '-'}</strong>
                  <p>Dispatched at {formatDateTime(selectedPendingReceipt.dispatchedAt)}</p>
                </div>

                <div className={styles.detailCard}>
                  <span>ผู้ส่ง</span>
                  <strong>{selectedPendingReceipt.dispatchedByName || '-'}</strong>
                  <p>{selectedPendingReceipt.dispatchedByEmail || '-'}</p>
                </div>

                <div className={styles.detailCard}>
                  <span>จำนวนรวม</span>
                  <strong>{selectedPendingReceipt.totalQty.toLocaleString()}</strong>
                  <p>{selectedPendingReceipt.items.length.toLocaleString()} item line(s)</p>
                </div>
              </div>

              <div className={styles.field}>
                <span>รายการ</span>
                <div className={styles.detailItemsTable}>
                  <div className={styles.detailItemsHead}>
                    <span>เลขที่รับ</span><span>PR / PO</span><span>รายการ</span><span>จำนวน</span><span>สถานที่ต้นทาง</span>
                  </div>
                  <div className={styles.selectedItemsBody}>
                    {selectedPendingReceipt.items.map((item) => (
                      <div key={`${selectedPendingReceipt.id}-${item.stockReceiveNo}`} className={styles.detailItemRow}>
                        <span>{item.receiveNo}</span>
                        <span>
                          {item.prNo || '-'}
                          <small>{item.poNo || '-'}</small>
                        </span>
                        <span>
                          {item.itemDescription || '-'}
                          <small>{item.itemNo || '-'}</small>
                        </span>
                        <span>{item.qty.toLocaleString()}</span>
                        <span>{item.sourceLocation || '-'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <span>หมายเหตุ</span>
                  <div className={styles.detailTextBlock}>
                    {selectedPendingReceipt.note?.trim() || 'No remark provided.'}
                  </div>
                </div>

                <div className={styles.field}>
                  <span>เอกสารแนบ</span>
                  {selectedPendingReceipt.photoUrls.length > 0 ? (
                    <div className={styles.photoList}>
                      {selectedPendingReceipt.photoUrls.map((url, index) => (
                        <a
                          key={`${selectedPendingReceipt.id}-detail-${index}`}
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
                    <div className={styles.detailTextBlock}>ไม่มีรูปภาพแนบ</div>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <div className={styles.selectionNote}>
                Waiting for receipt by Project {selectedPendingReceipt.destinationProjectNo || '-'}
              </div>
              <button type="button" className={styles.primaryButton} onClick={closePendingReceiptDetail}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
