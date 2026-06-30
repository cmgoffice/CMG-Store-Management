import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { useInventory } from '../context/InventoryContext';
import type { StockItem } from '../types/models';
import '../styles/tables.css';
import styles from './StockListPage.module.css';

type StoreAvailability = 'Available' | 'Unavailable';

type StoreReceiveHistory = {
  id: string;
  receiveDate: string;
  prNo: string;
  receivedByName: string;
  qty: number;
  amount: number;
  sortValue: number;
};

type AggregatedStoreItem = {
  id: string;
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

function normalizeLookupKey(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
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
    activeProjectNo,
  } = useInventory();
  const [query, setQuery] = useState('');
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([]);
  const normalizedActiveProjectNo = normalizeProjectNo(activeProjectNo);

  const filteredItems = useMemo<AggregatedStoreItem[]>(() => {
    const normalized = query.trim().toLowerCase();
    const requestByKey = new Map<string, (typeof receivingRequests)[number]>();
    const requestByItemKey = new Map<string, (typeof receivingRequests)[number]>();
    const requestByDescriptionKey = new Map<string, (typeof receivingRequests)[number]>();

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

    const projectItems = normalizedActiveProjectNo
      ? stockItems.filter((item) => getStockItemProjectNo(item) === normalizedActiveProjectNo)
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

            return {
              id: item.stockItemId || item.receiveNo,
              receiveDate: formatBangkokDateTime(rawReceiveDate),
              prNo,
              receivedByName,
              qty: item.qty,
              amount: item.amount,
              sortValue: getDateSortValue(rawReceiveDate),
            };
          })
          .sort((left, right) => right.sortValue - left.sortValue);
        const searchText = [
          location,
          vendorName,
          representative.itemDescription,
          representative.itemNo,
          normalizedActiveProjectNo,
          String(group.qty),
          ...history.flatMap((entry) => [entry.prNo, entry.receivedByName, entry.receiveDate]),
          ...group.items.flatMap((item) => [item.receiveNo, item.prNo, item.poNo]),
        ]
          .join(' ')
          .toLowerCase();

        return {
          id: `${representative.itemNo}-${representative.itemDescription}`,
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
        const leftSortValue = left.history[0]?.sortValue ?? 0;
        const rightSortValue = right.history[0]?.sortValue ?? 0;
        return rightSortValue - leftSortValue;
      });
  }, [normalizedActiveProjectNo, query, receivingRequests, stockItems]);

  const handleToggleExpand = (itemId: string) => {
    setExpandedItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId]
    );
  };

  return (
    <div>
      <PageHeader
        eyebrow="Project Store"
        title="Store Inventory"
        description={
          normalizedActiveProjectNo
            ? `Inventory table for Project ${normalizedActiveProjectNo}.`
            : 'Select an active project to view store inventory.'
        }
        actions={
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search store items"
          />
        }
      />

      <div className={`tableScroll ${styles.inventoryTableScroll}`}>
        <table className={`table compact ${styles.inventoryTable}`}>
          <thead>
            <tr>
              <th className={styles.noColumn}>No</th>
              <th className={styles.locationColumn}>Current Location</th>
              <th className={styles.itemSummaryColumn}>Item Summary</th>
              <th className={`${styles.totalQtyColumn} numeric`}>
                {normalizedActiveProjectNo || 'Qty'}
              </th>
              <th className={styles.statusColumn}>Status</th>
              <th className={`${styles.amountColumn} numeric`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item, index) => {
              const isExpanded = expandedItemIds.includes(item.id);

              return (
                <Fragment key={item.id}>
                  <tr
                    className={styles.expandableRow}
                    onClick={() => handleToggleExpand(item.id)}
                  >
                    <td className={styles.noColumn}>{index + 1}</td>
                    <td className={styles.locationCell} title={item.location}>
                      {item.location}
                    </td>
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
                      <td colSpan={6}>
                        <div className={styles.detailPanel}>
                          <table className={styles.detailTable}>
                            <thead>
                              <tr>
                                <th>No</th>
                                <th>Receive Date</th>
                                <th>PR No.</th>
                                <th>Received By</th>
                                <th className="numeric">Qty</th>
                                <th className="numeric">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.history.map((historyItem, historyIndex) => (
                                <tr key={historyItem.id}>
                                  <td>{historyIndex + 1}</td>
                                  <td>{historyItem.receiveDate}</td>
                                  <td>{historyItem.prNo}</td>
                                  <td>{historyItem.receivedByName}</td>
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
                  colSpan={6}
                  className="text-center py-6 text-slate-400 font-semibold text-sm"
                >
                  No store items match the active project and current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
