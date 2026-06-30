import { ChevronDown, ChevronRight, PackagePlus } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import type { StockItem } from '../types/models';
import '../styles/tables.css';
import styles from './StockListPage.module.css';

type InventoryAvailability = 'Available' | 'Unavailable';
type InventoryReceiveHistory = {
  id: string;
  receiveDate: string;
  prNo: string;
  receivedByName: string;
  qty: number;
  amount: number;
  sortValue: number;
};

type AggregatedInventoryItem = {
  id: string;
  receiveDate: string;
  purchasedForProject: string;
  location: string;
  vendorName: string;
  itemDescription: string;
  itemNo: string;
  qty: number;
  amount: number;
  availability: InventoryAvailability;
  searchText: string;
  history: InventoryReceiveHistory[];
};

function createProjectLabel(projectNo: string) {
  return `Project ${projectNo}`;
}

function getProjectRelatedLocations(projectNo: string) {
  return new Set([
    `Project ${projectNo}`,
    `Store ${projectNo}`,
    `In Transit to Project ${projectNo}`,
    `In Transit to Store ${projectNo}`,
  ]);
}

function normalizeLookupKey(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
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

export function StockListPage() {
  const { stockItems, receivingRequests, activeProjectNo, receiveNewItem } = useInventory();
  const { canReceiveStock, isReadOnly } = useRole();
  const [query, setQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([]);

  const getItemProjectQty = (item: StockItem, projectNo: string) => {
    const normalizedProjectNo = projectNo.trim();
    if (!normalizedProjectNo) {
      return 0;
    }

    const projectLabel = createProjectLabel(normalizedProjectNo);
    const relatedLocations = getProjectRelatedLocations(normalizedProjectNo);
    const matchesProject =
      item.purchasedForProject.trim() === projectLabel || relatedLocations.has(item.location.trim());

    return matchesProject ? item.qty : 0;
  };

  const filteredItems = useMemo<AggregatedInventoryItem[]>(() => {
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
        const itemKey = buildCompositeItemKey(
          request.projectNo,
          requestItem.itemNo,
          requestItem.itemDescription
        );
        requestByItemKey.set(itemKey, request);
        requestByDescriptionKey.set(
          buildDescriptionOnlyKey(request.projectNo, requestItem.itemDescription),
          request
        );
      });
    });

    const projectScopedItems = activeProjectNo
      ? stockItems.filter((item) => getItemProjectQty(item, activeProjectNo) > 0)
      : stockItems;

    const groupedItems = new Map<
      string,
      {
        items: StockItem[];
        qty: number;
        amount: number;
        locations: Set<string>;
        vendors: Set<string>;
        projects: Set<string>;
      }
    >();

    projectScopedItems.forEach((item) => {
      const groupKey = `${item.itemNo.trim().toLowerCase()}::${item.itemDescription.trim().toLowerCase()}`;
      const currentGroup = groupedItems.get(groupKey) ?? {
        items: [],
        qty: 0,
        amount: 0,
        locations: new Set<string>(),
        vendors: new Set<string>(),
        projects: new Set<string>(),
      };

      currentGroup.items.push(item);
      currentGroup.qty += item.qty;
      currentGroup.amount += item.amount;
      currentGroup.locations.add(item.location.trim());
      if (item.vendorName.trim()) {
        currentGroup.vendors.add(item.vendorName.trim());
      }
      if (item.purchasedForProject.trim()) {
        currentGroup.projects.add(item.purchasedForProject.trim());
      }

      groupedItems.set(groupKey, currentGroup);
    });

    return Array.from(groupedItems.values())
      .map((group) => {
        const representative = group.items[0];
        const location = Array.from(group.locations).filter(Boolean).join(', ') || '-';
        const vendorName = Array.from(group.vendors).join(', ') || '-';
        const purchasedForProject =
          Array.from(group.projects).filter(Boolean).join(', ') ||
          (activeProjectNo ? createProjectLabel(activeProjectNo) : '-');
        const availability: InventoryAvailability = group.qty > 0 ? 'Available' : 'Unavailable';
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
            const projectNo = activeProjectNo || item.projectId || '';
            const request =
              requestKeys
                .map((key) => requestByKey.get(key))
                .find(Boolean) ??
              requestByItemKey.get(
                buildCompositeItemKey(projectNo, item.itemNo, item.itemDescription)
              ) ??
              requestByDescriptionKey.get(buildDescriptionOnlyKey(projectNo, item.itemDescription));
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
        const receiveDate = history[0]?.receiveDate || '-';
        const searchText = [
          receiveDate,
          purchasedForProject,
          location,
          vendorName,
          representative.itemDescription,
          representative.itemNo,
          ...history.flatMap((entry) => [entry.prNo, entry.receivedByName, entry.receiveDate]),
          ...group.items.flatMap((item) => [item.receiveNo, item.prNo, item.poNo]),
        ]
          .join(' ')
          .toLowerCase();

        return {
          id: `${representative.itemNo}-${representative.itemDescription}`,
          receiveDate,
          purchasedForProject,
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
  }, [activeProjectNo, query, receivingRequests, stockItems]);

  const handleToggleExpand = (itemId: string) => {
    setExpandedItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId]
    );
  };

  const handleReceiveMockItem = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const sequence = String(stockItems.length + 1).padStart(3, '0');
    const newItem: StockItem = {
      receiveNo: `RCV-2026-${sequence}`,
      poNo: `PO-2606-${120 + stockItems.length}`,
      prNo: `PR-2606-${220 + stockItems.length}`,
      poType: 'Material',
      itemNo: `GEN-${sequence}`,
      itemDescription: 'General construction supplies',
      amount: 28500,
      qty: 25,
      vendorName: 'Central Construction Supply',
      location: 'Store Center',
      purchasedForProject: 'Project J74',
      receiveName: 'Narin Store',
      receiveDate: `2026-06-22-${sequence}`,
      status: 'Pending Dispatch',
    };

    try {
      await receiveNewItem(newItem);
    } catch (error) {
      console.error('Failed to receive new item:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Store"
        title="Inventory"
        description="Inventory table for central inventory, in-transit items, and goods received at project sites."
        actions={
          <>
            <SearchField value={query} onChange={setQuery} placeholder="Search inventory" />
            {canReceiveStock && !isReadOnly ? (
              <button
                className={styles.primaryButton}
                type="button"
                onClick={handleReceiveMockItem}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />
                ) : (
                  <PackagePlus size={16} />
                )}
                <span>{isSubmitting ? 'Receiving...' : 'Receive New Item'}</span>
              </button>
            ) : null}
          </>
        }
      />

      <div className="tableScroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>No</th>
              <th>Current Location</th>
              <th>Item Summary</th>
              <th className="numeric">{activeProjectNo ? `${activeProjectNo} Qty` : 'Qty'}</th>
              <th>Status</th>
              <th className="numeric">Amount</th>
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
                    <td>{index + 1}</td>
                    <td>{item.location}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.expandButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleExpand(item.id);
                        }}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="itemSummaryCompact">
                          <strong>{item.itemDescription}</strong>
                        </span>
                      </button>
                    </td>
                    <td className={`numeric ${item.qty === 0 ? 'muted' : ''}`}>
                      {item.qty === 0 ? '-' : item.qty.toLocaleString()}
                    </td>
                    <td>
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
                    <td className="numeric">{item.amount.toLocaleString()}</td>
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
            {filteredItems.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="text-center py-6 text-slate-400 font-semibold text-sm"
                >
                  No inventory items match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
