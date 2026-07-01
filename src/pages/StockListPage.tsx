import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { useInventory } from '../context/InventoryContext';
import type { StockItem } from '../types/models';
import '../styles/tables.css';
import styles from './StockListPage.module.css';

type InventoryAvailability = 'Available' | 'Unavailable';
type InventoryReceiveHistory = {
  id: string;
  projectNo: string;
  receiveDate: string;
  prNo: string;
  receivedByName: string;
  qty: number;
  amount: number;
  sortValue: number;
};
type InventoryProjectQty = {
  projectNo: string;
  projectName: string;
  qty: number;
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
  projectQty: InventoryProjectQty[];
  qtyByProject: Record<string, number>;
  history: InventoryReceiveHistory[];
};

const UNASSIGNED_PROJECT_NO = 'Unassigned';

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
    normalizeProjectNo(item.projectId) ||
    UNASSIGNED_PROJECT_NO
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

export function StockListPage() {
  const { projects, stockItems, receivingRequests } = useInventory();
  const [query, setQuery] = useState('');
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([]);
  const projectByNo = useMemo(() => {
    return new Map(projects.map((project) => [normalizeProjectNo(project.projectNo), project]));
  }, [projects]);
  const projectOrder = useMemo(() => {
    return new Map(projects.map((project, index) => [normalizeProjectNo(project.projectNo), index]));
  }, [projects]);
  const projectQtyColumns = useMemo<InventoryProjectQty[]>(() => {
    const qtyByProject = new Map<string, number>();

    stockItems.forEach((item) => {
      const projectNo = getStockItemProjectNo(item);
      qtyByProject.set(projectNo, (qtyByProject.get(projectNo) ?? 0) + item.qty);
    });

    return Array.from(qtyByProject.entries())
      .filter(([, qty]) => qty > 0)
      .sort(([leftProjectNo], [rightProjectNo]) => {
        const leftOrder = projectOrder.get(leftProjectNo) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = projectOrder.get(rightProjectNo) ?? Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return leftProjectNo.localeCompare(rightProjectNo);
      })
      .map(([projectNo, qty]) => {
        const project = projectByNo.get(projectNo);
        return {
          projectNo,
          projectName: project?.projectName ?? '',
          qty,
        };
      });
  }, [projectByNo, projectOrder, stockItems]);

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

    const groupedItems = new Map<
      string,
      {
        items: StockItem[];
        qty: number;
        amount: number;
        locations: Set<string>;
        vendors: Set<string>;
        projectQty: Map<string, number>;
      }
    >();

    stockItems.forEach((item) => {
      const groupKey = `${item.itemNo.trim().toLowerCase()}::${item.itemDescription.trim().toLowerCase()}`;
      const currentGroup = groupedItems.get(groupKey) ?? {
        items: [],
        qty: 0,
        amount: 0,
        locations: new Set<string>(),
        vendors: new Set<string>(),
        projectQty: new Map<string, number>(),
      };
      const projectNo = getStockItemProjectNo(item);

      currentGroup.items.push(item);
      currentGroup.qty += item.qty;
      currentGroup.amount += item.amount;
      currentGroup.locations.add(item.location.trim());
      if (item.vendorName.trim()) {
        currentGroup.vendors.add(item.vendorName.trim());
      }
      currentGroup.projectQty.set(
        projectNo,
        (currentGroup.projectQty.get(projectNo) ?? 0) + item.qty
      );

      groupedItems.set(groupKey, currentGroup);
    });

    return Array.from(groupedItems.values())
      .map((group) => {
        const representative = group.items[0];
        const location = Array.from(group.locations).filter(Boolean).join(', ') || '-';
        const vendorName = Array.from(group.vendors).join(', ') || '-';
        const projectQty = Array.from(group.projectQty.entries())
          .filter(([, qty]) => qty > 0)
          .sort(([leftProjectNo], [rightProjectNo]) => {
            const leftOrder = projectOrder.get(leftProjectNo) ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = projectOrder.get(rightProjectNo) ?? Number.MAX_SAFE_INTEGER;

            if (leftOrder !== rightOrder) {
              return leftOrder - rightOrder;
            }

            return leftProjectNo.localeCompare(rightProjectNo);
          })
          .map(([projectNo, qty]) => {
            const project = projectByNo.get(projectNo);
            return {
              projectNo,
              projectName: project?.projectName ?? '',
              qty,
            };
          });
        const qtyByProject = projectQty.reduce<Record<string, number>>((acc, entry) => {
          acc[entry.projectNo] = entry.qty;
          return acc;
        }, {});
        const purchasedForProject =
          projectQty.map((entry) => entry.projectNo).join(', ') || '-';
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
            const projectNo = getStockItemProjectNo(item);
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
              projectNo,
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
          ...projectQty.flatMap((entry) => [entry.projectNo, entry.projectName, String(entry.qty)]),
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
          projectQty,
          qtyByProject,
          history,
        };
      })
      .filter((item) => !normalized || item.searchText.includes(normalized))
      .sort((left, right) => {
        const leftSortValue = left.history[0]?.sortValue ?? 0;
        const rightSortValue = right.history[0]?.sortValue ?? 0;
        return rightSortValue - leftSortValue;
      });
  }, [projectByNo, projectOrder, query, receivingRequests, stockItems]);

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
        eyebrow="Store"
        title="Inventory"
        description="Inventory overview across all projects, with quantity split by project."
        actions={
          <SearchField value={query} onChange={setQuery} placeholder="Search inventory" />
        }
      />

      <div className={`tableScroll ${styles.inventoryTableScroll}`}>
        <table className={`table compact ${styles.inventoryTable}`}>
          <thead>
            <tr>
              <th className={styles.noColumn}>No</th>
              <th className={styles.itemSummaryColumn}>Item Summary</th>
              {projectQtyColumns.map((project) => (
                <th
                  key={project.projectNo}
                  className={`${styles.projectQtyHeader} numeric`}
                  title={project.projectName || project.projectNo}
                >
                  {project.projectNo}
                </th>
              ))}
              <th className={`${styles.totalQtyColumn} numeric`}>Total Qty</th>
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
                    {projectQtyColumns.map((project) => {
                      const projectQty = item.qtyByProject[project.projectNo] ?? 0;

                      return (
                        <td
                          key={project.projectNo}
                          className={`numeric ${styles.projectQtyCell} ${projectQty === 0 ? 'muted' : ''}`}
                        >
                          {projectQty === 0 ? '-' : projectQty.toLocaleString()}
                        </td>
                      );
                    })}
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
                      <td colSpan={5 + projectQtyColumns.length}>
                        <div className={styles.detailPanel}>
                          <table className={styles.detailTable}>
                            <thead>
                              <tr>
                                <th>No</th>
                                <th>Project</th>
                                <th>Receive Date</th>
                                <th>PR No.</th>
                                <th>Received By</th>
                                <th className={`numeric ${styles.detailQtyColumn}`}>Qty</th>
                                <th className="numeric">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.history.map((historyItem, historyIndex) => (
                                <tr key={historyItem.id}>
                                  <td>{historyIndex + 1}</td>
                                  <td>{historyItem.projectNo}</td>
                                  <td>{historyItem.receiveDate}</td>
                                  <td>{historyItem.prNo}</td>
                                  <td>{historyItem.receivedByName}</td>
                                  <td className={`numeric ${styles.detailQtyColumn}`}>
                                    {historyItem.qty.toLocaleString()}
                                  </td>
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
                  colSpan={5 + projectQtyColumns.length}
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
