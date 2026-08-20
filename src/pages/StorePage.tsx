import { ChevronDown, ChevronRight, Pencil, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SearchField } from '../components/SearchField';
import { StatusBadge } from '../components/StatusBadge';
import { getItemTypeOption, matchesItemType } from '../constants/itemTypes';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import type { StockItem, WithdrawRecord } from '../types/models';
import '../styles/tables.css';
import styles from './StockListPage.module.css';

type StoreAvailability = 'Available' | 'Unavailable';

type StoreReceiveHistory = {
  id: string;
  receiveDate: string;
  prNo: string;
  form: string;
  personName: string;
  withdrawId?: string;
  qty: number;
  amount: number;
  sortValue: number;
  movementType: 'receive' | 'withdraw';
};

type AggregatedStoreItem = {
  id: string;
  stockItemIds: string[];
  location: string;
  vendorName: string;
  itemDescription: string;
  itemNo: string;
  qty: number;
  amount: number;
  availability: StoreAvailability;
  searchText: string;
  history: StoreReceiveHistory[];
};

const PAGE_SIZE_OPTIONS = [100, 150, 200] as const;

function normalizeLookupKey(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getStockItemLookupKey(stockItemId: unknown, receiveNo: unknown) {
  return normalizeLookupKey(stockItemId) || normalizeLookupKey(receiveNo);
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
  if (item.status === 'Borrowed' && item.borrowerProjectNo) {
    return normalizeProjectNo(item.borrowerProjectNo);
  }
  return (
    normalizeProjectNo(item.cmgProjectCode) ||
    extractProjectNoFromLabel(item.purchasedForProject) ||
    extractProjectNoFromLabel(item.location) ||
    normalizeProjectNo(item.projectId)
  );
}

function buildCompositeItemKey(projectNo: string, itemNo: string, itemDescription: string) {
  return [
    normalizeLookupKey(projectNo),
    normalizeLookupKey(itemNo),
    normalizeLookupKey(itemDescription),
  ].join('::');
}

function buildDescriptionOnlyKey(projectNo: string, itemDescription: string) {
  return [normalizeLookupKey(projectNo), normalizeLookupKey(itemDescription)].join('::');
}

function parseDateValue(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return new Date(`${normalized}T00:00:00+07:00`);
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDateSortValue(value: string) {
  const parsed = parseDateValue(value);
  return parsed ? parsed.getTime() : 0;
}

function formatBangkokDateTime(value: string) {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return value || '-';
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return formatter
    .format(parsed)
    .replace(/\//g, '-')
    .replace(',', '');
}

export function StorePage() {
  const {
    stockItems,
    receivingRequests,
    dispatchRecords,
    withdrawRecords,
    activeProjectNo,
    updateProjectStockItem,
    deleteProjectStockItem,
  } = useInventory();
  const { hasRole } = useRole();
  const isMasterAdmin = hasRole('MasterAdmin');
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('search') ?? '');
  const selectedItemType = getItemTypeOption(searchParams.get('itemType') ?? '')?.code ?? '';
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [editingItem, setEditingItem] = useState<AggregatedStoreItem | null>(null);
  const [editItemNo, setEditItemNo] = useState('');
  const [editItemDescription, setEditItemDescription] = useState('');
  const [editError, setEditError] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [selectedWithdraw, setSelectedWithdraw] = useState<WithdrawRecord | null>(null);
  const normalizedActiveProjectNo = normalizeProjectNo(activeProjectNo);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    const nextSearchParams = new URLSearchParams(searchParams);

    if (value.trim()) {
      nextSearchParams.set('search', value);
    } else {
      nextSearchParams.delete('search');
    }

    setSearchParams(nextSearchParams, { replace: true });
  };

  useEffect(() => {
    const nextQuery = searchParams.get('search') ?? '';
    setQuery((currentQuery) => (currentQuery === nextQuery ? currentQuery : nextQuery));
  }, [searchParams]);

  const filteredItems = useMemo<AggregatedStoreItem[]>(() => {
    const normalized = query.trim().toLowerCase();
    const requestByKey = new Map<string, (typeof receivingRequests)[number]>();
    const requestByItemKey = new Map<string, (typeof receivingRequests)[number]>();
    const requestByDescriptionKey = new Map<string, (typeof receivingRequests)[number]>();
    const dispatchByKey = new Map<string, (typeof dispatchRecords)[number]>();
    const withdrawByItemKey = new Map<string, Array<(typeof withdrawRecords)[number]>>();

    const addWithdrawLookup = (key: string, record: (typeof withdrawRecords)[number]) => {
      const current = withdrawByItemKey.get(key) ?? [];
      if (!current.some((item) => item.id === record.id)) {
        current.push(record);
      }
      withdrawByItemKey.set(key, current);
    };

    withdrawRecords.forEach((record) => {
      record.items.forEach((withdrawItem) => {
        const key = getStockItemLookupKey(withdrawItem.stockItemId, withdrawItem.receiveNo);
        if (key) {
          addWithdrawLookup(key, record);
        }
      });
    });

    receivingRequests.forEach((request) => {
      [
        request.id,
        request.receiveNo,
        request.documentNo,
        request.poNo,
        request.poId,
        request.prNo,
      ]
        .map((value) => normalizeLookupKey(value))
        .filter(Boolean)
        .forEach((key) => {
          requestByKey.set(key, request);
        });

      request.stockReceiveNos?.forEach((stockReceiveNo) => {
        const key = normalizeLookupKey(stockReceiveNo);
        if (key) {
          requestByKey.set(key, request);
        }
      });

      request.items.forEach((requestItem) => {
        requestByItemKey.set(
          buildCompositeItemKey(request.projectNo, requestItem.itemNo, requestItem.itemDescription),
          request
        );
        requestByDescriptionKey.set(
          buildDescriptionOnlyKey(request.projectNo, requestItem.itemDescription),
          request
        );
      });
    });

    dispatchRecords.forEach((record) => {
      [
        record.id,
        record.dispatchNo,
        ...record.itemReceiveNos,
      ]
        .map((value) => normalizeLookupKey(value))
        .filter(Boolean)
        .forEach((key) => {
          dispatchByKey.set(key, record);
        });

      record.items.forEach((dispatchItem) => {
        [dispatchItem.stockReceiveNo, dispatchItem.stockItemId, dispatchItem.receiveNo]
          .map((value) => normalizeLookupKey(value))
          .filter(Boolean)
          .forEach((key) => {
            dispatchByKey.set(key, record);
          });
      });
    });

    const projectItems = normalizedActiveProjectNo
      ? stockItems.filter(
          (item) =>
            getStockItemProjectNo(item) === normalizedActiveProjectNo &&
            matchesItemType(item, selectedItemType)
        )
      : [];

    const groupedItems = new Map<
      string,
      {
        items: StockItem[];
        qty: number;
        amount: number;
        locations: Set<string>;
        vendors: Set<string>;
      }
    >();

    projectItems.forEach((item) => {
      const groupKey = `${item.itemNo.trim().toLowerCase()}::${item.itemDescription.trim().toLowerCase()}`;
      const currentGroup = groupedItems.get(groupKey) ?? {
        items: [],
        qty: 0,
        amount: 0,
        locations: new Set<string>(),
        vendors: new Set<string>(),
      };

      currentGroup.items.push(item);
      currentGroup.qty += item.qty;
      currentGroup.amount += item.amount;
      currentGroup.locations.add(item.location.trim());
      if (item.vendorName.trim()) {
        currentGroup.vendors.add(item.vendorName.trim());
      }

      groupedItems.set(groupKey, currentGroup);
    });

    return Array.from(groupedItems.values())
      .map((group) => {
        const representative = group.items[0];
        const location = Array.from(group.locations).filter(Boolean).join(', ') || '-';
        const vendorName = Array.from(group.vendors).join(', ') || '-';
        const availability: StoreAvailability = group.qty > 0 ? 'Available' : 'Unavailable';
        const history = [...group.items]
          .map((item) => {
            const requestKeys = [
              item.stockItemId,
              item.receiveNo,
              item.sourceReceiveNo,
              item.rpNo,
              item.documentNo,
              item.poNo,
              item.poId ? String(item.poId) : '',
              item.prNo,
            ]
              .map((value) => normalizeLookupKey(value))
              .filter(Boolean);
            const request =
              requestKeys
                .map((key) => requestByKey.get(key))
                .find(Boolean) ??
              requestByItemKey.get(
                buildCompositeItemKey(normalizedActiveProjectNo, item.itemNo, item.itemDescription)
              ) ??
              requestByDescriptionKey.get(
                buildDescriptionOnlyKey(normalizedActiveProjectNo, item.itemDescription)
              );
            const dispatch =
              requestKeys
                .map((key) => dispatchByKey.get(key))
                .find(Boolean) ?? null;
            const rawReceiveDate =
              item.lastReceivedAt ||
              item.receiveDate ||
              request?.approvedAt ||
              request?.requestedAt ||
              request?.receiveDate ||
              '-';
            const prNo = item.prNo || request?.prNo || '-';
            const receivedByName =
              item.receivedByName ||
              request?.approvedByName ||
              request?.receivedByName ||
              item.receiveName ||
              request?.receiveName ||
              '-';
            const form = dispatch
              ? dispatch.sourceProjectNo || 'Project Transfer'
              : 'New Receiving';
            const receiveHistory: StoreReceiveHistory = {
              id: item.stockItemId || item.receiveNo,
              receiveDate: formatBangkokDateTime(rawReceiveDate),
              prNo,
              form,
              personName: receivedByName,
              qty: item.qty,
              amount: item.amount,
              sortValue: getDateSortValue(rawReceiveDate),
              movementType: 'receive',
            };
            // Withdrawal records refer to a concrete stock item. Do not use
            // receiving-document keys here because one PR/PO can contain
            // multiple different stock items and withdrawals.
            const stockItemKey = getStockItemLookupKey(item.stockItemId, item.receiveNo);
            const matchedWithdrawals = (withdrawByItemKey.get(stockItemKey) ?? [])
              .filter((record) => normalizeProjectNo(record.projectNo) === normalizedActiveProjectNo);
            const withdrawHistory = matchedWithdrawals.flatMap((record) => (
              record.items
                .filter((withdrawItem) => (
                  getStockItemLookupKey(withdrawItem.stockItemId, withdrawItem.receiveNo) === stockItemKey
                ))
                .map((withdrawItem) => ({
                  id: `${record.id}-${withdrawItem.stockItemId}`,
                  receiveDate: formatBangkokDateTime(record.withdrawDate || record.createdAt),
                  prNo: record.withdrawNo,
                  form: record.type === 'borrow' ? 'Withdraw / Borrow' : 'Withdraw / Issue',
                  personName: withdrawItem.requesterName || record.requesterName || record.issuedByName || '-',
                  withdrawId: record.id,
                  qty: -withdrawItem.qty,
                  amount: -withdrawItem.amount,
                  sortValue: getDateSortValue(record.withdrawDate || record.createdAt),
                  movementType: 'withdraw' as const,
                }))
            ));

            return [receiveHistory, ...withdrawHistory];
          })
          .flat()
          .sort((left, right) => right.sortValue - left.sortValue);
        const searchText = [
          location,
          vendorName,
          representative.itemDescription,
          representative.itemNo,
          representative.materialNo,
          representative.iditem,
          normalizedActiveProjectNo,
          String(group.qty),
          ...history.flatMap((entry) => [entry.prNo, entry.form, entry.personName, entry.receiveDate]),
          ...group.items.flatMap((item) => [
            item.receiveNo,
            item.prNo,
            item.poNo,
            item.itemNo,
            item.materialNo,
            item.iditem,
          ]),
        ]
          .join(' ')
          .toLowerCase();

        return {
          id: `${representative.itemNo}-${representative.itemDescription}`,
          stockItemIds: group.items.map((item) => item.stockItemId || item.receiveNo),
          location,
          vendorName,
          itemDescription: representative.itemDescription,
          itemNo: representative.itemNo,
          qty: group.qty,
          amount: group.amount,
          availability,
          searchText,
          history,
        };
      })
      .filter((item) => !normalized || item.searchText.includes(normalized))
      .sort((left, right) => {
        if (left.availability !== right.availability) {
          return left.availability === 'Available' ? -1 : 1;
        }

        const leftSortValue = left.history[0]?.sortValue ?? 0;
        const rightSortValue = right.history[0]?.sortValue ?? 0;
        return rightSortValue - leftSortValue;
      });
  }, [dispatchRecords, normalizedActiveProjectNo, query, receivingRequests, selectedItemType, stockItems, withdrawRecords]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedItems = useMemo(
    () => filteredItems.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize),
    [filteredItems, pageSize, safeCurrentPage]
  );
  const firstVisibleItem = filteredItems.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const lastVisibleItem = Math.min(safeCurrentPage * pageSize, filteredItems.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedActiveProjectNo, query, selectedItemType]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const handlePageSizeChange = (nextPageSize: number) => {
    if (PAGE_SIZE_OPTIONS.includes(nextPageSize as (typeof PAGE_SIZE_OPTIONS)[number])) {
      setPageSize(nextPageSize as (typeof PAGE_SIZE_OPTIONS)[number]);
      setCurrentPage(1);
    }
  };

  const handleToggleExpand = (itemId: string) => {
    setExpandedItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId]
    );
  };

  const handleStartEdit = (item: AggregatedStoreItem) => {
    if (!isMasterAdmin) {
      return;
    }

    setEditingItem(item);
    setEditItemNo(item.itemNo);
    setEditItemDescription(item.itemDescription);
    setEditError('');
  };

  const handleCloseEdit = () => {
    if (isSavingEdit) {
      return;
    }

    setEditingItem(null);
    setEditError('');
  };

  const handleSaveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingItem || !normalizedActiveProjectNo || !isMasterAdmin) {
      return;
    }

    setIsSavingEdit(true);
    setEditError('');
    try {
      await updateProjectStockItem({
        projectNo: normalizedActiveProjectNo,
        stockItemIds: editingItem.stockItemIds,
        itemNo: editItemNo,
        itemDescription: editItemDescription,
      });
      setEditingItem(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'ไม่สามารถบันทึกการแก้ไขได้');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!editingItem || !normalizedActiveProjectNo || !isMasterAdmin || isSavingEdit) {
      return;
    }

    const confirmed = window.confirm(
      `ยืนยันการลบรายการ "${editingItem.itemDescription}" จำนวน ${editingItem.stockItemIds.length} รายการใช่หรือไม่?\nข้อมูลจะถูกย้ายไป deleteitemhistory`
    );
    if (!confirmed) {
      return;
    }

    setIsSavingEdit(true);
    setEditError('');
    try {
      await deleteProjectStockItem({
        projectNo: normalizedActiveProjectNo,
        stockItemIds: editingItem.stockItemIds,
      });
      setEditingItem(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'ไม่สามารถลบรายการสินค้าได้');
    } finally {
      setIsSavingEdit(false);
    }
  };

  return (
    <div>
      <div className={styles.toolbar}>
        <SearchField
          value={query}
          onChange={handleQueryChange}
          placeholder="ค้นหารายการสินค้าในคลัง"
        />
      </div>

      <div className={`tableScroll ${styles.inventoryTableScroll}`}>
        <table className={`table compact ${styles.inventoryTable}`}>
          <thead>
            <tr>
              <th className={styles.noColumn}>ลำดับ</th>
              <th className={styles.itemSummaryColumn}>รายการสินค้า</th>
              <th className={`${styles.totalQtyColumn} numeric`}>
                {normalizedActiveProjectNo || 'Qty'}
              </th>
              <th className={styles.statusColumn}>สถานะ</th>
              <th className={`${styles.amountColumn} numeric`}>มูลค่า</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.map((item, index) => {
              const isExpanded = expandedItemIds.includes(item.id);

              return (
                <Fragment key={item.id}>
                  <tr
                    className={styles.expandableRow}
                    onClick={() => handleToggleExpand(item.id)}
                  >
                    <td className={styles.noColumn}>{(safeCurrentPage - 1) * pageSize + index + 1}</td>
                    <td className={styles.itemSummaryCell}>
                      <button
                        type="button"
                        className={`${styles.expandButton} ${styles.itemSummaryButton}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleExpand(item.id);
                        }}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className={styles.itemSummaryText} title={item.itemDescription}>
                          {item.itemDescription}
                        </span>
                      </button>
                    </td>
                    <td className={`${styles.totalQtyCell} numeric ${item.qty === 0 ? 'muted' : ''}`}>
                      {item.qty === 0 ? '-' : item.qty.toLocaleString()}
                    </td>
                    <td className={styles.statusCell}>
                      <span
                        className={`${styles.availabilityBadge} ${
                          item.availability === 'Available'
                            ? styles.available
                            : styles.unavailable
                        }`}
                      >
                        {item.availability}
                      </span>
                    </td>
                    <td className={`${styles.amountCell} numeric`}>{item.amount.toLocaleString()}</td>
                  </tr>
                  {isExpanded ? (
                    <tr className={styles.detailRow}>
                      <td colSpan={5}>
                        <div className={styles.detailPanel}>
                          <div className={styles.detailHeader}>
                            <div>
                              <strong>{item.itemDescription}</strong>
                              <span className={styles.itemCodeLabel}>รหัส {item.itemNo}</span>
                            </div>
                            {isMasterAdmin ? (
                              <button
                                type="button"
                                className={styles.editButton}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleStartEdit(item);
                                }}
                                aria-label={`แก้ไข ${item.itemDescription}`}
                              >
                                <Pencil size={14} />
                                แก้ไข
                              </button>
                            ) : null}
                          </div>
                          <table className={styles.detailTable}>
                            <thead>
                              <tr>
                                <th>ลำดับ</th><th>วันที่</th><th>เลขที่ PR / เลขที่เบิก</th><th>รูปแบบ</th><th>ผู้เบิก / ผู้รับสินค้า</th><th className="numeric">จำนวน</th><th className="numeric">มูลค่า</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.history.map((historyItem, historyIndex) => (
                                <tr key={historyItem.id}>
                                  <td>{historyIndex + 1}</td>
                                  <td>{historyItem.receiveDate}</td>
                                  <td>
                                    {historyItem.withdrawId ? (
                                      <button
                                        type="button"
                                        className={styles.historyLink}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          const record = withdrawRecords.find((withdraw) => withdraw.id === historyItem.withdrawId);
                                          if (record) {
                                            setSelectedWithdraw(record);
                                          }
                                        }}
                                        title="ดูรายละเอียดการเบิก"
                                      >
                                        {historyItem.prNo}
                                      </button>
                                    ) : historyItem.prNo}
                                  </td>
                                  <td>{historyItem.form}</td>
                                  <td>{historyItem.personName}</td>
                                  <td className="numeric">{historyItem.qty.toLocaleString()}</td>
                                  <td className="numeric">{historyItem.amount.toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {filteredItems.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="text-center py-6 text-slate-400 font-semibold text-sm"
                >
                  ไม่พบรายการสินค้าในโครงการและเงื่อนไขที่เลือก
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <div className={styles.paginationSummary}>
          แสดง {firstVisibleItem.toLocaleString()}-{lastVisibleItem.toLocaleString()} จาก{' '}
          {filteredItems.length.toLocaleString()} รายการ
        </div>
        <div className={styles.paginationActions}>
          <label className={styles.pageSizeControl}>
            <span>รายการต่อหน้า</span>
            <select
              className={styles.select}
              value={pageSize}
              onChange={(event) => handlePageSizeChange(Number(event.target.value))}
              aria-label="จำนวนรายการต่อหน้า"
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.paginationButton}
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={safeCurrentPage === 1}
          >
            ก่อนหน้า
          </button>
          <span className={styles.paginationPage}>
            หน้า {safeCurrentPage.toLocaleString()} / {totalPages.toLocaleString()}
          </span>
          <button
            type="button"
            className={styles.paginationButton}
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={safeCurrentPage === totalPages}
          >
            ถัดไป
          </button>
        </div>
      </div>

      {selectedWithdraw ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setSelectedWithdraw(null)}>
          <section
            className={`${styles.editModal} ${styles.withdrawDetailModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-withdraw-detail-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.editModalHeader}>
              <div>
                <span className={styles.editModalEyebrow}>WITHDRAW DETAIL</span>
                <h2 id="store-withdraw-detail-title">รายละเอียดการเบิก {selectedWithdraw.withdrawNo}</h2>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setSelectedWithdraw(null)} aria-label="ปิดรายละเอียดการเบิก">
                <X size={18} />
              </button>
            </div>

            <div className={styles.withdrawDetailGrid}>
              <div className={styles.withdrawDetailCard}><span>ประเภท</span><strong>{selectedWithdraw.type === 'borrow' ? 'ยืม / รอคืน' : 'เบิกจ่าย'}</strong></div>
              <div className={styles.withdrawDetailCard}><span>สถานะ</span><StatusBadge status={selectedWithdraw.status} /></div>
              <div className={styles.withdrawDetailCard}><span>โครงการ</span><strong>{selectedWithdraw.projectNo}</strong><small>{selectedWithdraw.projectName || '-'}</small></div>
              <div className={styles.withdrawDetailCard}><span>วันที่เบิก</span><strong>{formatBangkokDateTime(selectedWithdraw.withdrawDate)}</strong></div>
              <div className={styles.withdrawDetailCard}><span>ผู้จ่าย</span><strong>{selectedWithdraw.issuedByName || '-'}</strong></div>
              <div className={styles.withdrawDetailCard}><span>ผู้ขอเบิก</span><strong>{selectedWithdraw.requesterName || '-'}</strong></div>
              {selectedWithdraw.type === 'borrow' ? <div className={styles.withdrawDetailCard}><span>กำหนดคืน</span><strong>{selectedWithdraw.dueDate ? formatBangkokDateTime(selectedWithdraw.dueDate) : '-'}</strong></div> : null}
              <div className={`${styles.withdrawDetailCard} ${styles.withdrawDetailWide}`}><span>วัตถุประสงค์</span><strong>{selectedWithdraw.purpose || '-'}</strong></div>
            </div>

            <div className={styles.withdrawDetailItems}>
              <h3>รายการสินค้า</h3>
              <table className={styles.detailTable}>
                <thead><tr><th>รหัสสินค้า</th><th>รายละเอียด</th><th>เลขที่รับเข้า</th><th>ผู้เบิก</th><th className="numeric">จำนวน</th><th className="numeric">มูลค่า</th></tr></thead>
                <tbody>
                  {selectedWithdraw.items.map((withdrawItem) => (
                    <tr key={`${selectedWithdraw.id}-${withdrawItem.stockItemId}`}>
                      <td>{withdrawItem.itemNo || '-'}</td>
                      <td>{withdrawItem.itemDescription || '-'}</td>
                      <td>{withdrawItem.receiveNo || '-'}</td>
                      <td>{withdrawItem.requesterName || selectedWithdraw.requesterName || '-'}</td>
                      <td className="numeric">{withdrawItem.qty.toLocaleString()} {withdrawItem.unit || ''}</td>
                      <td className="numeric">{withdrawItem.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.editModalActions}>
              <button type="button" className={styles.cancelButton} onClick={() => setSelectedWithdraw(null)}>ปิดรายละเอียด</button>
            </div>
          </section>
        </div>
      ) : null}

      {editingItem ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={handleCloseEdit}
        >
          <form
            className={styles.editModal}
            onSubmit={handleSaveEdit}
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-stock-item-title"
          >
            <div className={styles.editModalHeader}>
              <div>
                <span className={styles.editModalEyebrow}>MasterAdmin</span>
                <h2 id="edit-stock-item-title">แก้ไขรายละเอียดสินค้า</h2>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={handleCloseEdit}
                aria-label="ปิดหน้าต่างแก้ไข"
              >
                <X size={18} />
              </button>
            </div>

            <label className={styles.formField}>
              <span>ชื่อสินค้า</span>
              <input
                value={editItemDescription}
                onChange={(event) => setEditItemDescription(event.target.value)}
                autoFocus
                required
              />
            </label>

            <label className={styles.formField}>
              <span>รหัสสินค้า</span>
              <input
                value={editItemNo}
                onChange={(event) => setEditItemNo(event.target.value)}
                required
              />
            </label>

            <div className={styles.readOnlyField}>
              <span>จำนวนคงเหลือ</span>
              <strong>{editingItem.qty.toLocaleString()}</strong>
              <small>ไม่สามารถแก้ไขจำนวนจากหน้าต่างนี้ได้</small>
            </div>

            {editError ? <p className={styles.editError}>{editError}</p> : null}

            <div className={styles.editModalActions}>
              <button
                type="button"
                className={styles.deleteButton}
                onClick={handleDeleteItem}
                disabled={isSavingEdit}
              >
                <Trash2 size={14} />
                ลบรายการ
              </button>
              <button type="button" className={styles.cancelButton} onClick={handleCloseEdit} disabled={isSavingEdit}>
                ยกเลิก
              </button>
              <button type="submit" className={styles.saveButton} disabled={isSavingEdit}>
                {isSavingEdit ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
