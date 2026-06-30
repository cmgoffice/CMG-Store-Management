import { CheckCircle2, ClipboardList, History, PackageCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import type { ReceivingRequest, StockItem } from '../types/models';
import { getStockItemId } from '../utils/stockItem';
import '../styles/tables.css';
import styles from './ReceivingPage.module.css';

type ReceivingTab = 'receive' | 'incoming' | 'log';

type ProjectGroup<T> = {
  projectCode: string;
  items: T[];
};

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

function joinItemDescriptions(items: ReceivingRequest['items']) {
  return items
    .map((item) => item.itemDescription?.trim() || '-')
    .join(', ');
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

function getStockItemProjectCode(item: StockItem) {
  return normalizeProjectNoText(
    item.cmgProjectCode ||
      item.projectId ||
      item.purchasedForProject ||
      item.location,
  );
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
    approveReceipt,
    approveReceivingRequest,
    activeProjectNo,
  } = useInventory();
  const { canApproveReceipt } = useRole();
  const [activeTab, setActiveTab] = useState<ReceivingTab>('receive');
  const [query, setQuery] = useState('');
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [approvingIncomingItemId, setApprovingIncomingItemId] = useState<string | null>(null);

  const activeProject = activeProjects.find((project) => project.projectNo === activeProjectNo)
    ?? projects.find((project) => project.projectNo === activeProjectNo);
  const normalizedActiveProjectNo = normalizeProjectNoText(activeProjectNo);
  const normalizedQuery = query.trim().toLowerCase();

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
  const incomingItems = useMemo(() => {
    return stockItems.filter((item) => {
      const cmgProjectCode = getStockItemProjectCode(item);
      const isForActiveProject =
        !normalizedActiveProjectNo ||
        cmgProjectCode === normalizedActiveProjectNo;
      const matchesQuery =
        !normalizedQuery ||
        [
          item.receiveNo,
          item.prNo,
          item.poNo,
          item.itemNo,
          item.itemDescription,
          item.vendorName,
          item.purchasedForProject,
          item.location,
          item.cmgProjectCode,
          item.projectId,
          cmgProjectCode,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      return item.status === 'In Transit' && isForActiveProject && matchesQuery;
    });
  }, [normalizedActiveProjectNo, normalizedQuery, stockItems]);

  const pendingRequestGroups = useMemo(
    () => createProjectGroups(pendingRequests, getRequestProjectCode),
    [pendingRequests],
  );
  const incomingItemGroups = useMemo(
    () => createProjectGroups(incomingItems, getStockItemProjectCode),
    [incomingItems],
  );
  const approvedRequestGroups = useMemo(
    () => createProjectGroups(approvedRequests, getRequestProjectCode),
    [approvedRequests],
  );

  const handleApprove = async (requestId: string) => {
    if (approvingRequestId) return;
    setApprovingRequestId(requestId);
    try {
      await approveReceivingRequest(requestId);
    } catch (error) {
      console.error('Failed to receive request into inventory:', error);
    } finally {
      setApprovingRequestId(null);
    }
  };

  const handleApproveIncoming = async (stockItemId: string) => {
    if (approvingIncomingItemId) return;
    setApprovingIncomingItemId(stockItemId);
    try {
      await approveReceipt(stockItemId);
    } catch (error) {
      console.error('Failed to approve incoming item:', error);
    } finally {
      setApprovingIncomingItemId(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Store"
        title="Receiving"
        description={
          activeProject
            ? `Review receiving requests for Project ${activeProject.projectNo} and approve them into inventory.`
            : 'Review incoming receiving requests from the external PR, PO system.'
        }
        actions={(
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={
              activeTab === 'log'
                ? 'Search receive log, PR, CMG project code'
                : 'Search receive no, PR, vendor, CMG project code'
            }
          />
        )}
      />

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'receive' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('receive')}
        >
          Receive
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'incoming' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('incoming')}
        >
          Incoming Items
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'log' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('log')}
        >
          Log Receive
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
                <div className={styles.summaryLabel}>Pending Requests</div>
                <div className={styles.summaryValue}>{pendingRequests.length}</div>
              </div>
            </article>
            <article className={styles.summaryCard}>
              <div className={styles.summaryIcon}>
                <PackageCheck size={18} />
              </div>
              <div>
                <div className={styles.summaryLabel}>Pending Qty</div>
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
                <div className={styles.summaryLabel}>Logged Receives</div>
                <div className={styles.summaryValue}>{approvedRequests.length}</div>
              </div>
            </article>
          </div>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Pending Receiving Requests</h2>
                <p>Requests are now grouped by CMG project code before inventory is created.</p>
              </div>
              <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
            </div>

            {pendingRequestGroups.length === 0 ? (
              <div className={styles.empty}>No pending receiving requests matched the current filters.</div>
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
                        <th>Vendor</th>
                        <th>Description</th>
                        <th className="numeric">Qty</th>
                        <th className="numeric">Amount</th>
                        <th>Requested</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((request, index) => (
                        <tr key={request.id}>
                          <td>{index + 1}</td>
                          <td>
                            <span className={styles.receiveCode}>{request.id}</span>
                          </td>
                          <td>{request.prNo || '-'}</td>
                          <td>{request.vendorName || '-'}</td>
                          <td className={styles.descriptionCell}>{joinItemDescriptions(request.items)}</td>
                          <td className="numeric">{request.totalQty.toLocaleString()}</td>
                          <td className="numeric">{formatAmount(request.totalAmount)}</td>
                          <td>{formatDateTime(request.requestedAt)}</td>
                          <td>
                            <StatusBadge status={request.requestStatus} />
                          </td>
                          <td>
                            <button
                              className={styles.approveButton}
                              type="button"
                              disabled={!canApproveReceipt || approvingRequestId !== null || request.items.length === 0}
                              onClick={() => handleApprove(request.id)}
                            >
                              {approvingRequestId === request.id ? (
                                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <CheckCircle2 size={16} />
                              )}
                              <span>{approvingRequestId === request.id ? 'Receiving...' : 'Receive into Inventory'}</span>
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
        </>
      ) : activeTab === 'incoming' ? (
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Approve Incoming Items</h2>
              <p>In-transit items are grouped by CMG project code before site receipt is confirmed.</p>
            </div>
            <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
          </div>

          {incomingItemGroups.length === 0 ? (
            <div className={styles.empty}>No incoming in-transit items matched the current filters.</div>
          ) : incomingItemGroups.map((group) => (
            <section key={group.projectCode} className={styles.projectGroup}>
              <div className={styles.projectGroupHeader}>
                <div>
                  <div className={styles.projectCodeBadge}>CMG Project Code: {group.projectCode}</div>
                  <div className={styles.groupMeta}>
                    {group.items.length} item(s) / {group.items.reduce((sum, item) => sum + item.qty, 0).toLocaleString()} qty
                  </div>
                </div>
              </div>

              <div className="tableScroll">
                  <table className={`table compact ${styles.receivingTable}`}>
                  <thead>
                    <tr>
                      <th>Date-Sequence</th>
                      <th>PR No.</th>
                      <th>Purchased For Project</th>
                      <th>Current Location</th>
                      <th>Vendor Name</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => {
                      const stockItemId = getStockItemId(item);

                      return (
                        <tr key={stockItemId}>
                          <td>{item.receiveDate}</td>
                          <td>{item.prNo}</td>
                          <td>{item.purchasedForProject}</td>
                          <td>{item.location}</td>
                          <td>{item.vendorName}</td>
                          <td className={styles.descriptionCell}>{item.itemDescription || '-'}</td>
                          <td>
                            <StatusBadge status={item.status} />
                          </td>
                          <td>
                            <button
                              className={styles.approveButton}
                              type="button"
                              disabled={!canApproveReceipt || approvingIncomingItemId !== null}
                              onClick={() => handleApproveIncoming(stockItemId)}
                            >
                              {approvingIncomingItemId === stockItemId ? (
                                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <CheckCircle2 size={16} />
                              )}
                              <span>{approvingIncomingItemId === stockItemId ? 'Approving...' : 'Approve Receipt'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
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
              <h2>Receive History</h2>
              <p>Approved requests stay grouped by CMG project code for easier project review.</p>
            </div>
            <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
          </div>

          {approvedRequestGroups.length === 0 ? (
            <div className={styles.empty}>No receive history matched the current filters.</div>
          ) : approvedRequestGroups.map((group) => (
            <section key={group.projectCode} className={styles.projectGroup}>
              <div className={styles.projectGroupHeader}>
                <div>
                  <div className={styles.projectCodeBadge}>CMG Project Code: {group.projectCode}</div>
                  <div className={styles.groupMeta}>{group.items.length} approved request(s)</div>
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
                      <th>Receive Name</th>
                      <th>Approved By</th>
                      <th>Approved At</th>
                      <th>Stock Receive Nos.</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((request, index) => (
                      <tr key={request.id}>
                        <td>{index + 1}</td>
                        <td>
                          <span className={styles.receiveCode}>{request.id}</span>
                        </td>
                        <td>{request.prNo || '-'}</td>
                        <td className={styles.descriptionCell}>{joinItemDescriptions(request.items)}</td>
                        <td>{request.receiveName || '-'}</td>
                        <td>{request.approvedByName || '-'}</td>
                        <td>{formatDateTime(request.approvedAt)}</td>
                        <td>
                          <div className={styles.itemStack}>
                            {(request.stockReceiveNos ?? []).map((receiveNo) => (
                              <span key={`${request.id}-${receiveNo}`} className={styles.stockChip}>
                                {receiveNo}
                              </span>
                            ))}
                            {(request.stockReceiveNos ?? []).length === 0 ? <span className={styles.noteText}>-</span> : null}
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={request.requestStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </section>
      )}
    </div>
  );
}
