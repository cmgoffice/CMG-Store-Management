import { CheckCircle2, ClipboardList, Download, FileUp, History, PackageCheck, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ITEM_TYPE_OPTIONS } from '../constants/itemTypes';
import { SearchField } from '../components/SearchField';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import type { DispatchRecord, ReceivingRequest, ReceivingRequestItem, StockItem } from '../types/models';
import { useSearchParams } from 'react-router-dom';
import { downloadStockCsvTemplate, parseStockCsv, type StockCsvRow } from '../utils/stockCsv';
import '../styles/tables.css';
import styles from './ReceivingPage.module.css';

type ReceivingTab = 'receive' | 'incoming' | 'log';

type ProjectGroup<T> = {
  projectCode: string;
  items: T[];
};

type HistoryEntry =
  | { kind: 'receive'; date: string; request: ReceivingRequest }
  | { kind: 'dispatch'; date: string; dispatch: DispatchRecord };

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatAmount(value: number) {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
}

function formatBadgeCount(count: number) {
  return count > 99 ? '99+' : String(count);
}

function getDispatchItemNames(items: DispatchRecord['items']) {
  return items.map((item) => item.itemDescription?.trim() || '-');
}

function createDispatchReceiveQtyDraft(record: DispatchRecord) {
  return record.items.reduce<Record<string, string>>((acc, item) => {
    acc[item.stockReceiveNo] = String(item.qty);
    return acc;
  }, {});
}

function createRequestReceiveQtyDraft(request: ReceivingRequest) {
  return request.items.reduce<Record<string, string>>((acc, item, index) => {
    acc[String(index)] = String(item.receivedQty);
    return acc;
  }, {});
}

function normalizeMaterialNo(value?: string) {
  return value?.trim().toUpperCase().replace(/\s+/g, '') ?? '';
}

function getDefaultItemTypeFromMaterialNo(item: ReceivingRequestItem) {
  const materialNo = normalizeMaterialNo(item.materialNo || item.itemNo).replace(/[^A-Z0-9]/g, '');
  const matchedOption = [...ITEM_TYPE_OPTIONS]
    .sort((left, right) => right.code.length - left.code.length)
    .find((option) => materialNo.startsWith(option.code.toUpperCase().replace(/[^A-Z0-9]/g, '')));

  return matchedOption?.code ?? '';
}

function findExistingStockItem(stockItems: StockItem[], request: ReceivingRequest, item: ReceivingRequestItem) {
  const projectCode = getRequestProjectCode(request);
  const materialNo = normalizeMaterialNo(item.materialNo || item.itemNo);

  if (!projectCode || !materialNo) {
    return undefined;
  }

  return stockItems.find((stockItem) => (
    normalizeProjectNoText(stockItem.cmgProjectCode || stockItem.projectId) === projectCode &&
    normalizeMaterialNo(stockItem.materialNo || stockItem.itemNo) === materialNo
  ));
}

function createRequestItemTypeDraft(request: ReceivingRequest, stockItems: StockItem[]) {
  return request.items.reduce<Record<string, string>>((acc, item, index) => {
    const existingStockItem = findExistingStockItem(stockItems, request, item);
    acc[String(index)] = existingStockItem?.itemType || item.itemType || getDefaultItemTypeFromMaterialNo(item);
    return acc;
  }, {});
}

function getProjectNoLastFive(value?: string) {
  const text = value?.trim() ?? '';
  return text ? text.slice(-5) : '-';
}

function normalizeProjectNoText(value?: string) {
  const text = value?.trim() ?? '';
  if (!text) {
    return '';
  }

  const projectMatch = text.match(/\bJ[-\s]?0*([0-9]+[a-z0-9]*)\b/i);
  if (projectMatch) {
    return `J${projectMatch[1].toUpperCase()}`;
  }

  const plainProjectMatch = text.match(/\b0*([0-9]+[a-z0-9]*)\b/i);
  if (plainProjectMatch) {
    return `J${plainProjectMatch[1].toUpperCase()}`;
  }

  return text;
}

function getRequestProjectCode(request: ReceivingRequest) {
  return normalizeProjectNoText(
    request.cmgProjectCode ||
      request.projectItemCode ||
      request.projectNo ||
      request.projectId ||
      request.projectName ||
      request.location,
  );
}

function getReceivingSourceLabel(request: ReceivingRequest) {
  return request.sourceApp?.trim().toLowerCase() === 'project transfer'
    ? 'รับเข้าจากการย้ายโครงการ'
    : request.sourceApp || 'รับเข้าใหม่';
}

function getDispatchDestinationProjectCode(record: DispatchRecord) {
  return normalizeProjectNoText(record.destinationProjectNo || record.destinationProjectName);
}

function createProjectGroups<T>(items: T[], getProjectCode: (item: T) => string) {
  const grouped = new Map<string, T[]>();

  items.forEach((item) => {
    const projectCode = getProjectCode(item) || 'Unassigned';
    const existing = grouped.get(projectCode);

    if (existing) {
      existing.push(item);
      return;
    }

    grouped.set(projectCode, [item]);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => {
      if (left === 'Unassigned') return 1;
      if (right === 'Unassigned') return -1;
      return left.localeCompare(right);
    })
    .map(([projectCode, groupedItems]) => ({
      projectCode,
      items: groupedItems,
    } satisfies ProjectGroup<T>));
}

export function ReceivingPage() {
  const {
    projects,
    activeProjects,
    stockItems,
    receivingRequests,
    dispatchRecords,
    approveReceivingRequest,
    receiveDispatch,
    importStockItems,
    deleteReceivingRequest,
    activeProjectNo,
  } = useInventory();
  const { canApproveReceipt, hasRole } = useRole();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<ReceivingTab>(tabParam === 'incoming' || tabParam === 'log' ? tabParam : 'receive');
  const [query, setQuery] = useState('');
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [receivingRequest, setReceivingRequest] = useState<ReceivingRequest | null>(null);
  const [requestReceiveQtyDraft, setRequestReceiveQtyDraft] = useState<Record<string, string>>({});
  const [requestItemTypeDraft, setRequestItemTypeDraft] = useState<Record<string, string>>({});
  const [requestReceiveError, setRequestReceiveError] = useState('');
  const [approvingIncomingDispatchId, setApprovingIncomingDispatchId] = useState<string | null>(null);
  const [selectedIncomingDispatch, setSelectedIncomingDispatch] = useState<DispatchRecord | null>(null);
  const [receivingIncomingDispatch, setReceivingIncomingDispatch] = useState<DispatchRecord | null>(null);
  const [incomingReceiveQtyDraft, setIncomingReceiveQtyDraft] = useState<Record<string, string>>({});
  const [incomingReceiveError, setIncomingReceiveError] = useState('');
  const [importRows, setImportRows] = useState<StockCsvRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [deletingHistoryItem, setDeletingHistoryItem] = useState('');
  const [historyActionError, setHistoryActionError] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tabParam === 'incoming' || tabParam === 'log' || tabParam === 'receive') {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const activeProject = activeProjects.find((project) => project.projectNo === activeProjectNo)
    ?? projects.find((project) => project.projectNo === activeProjectNo);
  const normalizedActiveProjectNo = normalizeProjectNoText(activeProjectNo);
  const normalizedQuery = query.trim().toLowerCase();
  const importPreviewRows = useMemo(() => {
    const groupedRows = new Map<string, StockCsvRow>();
    importRows.forEach((row) => {
      const itemNo = normalizeMaterialNo(row.itemNo);
      const existingRow = groupedRows.get(itemNo);
      if (existingRow) {
        existingRow.qty += row.qty;
      } else {
        groupedRows.set(itemNo, { ...row, itemNo });
      }
    });

    return Array.from(groupedRows.values()).map((row) => {
      const existingItem = stockItems.find((item) => (
        item.status !== 'In Transit' &&
        normalizeProjectNoText(item.cmgProjectCode || item.projectId || item.purchasedForProject || item.location) === normalizedActiveProjectNo &&
        normalizeMaterialNo(item.materialNo || item.itemNo) === row.itemNo
      ));
      const existingQty = existingItem?.qty ?? 0;
      return {
        ...row,
        existingQty,
        finalQty: existingQty + row.qty,
        existingDescription: existingItem?.itemDescription ?? '',
      };
    });
  }, [importRows, normalizedActiveProjectNo, stockItems]);

  const filteredRequests = useMemo(() => {
    return receivingRequests.filter((request) => {
      const cmgProjectCode = getRequestProjectCode(request);
      const isForActiveProject =
        !normalizedActiveProjectNo ||
        cmgProjectCode === normalizedActiveProjectNo;
      const matchesQuery =
        !normalizedQuery ||
        [
          request.receiveNo,
          request.poNo,
          request.prNo,
          request.poType,
          request.projectNo,
          request.projectName,
          request.location,
          request.vendorName,
          request.receiveName,
          request.receivedByName,
          request.note,
          request.sourceApp,
          request.cmgProjectCode,
          request.projectItemCode,
          cmgProjectCode,
          ...request.items.map((item) => `${item.itemNo} ${item.itemDescription} ${item.materialNo ?? ''}`),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      return isForActiveProject && matchesQuery;
    });
  }, [normalizedActiveProjectNo, normalizedQuery, receivingRequests]);

  const pendingRequests = useMemo(
    () => filteredRequests.filter((request) => request.requestStatus === 'pending'),
    [filteredRequests],
  );
  const approvedRequests = useMemo(
    () => filteredRequests.filter((request) => request.requestStatus === 'approved'),
    [filteredRequests],
  );
  const pendingRequestsBadgeCount = useMemo(() => {
    return receivingRequests.filter((request) => {
      const cmgProjectCode = getRequestProjectCode(request);
      return (
        request.requestStatus === 'pending' &&
        (!normalizedActiveProjectNo || cmgProjectCode === normalizedActiveProjectNo)
      );
    }).length;
  }, [normalizedActiveProjectNo, receivingRequests]);
  const incomingDispatches = useMemo(() => {
    return dispatchRecords.filter((record) => {
      const cmgProjectCode = getDispatchDestinationProjectCode(record);
      const isForActiveProject =
        !normalizedActiveProjectNo ||
        cmgProjectCode === normalizedActiveProjectNo;
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
          cmgProjectCode,
          ...record.items.map((item) => `${item.receiveNo} ${item.prNo} ${item.poNo} ${item.itemNo} ${item.itemDescription} ${item.vendorName}`),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      return record.status === 'Pending Receipt' && isForActiveProject && matchesQuery;
    });
  }, [dispatchRecords, normalizedActiveProjectNo, normalizedQuery]);
  const incomingDispatchesBadgeCount = useMemo(() => {
    return dispatchRecords.filter((record) => {
      const cmgProjectCode = getDispatchDestinationProjectCode(record);
      return (
        record.status === 'Pending Receipt' &&
        (!normalizedActiveProjectNo || cmgProjectCode === normalizedActiveProjectNo)
      );
    }).length;
  }, [dispatchRecords, normalizedActiveProjectNo]);

  const outgoingDispatches = useMemo(() => {
    return dispatchRecords.filter((record) => {
      const sourceProjectCode = normalizeProjectNoText(record.sourceProjectNo);
      const isForActiveProject =
        !normalizedActiveProjectNo || sourceProjectCode === normalizedActiveProjectNo;
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
          record.status,
          ...record.items.map((item) => `${item.receiveNo} ${item.prNo} ${item.poNo} ${item.itemNo} ${item.itemDescription} ${item.vendorName}`),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      return isForActiveProject && matchesQuery;
    });
  }, [dispatchRecords, normalizedActiveProjectNo, normalizedQuery]);

  const pendingRequestGroups = useMemo(
    () => createProjectGroups(pendingRequests, getRequestProjectCode),
    [pendingRequests],
  );
  const incomingDispatchGroups = useMemo(
    () => createProjectGroups(incomingDispatches, getDispatchDestinationProjectCode),
    [incomingDispatches],
  );
  const historyEntries = useMemo<HistoryEntry[]>(() => (
    [
      ...approvedRequests.map((request) => ({
        kind: 'receive' as const,
        date: request.approvedAt || request.receiveDate || request.requestedAt,
        request,
      })),
      ...outgoingDispatches.map((dispatch) => ({
        kind: 'dispatch' as const,
        date: dispatch.dispatchedAt,
        dispatch,
      })),
    ].sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
  ), [approvedRequests, outgoingDispatches]);

  const openRequestReceiveModal = (request: ReceivingRequest) => {
    setRequestReceiveError('');
    setReceivingRequest(request);
    setRequestReceiveQtyDraft(createRequestReceiveQtyDraft(request));
    setRequestItemTypeDraft(createRequestItemTypeDraft(request, stockItems));
  };

  const closeRequestReceiveModal = () => {
    if (approvingRequestId) {
      return;
    }

    setRequestReceiveError('');
    setReceivingRequest(null);
    setRequestReceiveQtyDraft({});
    setRequestItemTypeDraft({});
  };

  const handleRequestReceiveQtyChange = (itemIndex: number, value: string) => {
    const normalizedValue = value.replace(/[^\d]/g, '');
    setRequestReceiveQtyDraft((current) => ({
      ...current,
      [String(itemIndex)]: normalizedValue,
    }));
  };

  const handleRequestItemTypeChange = (itemIndex: number, value: string) => {
    setRequestItemTypeDraft((current) => ({
      ...current,
      [String(itemIndex)]: value,
    }));
  };

  const handleConfirmRequestReceive = async () => {
    if (!receivingRequest || approvingRequestId) {
      return;
    }

    const receivedItems = receivingRequest.items.map((item, itemIndex) => {
      const parsedQty = Number.parseInt(requestReceiveQtyDraft[String(itemIndex)] ?? String(item.receivedQty), 10);
      const itemType = requestItemTypeDraft[String(itemIndex)] ?? '';
      const existingStockItem = findExistingStockItem(stockItems, receivingRequest, item);
      const typeOption = ITEM_TYPE_OPTIONS.find((option) => option.code === itemType);
      return {
        itemIndex,
        itemDescription: item.itemDescription,
        maxQty: item.receivedQty,
        receivedQty: Number.isFinite(parsedQty) ? parsedQty : Number.NaN,
        itemType,
        itemTypeGroup: typeOption?.group ?? existingStockItem?.itemTypeGroup,
        isExistingItem: Boolean(existingStockItem),
      };
    });
    const hasInvalidQty = receivedItems.some(
      (item) => !Number.isInteger(item.receivedQty) || item.receivedQty < 0 || item.receivedQty > item.maxQty
    );

    if (hasInvalidQty) {
      setRequestReceiveError('กรุณาระบุจำนวนเต็มตั้งแต่ 0 ถึงจำนวนที่ขอสำหรับทุกรายการ');
      return;
    }
    if (!receivedItems.some((item) => item.receivedQty > 0)) {
      setRequestReceiveError('กรุณาระบุจำนวนรับเข้าอย่างน้อย 1 รายการ');
      return;
    }
    if (receivedItems.some((item) => item.receivedQty > 0 && !item.itemTypeGroup && !item.isExistingItem)) {
      setRequestReceiveError('กรุณาเลือก Type สำหรับทุกรายการที่รับเข้า');
      return;
    }

    setRequestReceiveError('');
    setApprovingRequestId(receivingRequest.id);
    try {
      await approveReceivingRequest(
        receivingRequest.id,
        receivedItems.map(({ itemIndex, receivedQty, itemType, itemTypeGroup }) => ({
          itemIndex,
          receivedQty,
          itemType,
          itemTypeGroup,
        }))
      );
      setReceivingRequest(null);
      setRequestReceiveQtyDraft({});
      setRequestItemTypeDraft({});
    } catch (error) {
      console.error('Failed to receive request into inventory:', error);
      setRequestReceiveError(error instanceof Error ? error.message : 'ไม่สามารถบันทึกจำนวนรับเข้าได้ กรุณาลองใหม่');
    } finally {
      setApprovingRequestId(null);
    }
  };

  const openIncomingDispatchDetail = (record: DispatchRecord) => {
    setSelectedIncomingDispatch(record);
  };

  const closeIncomingDispatchDetail = () => {
    setSelectedIncomingDispatch(null);
  };

  const openIncomingReceiveModal = (record: DispatchRecord) => {
    setIncomingReceiveError('');
    setReceivingIncomingDispatch(record);
    setIncomingReceiveQtyDraft(createDispatchReceiveQtyDraft(record));
  };

  const closeIncomingReceiveModal = () => {
    if (approvingIncomingDispatchId) {
      return;
    }

    setIncomingReceiveError('');
    setReceivingIncomingDispatch(null);
    setIncomingReceiveQtyDraft({});
  };

  const handleIncomingReceiveQtyChange = (stockReceiveNo: string, value: string) => {
    const normalizedValue = value.replace(/[^\d]/g, '');
    setIncomingReceiveQtyDraft((current) => ({
      ...current,
      [stockReceiveNo]: normalizedValue,
    }));
  };

  const handleConfirmIncomingReceive = async () => {
    if (!receivingIncomingDispatch || approvingIncomingDispatchId) {
      return;
    }

    const receivedItems = receivingIncomingDispatch.items.map((item) => {
      const parsedQty = Number.parseInt(incomingReceiveQtyDraft[item.stockReceiveNo] ?? String(item.qty), 10);
      const receivedQty = Number.isFinite(parsedQty) ? parsedQty : Number.NaN;

      return {
        stockReceiveNo: item.stockReceiveNo,
        itemDescription: item.itemDescription,
        maxQty: item.qty,
        receivedQty,
      };
    });

    const hasInvalidQty = receivedItems.some(
      (item) => !Number.isInteger(item.receivedQty) || item.receivedQty < 0 || item.receivedQty > item.maxQty
    );

    if (hasInvalidQty) {
      setIncomingReceiveError('Please enter whole numbers between 0 and the dispatched qty for every item.');
      return;
    }

    if (!receivedItems.some((item) => item.receivedQty > 0)) {
      setIncomingReceiveError('At least one item must have a received qty greater than 0.');
      return;
    }

    setIncomingReceiveError('');
    setApprovingIncomingDispatchId(receivingIncomingDispatch.id);
    try {
      await receiveDispatch(
        receivingIncomingDispatch.id,
        receivedItems.map((item) => ({
          stockReceiveNo: item.stockReceiveNo,
          receivedQty: item.receivedQty,
        }))
      );
      setIncomingReceiveError('');
      setReceivingIncomingDispatch(null);
      setIncomingReceiveQtyDraft({});
      setSelectedIncomingDispatch(null);
    } catch (error) {
      console.error('Failed to receive incoming dispatch:', error);
      setIncomingReceiveError('Could not save the received quantities. Please try again.');
    } finally {
      setApprovingIncomingDispatchId(null);
    }
  };

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImportMessage('');
    setImportFileName(file.name);
    try {
      const result = parseStockCsv(await file.text());
      setImportRows(result.rows);
      setImportErrors(result.errors);
      setImportWarnings(result.warnings);
    } catch {
      setImportRows([]);
      setImportErrors(['ไม่สามารถอ่านไฟล์ CSV นี้ได้']);
      setImportWarnings([]);
    }
  };

  const closeImportModal = () => {
    if (isImporting) return;
    setImportRows([]);
    setImportErrors([]);
    setImportWarnings([]);
    setImportFileName('');
  };

  const handleConfirmImport = async () => {
    if (!activeProjectNo || importRows.length === 0 || importErrors.length > 0 || isImporting) return;
    setIsImporting(true);
    try {
      await importStockItems({ projectNo: activeProjectNo, items: importRows });
      const totalQty = importPreviewRows.reduce((sum, row) => sum + row.qty, 0);
      setImportMessage(`นำเข้า ${importPreviewRows.length.toLocaleString()} รหัสสินค้า รวม ${totalQty.toLocaleString()} ชิ้น ไปยังโครงการ ${activeProjectNo} สำเร็จ`);
      setImportRows([]);
      setImportErrors([]);
      setImportWarnings([]);
      setImportFileName('');
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : 'นำเข้าสินค้าไม่สำเร็จ กรุณาลองใหม่']);
    } finally {
      setIsImporting(false);
    }
  };

  const handleDeleteHistoryRequest = async (request: ReceivingRequest) => {
    const totalQty = request.items.reduce((sum, item) => sum + item.receivedQty, 0);
    const confirmed = window.confirm(
      `ยืนยันลบ Request ID ${request.id}?\n\nระบบจะลบทั้ง ${request.items.length.toLocaleString()} รายการ รวม ${totalQty.toLocaleString()} ชิ้นออกจากสต็อก การดำเนินการนี้ย้อนกลับไม่ได้`
    );
    if (!confirmed) return;

    setDeletingHistoryItem(request.id);
    setHistoryActionError('');
    try {
      await deleteReceivingRequest(request.id);
    } catch (error) {
      setHistoryActionError(error instanceof Error ? error.message : 'ลบรายการรับเข้าไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setDeletingHistoryItem('');
    }
  };

  return (
    <div>
      <div className={styles.toolbar}>
        <input
          ref={importInputRef}
          className={styles.hiddenFileInput}
          type="file"
          accept=".csv,text/csv"
          onChange={handleImportFileChange}
        />
        <button type="button" className={styles.headerButton} onClick={downloadStockCsvTemplate}>
          <Download size={16} />
          Download template
        </button>
        <button
          type="button"
          className={`${styles.headerButton} ${styles.importButton}`}
          disabled={!activeProjectNo || !canApproveReceipt}
          title={!activeProjectNo ? 'กรุณาเลือกโครงการก่อนนำเข้า' : undefined}
          onClick={() => importInputRef.current?.click()}
        >
          <FileUp size={16} />
          Import CSV
        </button>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={
            activeTab === 'log'
              ? 'Search receive log, PR, CMG project code'
              : 'Search receive no, PR, vendor, CMG project code'
          }
        />
      </div>

      {importMessage ? <div className={styles.successNotice}>{importMessage}</div> : null}

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'receive' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('receive')}
        >
          <span>รับเข้าใหม่</span>
          {pendingRequestsBadgeCount > 0 ? (
            <span className={styles.tabBadge}>{formatBadgeCount(pendingRequestsBadgeCount)}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'incoming' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('incoming')}
        >
          <span>ย้ายโครงการ</span>
          {incomingDispatchesBadgeCount > 0 ? (
            <span className={styles.tabBadge}>{formatBadgeCount(incomingDispatchesBadgeCount)}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'log' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('log')}
        >
          ประวัติการเข้า-ออก
        </button>
      </div>

      {!canApproveReceipt && activeTab !== 'log' ? (
        <div className={styles.notice}>
          Your current role can review receiving requests, but cannot approve them into inventory.
        </div>
      ) : null}

      {activeTab === 'receive' ? (
        <>
          <div className={styles.summaryGrid}>
            <article className={styles.summaryCard}>
              <div className={styles.summaryIcon}>
                <ClipboardList size={18} />
              </div>
              <div>
                <div className={styles.summaryLabel}>คำขอที่รอดำเนินการ</div>
                <div className={styles.summaryValue}>{pendingRequests.length}</div>
              </div>
            </article>
            <article className={styles.summaryCard}>
              <div className={styles.summaryIcon}>
                <PackageCheck size={18} />
              </div>
              <div>
                <div className={styles.summaryLabel}>จำนวนที่รอดำเนินการ</div>
                <div className={styles.summaryValue}>
                  {pendingRequests.reduce((sum, request) => sum + request.totalQty, 0).toLocaleString()}
                </div>
              </div>
            </article>
            <article className={styles.summaryCard}>
              <div className={styles.summaryIcon}>
                <History size={18} />
              </div>
              <div>
                <div className={styles.summaryLabel}>รายการรับที่บันทึกแล้ว</div>
                <div className={styles.summaryValue}>{approvedRequests.length}</div>
              </div>
            </article>
          </div>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>คำขอรับสินค้าที่รอดำเนินการ</h2>
                <p>คำขอจะถูกจัดกลุ่มตามรหัสโครงการ CMG ก่อนสร้างรายการสินค้าคงคลัง</p>
              </div>
              <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
            </div>

            {pendingRequestGroups.length === 0 ? (
              <div className={styles.empty}>ไม่พบคำขอรับสินค้าที่รอดำเนินการตามเงื่อนไข</div>
            ) : pendingRequestGroups.map((group) => (
              <section key={group.projectCode} className={styles.projectGroup}>
                <div className={styles.projectGroupHeader}>
                  <div>
                    <div className={styles.projectCodeBadge}>CMG Project Code: {group.projectCode}</div>
                    <div className={styles.groupMeta}>
                      {group.items.length} request(s) / {group.items.reduce((sum, request) => sum + request.totalQty, 0).toLocaleString()} qty
                    </div>
                  </div>
                </div>

                <div className="tableScroll">
                  <table className={`table compact ${styles.receivingTable}`}>
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Request ID</th>
                        <th>PR</th>
                        <th>Description</th>
                        <th className="numeric">Qty</th>
                        <th className="numeric">Amount</th>
                        <th>Requested</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.flatMap((request, requestIndex) => (
                        request.items.map((item, itemIndex) => (
                          <tr key={`${request.id}-${itemIndex}`} className={itemIndex === 0 ? styles.requestRowStart : undefined}>
                            {itemIndex === 0 ? (
                              <>
                                <td rowSpan={request.items.length}>{requestIndex + 1}</td>
                                <td rowSpan={request.items.length}>
                                  <span className={styles.receiveCode}>{request.id}</span>
                                </td>
                                <td rowSpan={request.items.length} className={styles.prCell}>{request.prNo || '-'}</td>
                              </>
                            ) : null}
                            <td className={styles.descriptionCell}>{item.itemDescription?.trim() || '-'}</td>
                            <td className="numeric">{item.receivedQty.toLocaleString()}</td>
                            <td className="numeric">{formatAmount(item.amount)}</td>
                            {itemIndex === 0 ? (
                              <>
                                <td rowSpan={request.items.length}>{formatDateTime(request.requestedAt)}</td>
                                <td rowSpan={request.items.length}>
                                  <StatusBadge status={request.requestStatus} />
                                </td>
                                <td rowSpan={request.items.length}>
                                  <button
                                    className={styles.approveButton}
                                    type="button"
                                    disabled={!canApproveReceipt || approvingRequestId !== null || request.items.length === 0}
                                    onClick={() => openRequestReceiveModal(request)}
                                  >
                                    {approvingRequestId === request.id ? (
                                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                      <CheckCircle2 size={16} />
                                    )}
                                    <span>{approvingRequestId === request.id ? 'Receiving...' : 'Receive into Inventory'}</span>
                                  </button>
                                </td>
                              </>
                            ) : null}
                          </tr>
                        ))
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </section>
        </>
      ) : activeTab === 'incoming' ? (
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>รายการย้ายโครงการที่รอดำเนินการ</h2>
              <p>รายการจัดส่งมายังโครงการปัจจุบันจะรออยู่ที่นี่ก่อนรับเข้าคลังโครงการ</p>
            </div>
            <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
          </div>

          {incomingDispatchGroups.length === 0 ? (
            <div className={styles.empty}>ไม่พบรายการย้ายโครงการตามเงื่อนไข</div>
          ) : incomingDispatchGroups.map((group) => (
            <section key={group.projectCode} className={styles.projectGroup}>
              <div className={styles.projectGroupHeader}>
                <div>
                  <div className={styles.projectCodeBadge}>Destination Project: {group.projectCode}</div>
                  <div className={styles.groupMeta}>
                    {group.items.length} request(s) / {group.items.reduce((sum, record) => sum + record.totalQty, 0).toLocaleString()} qty
                  </div>
                </div>
              </div>

              <div className="tableScroll">
                <table className={`table compact ${styles.receivingTable} ${styles.dispatchTable}`}>
                  <thead>
                    <tr>
                      <th>Dispatch No.</th>
                      <th>From</th>
                      <th>Dispatched At</th>
                      <th>Vehicle Plate</th>
                      <th>Items</th>
                      <th className="numeric">Qty</th>
                      <th>Dispatch By</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((record) => (
                      <tr
                        key={record.id}
                        className={`${styles.clickableRow} ${styles.actionRequiredRow}`}
                        onClick={() => openIncomingDispatchDetail(record)}
                      >
                        <td>
                          <span className={styles.receiveCode}>{record.dispatchNo}</span>
                        </td>
                        <td>{getProjectNoLastFive(record.sourceProjectNo)}</td>
                        <td>{formatDateTime(record.dispatchedAt)}</td>
                        <td>{record.transport || '-'}</td>
                        <td>
                          <div className={styles.itemStack}>
                            {getDispatchItemNames(record.items).map((itemName, index) => (
                              <span key={`${record.id}-${index}`} className={styles.itemChip}>
                                {itemName}
                              </span>
                            ))}
                            {record.note ? <span className={styles.noteText}>Note: {record.note}</span> : null}
                          </div>
                        </td>
                        <td className="numeric">{record.totalQty.toLocaleString()}</td>
                        <td>{record.dispatchedByName}</td>
                        <td>
                          <StatusBadge status={record.status} />
                        </td>
                        <td>
                          <button
                            className={styles.approveButton}
                            type="button"
                            disabled={!canApproveReceipt || approvingIncomingDispatchId !== null}
                            onClick={(event) => {
                              event.stopPropagation();
                              openIncomingReceiveModal(record);
                            }}
                          >
                            {approvingIncomingDispatchId === record.id ? (
                              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <CheckCircle2 size={16} />
                            )}
                            <span>{approvingIncomingDispatchId === record.id ? 'Receiving...' : 'Receive'}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </section>
      ) : (
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>ประวัติการเข้า-ออก</h2>
              <p>รวมรายการรับเข้าและทำออกจากการย้ายโครงการ เรียงตามวันที่ทำรายการล่าสุด</p>
            </div>
            <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
          </div>

          {historyActionError ? <div className={styles.historyError}>{historyActionError}</div> : null}
          {historyEntries.length === 0 ? (
            <div className={styles.empty}>ไม่พบประวัติการเข้า-ออกตามเงื่อนไข</div>
          ) : (
            <div className="tableScroll">
              <table className={`table compact ${styles.receivingTable} ${styles.historyTable}`}>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>ประเภท</th>
                    <th>เลขที่รายการ</th>
                    <th>แหล่งที่มา/ปลายทาง</th>
                    <th>PR</th>
                    <th>Description</th>
                    <th className="numeric">จำนวน</th>
                    <th>ผู้ทำรายการ</th>
                    <th>วันที่ทำรายการ</th>
                    <th>Stock Receive Nos.</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {historyEntries.flatMap((entry, historyIndex) => {
                    if (entry.kind === 'receive') {
                      const request = entry.request;
                      const receiveDate = request.approvedAt || request.receiveDate || request.requestedAt;

                      return request.items.map((item, itemIndex) => {
                        const stockReceiveNo = item.stockReceiveNo || request.stockReceiveNos?.[itemIndex];
                        return (
                          <tr key={`${request.id}-receive-${itemIndex}`} className={itemIndex === 0 ? styles.requestRowStart : undefined}>
                            {itemIndex === 0 ? (
                              <>
                                <td rowSpan={request.items.length}>{historyIndex + 1}</td>
                                <td rowSpan={request.items.length}>รับเข้า</td>
                                <td rowSpan={request.items.length}>
                                  <div className={styles.requestIdAction}>
                                    <span className={styles.receiveCode}>{request.id}</span>
                                    {hasRole('MasterAdmin') && request.sourceApp?.trim().toLowerCase() !== 'project transfer' ? (
                                      <button
                                        type="button"
                                        className={styles.deleteStockButton}
                                        disabled={Boolean(deletingHistoryItem)}
                                        title={`ลบ Request ID ${request.id} และสินค้าทุกรายการใน Request`}
                                        aria-label={`ลบ Request ID ${request.id}`}
                                        onClick={() => handleDeleteHistoryRequest(request)}
                                      >
                                        <Trash2 size={15} />
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                                <td rowSpan={request.items.length}>{getReceivingSourceLabel(request)}</td>
                                <td rowSpan={request.items.length} className={styles.prCell}>{request.prNo || '-'}</td>
                              </>
                            ) : null}
                            <td className={`${styles.descriptionCell} ${styles.historyDescriptionCell}`}>
                              {item.itemDescription?.trim() || '-'}
                            </td>
                            <td className="numeric">{item.receivedQty.toLocaleString()}</td>
                            {itemIndex === 0 ? (
                              <>
                                <td rowSpan={request.items.length}>{request.approvedByName || request.receiveName || '-'}</td>
                                <td rowSpan={request.items.length}>{formatDateTime(receiveDate)}</td>
                              </>
                            ) : null}
                            <td>
                              {stockReceiveNo ? <span className={styles.stockChip}>{stockReceiveNo}</span> : <span className={styles.noteText}>-</span>}
                            </td>
                            {itemIndex === 0 ? (
                              <td rowSpan={request.items.length}><StatusBadge status={request.requestStatus} /></td>
                            ) : null}
                          </tr>
                        );
                      });
                    }

                    const dispatch = entry.dispatch;
                    const dispatchPrNos = Array.from(new Set(dispatch.items.map((item) => item.prNo).filter(Boolean))).join(', ') || '-';
                    return dispatch.items.map((item, itemIndex) => (
                      <tr key={`${dispatch.id}-dispatch-${itemIndex}`} className={itemIndex === 0 ? styles.requestRowStart : undefined}>
                        {itemIndex === 0 ? (
                          <>
                            <td rowSpan={dispatch.items.length}>{historyIndex + 1}</td>
                            <td rowSpan={dispatch.items.length}>ทำออก</td>
                            <td rowSpan={dispatch.items.length}><span className={styles.receiveCode}>{dispatch.dispatchNo}</span></td>
                            <td rowSpan={dispatch.items.length}>ย้ายโครงการไปยัง {dispatch.destinationProjectNo || '-'}</td>
                            <td rowSpan={dispatch.items.length} className={styles.prCell}>{dispatchPrNos}</td>
                          </>
                        ) : null}
                        <td className={`${styles.descriptionCell} ${styles.historyDescriptionCell}`}>
                          {item.itemDescription?.trim() || '-'}
                        </td>
                        <td className="numeric">{item.qty.toLocaleString()}</td>
                        {itemIndex === 0 ? (
                          <>
                            <td rowSpan={dispatch.items.length}>{dispatch.dispatchedByName || '-'}</td>
                            <td rowSpan={dispatch.items.length}>{formatDateTime(dispatch.dispatchedAt)}</td>
                          </>
                        ) : null}
                        <td><span className={styles.stockChip}>{item.stockReceiveNo}</span></td>
                        {itemIndex === 0 ? (
                          <td rowSpan={dispatch.items.length}><StatusBadge status={dispatch.status} /></td>
                        ) : null}
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {receivingRequest ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <h3>รับสินค้าเข้าคลัง</h3>
                <p>ตรวจสอบและระบุจำนวนรับเข้าของแต่ละรายการก่อนบันทึก</p>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                onClick={closeRequestReceiveModal}
                disabled={approvingRequestId === receivingRequest.id}
                aria-label="Close receive request modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={`${styles.detailHero} ${styles.requestDetailHero}`}>
                <div className={styles.modalInfo}>
                  <span>Request ID</span>
                  <strong>{receivingRequest.id}</strong>
                </div>
                <div className={styles.modalInfo}>
                  <span>เลขที่ PO</span>
                  <strong>{receivingRequest.poNo || '-'}</strong>
                </div>
                <div className={styles.modalInfo}>
                  <span>Project</span>
                  <strong>{getRequestProjectCode(receivingRequest) || '-'}</strong>
                </div>
                <div className={styles.modalInfo}>
                  <span>วันที่รับของ</span>
                  <strong>{formatDateTime(receivingRequest.receiveDate)}</strong>
                </div>
                <div className={styles.modalInfo}>
                  <span>ผู้รับของ</span>
                  <strong>{receivingRequest.receiveName || '-'}</strong>
                </div>
              </div>

              <div className={styles.field}>
                <span>จำนวนรับเข้าแต่ละรายการ</span>
                <div className={styles.detailItemsTable}>
                  <div className={`${styles.receiveFormHead} ${styles.requestReceiveFormHead}`}>
                    <span>รหัสสินค้า</span>
                    <span>เลขที่ PO</span>
                    <span>รายการ</span>
                    <span className={styles.numericCell}>จำนวนที่ขอ</span>
                    <span className={styles.numericCell}>จำนวนรับเข้า</span>
                    <span>Type</span>
                  </div>
                  <div className={styles.receiveItemsBody}>
                    {receivingRequest.items.map((item, itemIndex) => {
                      const existingStockItem = findExistingStockItem(stockItems, receivingRequest, item);
                      const selectedItemType = requestItemTypeDraft[String(itemIndex)] ?? '';

                      return (
                      <div key={`${receivingRequest.id}-${itemIndex}`} className={`${styles.receiveFormRow} ${styles.requestReceiveFormRow}`}>
                        <span>{item.itemNo || '-'}</span>
                        <span>{receivingRequest.poNo || '-'}</span>
                        <span className={styles.itemDescriptionInline}>
                          {item.itemDescription || '-'}
                          {item.unit ? <small>{item.unit}</small> : null}
                        </span>
                        <span className={styles.numericCell}>{item.receivedQty.toLocaleString()}</span>
                        <input
                          className={styles.qtyInput}
                          type="text"
                          inputMode="numeric"
                          value={requestReceiveQtyDraft[String(itemIndex)] ?? ''}
                          onChange={(event) => handleRequestReceiveQtyChange(itemIndex, event.target.value)}
                          placeholder="0"
                        />
                        <select
                          className={styles.itemTypeSelect}
                          value={selectedItemType}
                          onChange={(event) => handleRequestItemTypeChange(itemIndex, event.target.value)}
                          disabled={Boolean(existingStockItem)}
                        >
                          {selectedItemType && !ITEM_TYPE_OPTIONS.some((option) => option.code === selectedItemType) ? (
                            <option value={selectedItemType}>{selectedItemType}</option>
                          ) : null}
                          <option value="">เลือก Type</option>
                          <optgroup label="Type 1">
                            {ITEM_TYPE_OPTIONS.filter((option) => option.group === 'Type 1').map((option) => (
                              <option key={option.code} value={option.code}>{option.code} — {option.label}</option>
                            ))}
                          </optgroup>
                          <optgroup label="Type 2">
                            {ITEM_TYPE_OPTIONS.filter((option) => option.group === 'Type 2').map((option) => (
                              <option key={option.code} value={option.code}>{option.code} — {option.label}</option>
                            ))}
                          </optgroup>
                        </select>
                      </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={closeRequestReceiveModal}
                disabled={approvingRequestId === receivingRequest.id}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={approvingRequestId === receivingRequest.id}
                onClick={handleConfirmRequestReceive}
              >
                {approvingRequestId === receivingRequest.id ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                <span>{approvingRequestId === receivingRequest.id ? 'กำลังบันทึก...' : 'ยืนยันรับสินค้า'}</span>
              </button>
            </div>
            {requestReceiveError ? <div className={styles.footerError}>{requestReceiveError}</div> : null}
          </div>
        </div>
      ) : null}

      {selectedIncomingDispatch && !receivingIncomingDispatch ? (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modal} ${styles.detailModal}`}>
            <div className={styles.modalHeader}>
              <div>
                <h3>รายละเอียดการจัดส่ง</h3>
                <p>ตรวจสอบรายการที่ย้ายทั้งหมดก่อนรับเข้าคลังของโครงการปลายทาง</p>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                onClick={closeIncomingDispatchDetail}
                aria-label="Close dispatch details"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.detailHero}>
                <div className={styles.modalInfo}>
                  <span>Dispatch No.</span>
                  <strong>{selectedIncomingDispatch.dispatchNo}</strong>
                </div>
                <StatusBadge status={selectedIncomingDispatch.status} />
              </div>

              <div className={styles.detailGrid}>
                <div className={styles.detailCard}>
                  <span>From</span>
                  <strong>{selectedIncomingDispatch.sourceProjectNo || '-'}</strong>
                  <p>{selectedIncomingDispatch.sourceProjectName || 'Unknown source project'}</p>
                </div>

                <div className={styles.detailCard}>
                  <span>To</span>
                  <strong>{selectedIncomingDispatch.destinationProjectNo || '-'}</strong>
                  <p>{selectedIncomingDispatch.destinationProjectName || 'Unknown destination project'}</p>
                </div>

                <div className={styles.detailCard}>
                  <span>Vehicle Plate</span>
                  <strong>{selectedIncomingDispatch.transport || '-'}</strong>
                  <p>Dispatched at {formatDateTime(selectedIncomingDispatch.dispatchedAt)}</p>
                </div>

                <div className={styles.detailCard}>
                  <span>Dispatch By</span>
                  <strong>{selectedIncomingDispatch.dispatchedByName || '-'}</strong>
                  <p>{selectedIncomingDispatch.dispatchedByEmail || '-'}</p>
                </div>
              </div>

              <div className={styles.field}>
                <span>Items</span>
                <div className={styles.detailItemsTable}>
                  <div className={styles.receiveItemsHead}>
                    <span>Receive No.</span>
                    <span>PR / PO</span>
                    <span>Item</span>
                    <span className={styles.numericCell}>Qty Sent</span>
                  </div>
                  <div className={styles.receiveItemsBody}>
                    {selectedIncomingDispatch.items.map((item) => (
                      <div key={`${selectedIncomingDispatch.id}-${item.stockReceiveNo}`} className={styles.receiveItemRow}>
                        <span>{item.receiveNo}</span>
                        <span>{item.prNo || item.poNo || '-'}</span>
                        <span>
                          {item.itemDescription}
                          <small>{item.itemNo}</small>
                        </span>
                        <span className={styles.numericCell}>{item.qty.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className={styles.detailGrid}>
                <div className={styles.field}>
                  <span>Note</span>
                  <div className={styles.detailTextBlock}>{selectedIncomingDispatch.note || '-'}</div>
                </div>

                <div className={styles.field}>
                  <span>Attachments</span>
                  <div className={styles.detailTextBlock}>
                    {selectedIncomingDispatch.photoUrls.length > 0 ? (
                      <div className={styles.photoList}>
                        {selectedIncomingDispatch.photoUrls.map((url, index) => (
                          <a
                            key={`${selectedIncomingDispatch.id}-${index}`}
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
                      'No photo'
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className={styles.ghostButton} onClick={closeIncomingDispatchDetail}>
                Close
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!canApproveReceipt || approvingIncomingDispatchId !== null}
                onClick={() => openIncomingReceiveModal(selectedIncomingDispatch)}
              >
                <CheckCircle2 size={16} />
                <span>Receive</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {receivingIncomingDispatch ? (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modal} ${styles.receiveModal}`}>
            <div className={styles.modalHeader}>
              <div>
                <h3>รับรายการจัดส่ง</h3>
                <p>ระบุจำนวนที่รับจริงของแต่ละรายการ โดยค่าเริ่มต้นจะเท่ากับจำนวนที่จัดส่ง</p>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                onClick={closeIncomingReceiveModal}
                aria-label="Close receive modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalInfoRow}>
                <div className={styles.modalInfo}>
                  <span>Dispatch No.</span>
                  <strong>{receivingIncomingDispatch.dispatchNo}</strong>
                </div>
                <div className={styles.modalInfo}>
                  <span>From</span>
                  <strong>{receivingIncomingDispatch.sourceProjectNo || '-'}</strong>
                </div>
                <div className={styles.modalInfo}>
                  <span>To</span>
                  <strong>{receivingIncomingDispatch.destinationProjectNo || '-'}</strong>
                </div>
              </div>

              <div className={styles.field}>
                <span>Received Qty by Item</span>
                <div className={styles.detailItemsTable}>
                  <div className={styles.receiveFormHead}>
                    <span>Receive No.</span>
                    <span>Item</span>
                    <span className={styles.numericCell}>Qty Sent</span>
                    <span className={styles.numericCell}>Qty Received</span>
                  </div>
                  <div className={styles.receiveItemsBody}>
                    {receivingIncomingDispatch.items.map((item) => (
                      <div key={`${receivingIncomingDispatch.id}-${item.stockReceiveNo}`} className={styles.receiveFormRow}>
                        <span>{item.receiveNo}</span>
                        <span>
                          {item.itemDescription}
                          <small>{item.itemNo}</small>
                        </span>
                        <span className={styles.numericCell}>{item.qty.toLocaleString()}</span>
                        <input
                          className={styles.qtyInput}
                          type="text"
                          inputMode="numeric"
                          value={incomingReceiveQtyDraft[item.stockReceiveNo] ?? ''}
                          onChange={(event) => handleIncomingReceiveQtyChange(item.stockReceiveNo, event.target.value)}
                          placeholder="0"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={closeIncomingReceiveModal}
                disabled={approvingIncomingDispatchId === receivingIncomingDispatch.id}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={approvingIncomingDispatchId === receivingIncomingDispatch.id}
                onClick={handleConfirmIncomingReceive}
              >
                {approvingIncomingDispatchId === receivingIncomingDispatch.id ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                <span>{approvingIncomingDispatchId === receivingIncomingDispatch.id ? 'Saving...' : 'Confirm Receive'}</span>
              </button>
            </div>
            {incomingReceiveError ? <div className={styles.footerError}>{incomingReceiveError}</div> : null}
          </div>
        </div>
      ) : null}

      {importFileName ? (
        <div className={styles.modalOverlay} role="presentation" onMouseDown={closeImportModal}>
          <div className={`${styles.modal} ${styles.importModal}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3>นำเข้าสินค้าจาก CSV</h3>
                <p>{importFileName} → โครงการ {activeProject?.projectNo ?? activeProjectNo}</p>
              </div>
              <button type="button" className={styles.iconButton} onClick={closeImportModal} disabled={isImporting} aria-label="ปิด">
                <X size={18} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.importSummary}>
                <strong>{importPreviewRows.length.toLocaleString()} รหัสสินค้า</strong>
                <span>เพิ่มรวม {importPreviewRows.reduce((sum, row) => sum + row.qty, 0).toLocaleString()} ชิ้น</span>
                <span>จับคู่รายการเดิมด้วยรหัสสินค้าเท่านั้น</span>
              </div>
              {importErrors.length > 0 ? (
                <div className={styles.importErrors}>
                  <strong>กรุณาแก้ไขไฟล์ก่อนนำเข้า</strong>
                  <ul>{importErrors.slice(0, 20).map((error) => <li key={error}>{error}</li>)}</ul>
                  {importErrors.length > 20 ? <p>และอีก {importErrors.length - 20} ข้อผิดพลาด</p> : null}
                </div>
              ) : null}
              {importWarnings.length > 0 ? (
                <div className={styles.importWarnings}>
                  <strong>คำเตือน — รายการเหล่านี้จะถูกข้าม</strong>
                  <ul>{importWarnings.slice(0, 20).map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  {importWarnings.length > 20 ? <p>และอีก {importWarnings.length - 20} คำเตือน</p> : null}
                </div>
              ) : null}
              {importPreviewRows.length > 0 ? (
                <div className="table-wrap">
                  <table className={styles.importPreviewTable}>
                    <thead><tr><th>รหัสสินค้า</th><th>PR</th><th>หมวดหมู่</th><th>ชื่อสินค้าในระบบ/CSV</th><th className="numeric">ยอดเดิม</th><th className="numeric">เพิ่ม</th><th className="numeric">ยอดใหม่</th></tr></thead>
                    <tbody>
                      {importPreviewRows.slice(0, 100).map((row) => (
                        <tr key={row.itemNo}>
                          <td>{row.itemNo}{row.itemType ? <small className={styles.itemTypeHint}>{row.itemType}</small> : null}</td>
                          <td>{row.prNo || '-'}</td>
                          <td>{ITEM_TYPE_OPTIONS.find((option) => option.code === row.itemType)?.label || '-'}</td>
                          <td>
                            {row.existingDescription || row.itemDescription}
                            {row.existingDescription && row.existingDescription !== row.itemDescription ? (
                              <small className={styles.nameMismatch}>ชื่อใน CSV: {row.itemDescription} (ระบบจะใช้ชื่อเดิม)</small>
                            ) : null}
                          </td>
                          <td className="numeric">{row.existingQty.toLocaleString()}</td>
                          <td className={`numeric ${styles.addQty}`}>+{row.qty.toLocaleString()}</td>
                          <td className={`numeric ${styles.finalQty}`}>{row.finalQty.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importPreviewRows.length > 100 ? <p className={styles.previewNote}>แสดงตัวอย่าง 100 รายการแรก</p> : null}
                </div>
              ) : null}
              {importPreviewRows.length > 0 && importErrors.length === 0 ? (
                <div className={styles.confirmNotice}>
                  ยืนยันเพิ่ม <strong>{importPreviewRows.length.toLocaleString()} รหัสสินค้า</strong>{' '}
                  จำนวนรวม <strong>{importPreviewRows.reduce((sum, row) => sum + row.qty, 0).toLocaleString()} ชิ้น</strong>{' '}
                  ไปยังโครงการ <strong>{activeProject?.projectNo ?? activeProjectNo}</strong> หรือไม่?
                </div>
              ) : null}
            </div>
            <div className={styles.modalFooter}>
              <button type="button" className={styles.ghostButton} onClick={closeImportModal} disabled={isImporting}>ยกเลิก</button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={isImporting || importRows.length === 0 || importErrors.length > 0 || !activeProjectNo}
                onClick={handleConfirmImport}
              >
                <FileUp size={16} />
                {isImporting ? 'กำลังนำเข้า...' : `ยืนยันเพิ่ม ${importPreviewRows.length.toLocaleString()} รายการ`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
