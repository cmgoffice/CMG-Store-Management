import { CheckCircle2, ClipboardList, History, PackageCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import type { DispatchRecord, ReceivingRequest } from '../types/models';
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

function formatBadgeCount(count: number) {
  return count > 99 ? '99+' : String(count);
}

function joinItemDescriptions(items: ReceivingRequest['items']) {
  return items
    .map((item) => item.itemDescription?.trim() || '-')
    .join(', ');
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
    receivingRequests,
    dispatchRecords,
    approveReceivingRequest,
    receiveDispatch,
    activeProjectNo,
  } = useInventory();
  const { canApproveReceipt } = useRole();
  const [activeTab, setActiveTab] = useState<ReceivingTab>('receive');
  const [query, setQuery] = useState('');
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [approvingIncomingDispatchId, setApprovingIncomingDispatchId] = useState<string | null>(null);
  const [selectedIncomingDispatch, setSelectedIncomingDispatch] = useState<DispatchRecord | null>(null);
  const [receivingIncomingDispatch, setReceivingIncomingDispatch] = useState<DispatchRecord | null>(null);
  const [incomingReceiveQtyDraft, setIncomingReceiveQtyDraft] = useState<Record<string, string>>({});
  const [incomingReceiveError, setIncomingReceiveError] = useState('');

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

  const pendingRequestGroups = useMemo(
    () => createProjectGroups(pendingRequests, getRequestProjectCode),
    [pendingRequests],
  );
  const incomingDispatchGroups = useMemo(
    () => createProjectGroups(incomingDispatches, getDispatchDestinationProjectCode),
    [incomingDispatches],
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
              <h2>Pending Project Transfers</h2>
              <p>Dispatch requests sent to the active project are waiting here before they are received into the project store.</p>
            </div>
            <div className={styles.selectionNote}>Active: {activeProject?.projectNo ?? '-'}</div>
          </div>

          {incomingDispatchGroups.length === 0 ? (
            <div className={styles.empty}>No pending project transfer requests matched the current filters.</div>
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
                        className={styles.clickableRow}
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
                <table className={`table compact ${styles.receivingTable} ${styles.historyTable}`}>
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
                        <td className={`${styles.descriptionCell} ${styles.historyDescriptionCell}`}>
                          {joinItemDescriptions(request.items)}
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
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </section>
      )}

      {selectedIncomingDispatch && !receivingIncomingDispatch ? (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modal} ${styles.detailModal}`}>
            <div className={styles.modalHeader}>
              <div>
                <h3>Dispatch Details</h3>
                <p>Review all transferred items before receiving them into the destination project.</p>
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
                <h3>Receive Dispatch</h3>
                <p>Enter the actual received qty for each item. Default values match the dispatched qty.</p>
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
    </div>
  );
}
