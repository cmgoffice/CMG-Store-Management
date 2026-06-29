import { CheckCircle2, ClipboardList, History, PackageCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import { getStockItemId } from '../utils/stockItem';
import '../styles/tables.css';
import styles from './ReceivingPage.module.css';

type ReceivingTab = 'receive' | 'incoming' | 'log';

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

function normalizeProjectNoText(value: string) {
  const projectMatch = value.trim().match(/\bJ[-\s]?0*(\d+)\b/i);
  return projectMatch ? `J${Number(projectMatch[1])}` : value.trim();
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
  const normalizedQuery = query.trim().toLowerCase();

  const filteredRequests = useMemo(() => {
    return receivingRequests.filter((request) => {
      const isForActiveProject =
        !activeProjectNo ||
        normalizeProjectNoText(request.projectNo) === normalizeProjectNoText(activeProjectNo);
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
          ...request.items.map((item) => `${item.itemNo} ${item.itemDescription} ${item.materialNo ?? ''}`),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      return isForActiveProject && matchesQuery;
    });
  }, [activeProjectNo, normalizedQuery, receivingRequests]);

  const pendingRequests = useMemo(
    () => filteredRequests.filter((request) => request.requestStatus === 'pending'),
    [filteredRequests]
  );
  const approvedRequests = useMemo(
    () => filteredRequests.filter((request) => request.requestStatus === 'approved'),
    [filteredRequests]
  );
  const incomingItems = useMemo(() => {
    return stockItems.filter((item) => {
      const itemProjectText = `${item.purchasedForProject} ${item.location}`;
      const isForActiveProject =
        !activeProjectNo ||
        normalizeProjectNoText(itemProjectText) === normalizeProjectNoText(activeProjectNo);
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
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      return item.status === 'In Transit' && isForActiveProject && matchesQuery;
    });
  }, [activeProjectNo, normalizedQuery, stockItems]);

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
        actions={
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={activeTab === 'log' ? 'Search receive log' : 'Search receiving items'}
          />
        }
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
                <p>Requests sent by the external PR, PO system wait here before inventory is created.</p>
              </div>
              <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
            </div>

            <div className="tableScroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Receive No.</th>
                    <th>PO / PR</th>
                    <th>Project</th>
                    <th>Vendor</th>
                    <th>Items</th>
                    <th className="numeric">Qty</th>
                    <th className="numeric">Amount</th>
                    <th>Requested</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRequests.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <span className={styles.receiveCode}>{request.receiveNo}</span>
                      </td>
                      <td>
                        <div className={styles.metaStack}>
                          <strong>{request.poNo || '-'}</strong>
                          <span>{request.prNo || '-'}</span>
                        </div>
                      </td>
                      <td>
                        <div className={styles.metaStack}>
                          <strong>{request.projectNo || '-'}</strong>
                          <span>{request.projectName || request.location || '-'}</span>
                        </div>
                      </td>
                      <td>{request.vendorName || '-'}</td>
                      <td>
                        <div className={styles.itemStack}>
                          {request.items.map((item, index) => (
                            <span key={`${request.id}-${item.itemNo}-${index}`} className={styles.itemChip}>
                              {item.itemNo} / {item.itemDescription || '-'} / Qty {item.receivedQty.toLocaleString()}
                              {item.unit ? ` ${item.unit}` : ''}
                            </span>
                          ))}
                          {request.note ? <span className={styles.noteText}>Note: {request.note}</span> : null}
                        </div>
                      </td>
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
                  {pendingRequests.length === 0 ? (
                    <tr>
                      <td colSpan={10} className={styles.empty}>
                        No pending receiving requests matched the current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : activeTab === 'incoming' ? (
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Approve Incoming Items</h2>
              <p>In-transit stock lines, including PR PO receive payloads, wait here before site receipt is confirmed.</p>
            </div>
            <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
          </div>

          <div className="tableScroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date-Sequence</th>
                  <th>PR No.</th>
                  <th>Purchased For Project</th>
                  <th>Current Location</th>
                  <th>Vendor Name</th>
                  <th>Item Summary</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {incomingItems.map((item) => {
                  const stockItemId = getStockItemId(item);

                  return (
                    <tr key={stockItemId}>
                      <td>{item.receiveDate}</td>
                      <td>{item.prNo}</td>
                      <td>{item.purchasedForProject}</td>
                      <td>{item.location}</td>
                      <td>{item.vendorName}</td>
                      <td>
                        <span className="itemSummary">
                          <strong>{item.itemDescription}</strong>
                          <span className="itemCode">
                            {item.itemNo} / Qty {item.qty}
                          </span>
                        </span>
                      </td>
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
                {incomingItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.empty}>
                      No incoming in-transit items matched the current filters.
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
              <h2>Receive History</h2>
              <p>Approved requests stay here as receive history after stock items are created.</p>
            </div>
            <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
          </div>

          <div className="tableScroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Receive No.</th>
                  <th>PO / PR</th>
                  <th>Project</th>
                  <th>Item Summary</th>
                  <th>Receive Name</th>
                  <th>Approved By</th>
                  <th>Approved At</th>
                  <th>Stock Receive Nos.</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {approvedRequests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <span className={styles.receiveCode}>{request.receiveNo}</span>
                    </td>
                    <td>
                      <div className={styles.metaStack}>
                        <strong>{request.poNo || '-'}</strong>
                        <span>{request.prNo || '-'}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.metaStack}>
                        <strong>{request.projectNo || '-'}</strong>
                        <span>{request.projectName || request.location || '-'}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.itemStack}>
                        {request.items.map((item, index) => (
                          <span key={`${request.id}-log-${item.itemNo}-${index}`} className={styles.itemChip}>
                            {item.itemNo} / {item.itemDescription || '-'} / Qty {item.receivedQty.toLocaleString()}
                          </span>
                        ))}
                      </div>
                    </td>
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
                {approvedRequests.length === 0 ? (
                  <tr>
                    <td colSpan={9} className={styles.empty}>
                      No receive history matched the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
