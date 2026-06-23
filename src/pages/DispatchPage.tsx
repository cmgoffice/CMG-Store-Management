import { CheckCircle2, ImagePlus, PackageCheck, Send, Truck, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import '../styles/tables.css';
import styles from './DispatchPage.module.css';

type DispatchTab = 'dispatch' | 'log';

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function createDefaultQuantityMap(receiveNos: string[]) {
  return receiveNos.reduce<Record<string, string>>((acc, receiveNo) => {
    acc[receiveNo] = '';
    return acc;
  }, {});
}

export function DispatchPage() {
  const {
    projects,
    activeProjects,
    stockItems,
    dispatchRecords,
    createDispatch,
    receiveDispatch,
    activeProjectNo,
  } = useInventory();
  const { canDispatch } = useRole();
  const [activeTab, setActiveTab] = useState<DispatchTab>('dispatch');
  const [query, setQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [transport, setTransport] = useState('');
  const [note, setNote] = useState('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const [dispatchQuantities, setDispatchQuantities] = useState<Record<string, string>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receivingDispatchId, setReceivingDispatchId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');

  const normalizedQuery = query.trim().toLowerCase();
  const activeProject = activeProjects.find((project) => project.projectNo === activeProjectNo)
    ?? projects.find((project) => project.projectNo === activeProjectNo);
  const destinationProjects = useMemo(
    () => activeProjects.filter((project) => project.projectNo !== activeProjectNo),
    [activeProjectNo, activeProjects]
  );

  useEffect(() => {
    if (!selectedProject || selectedProject === activeProjectNo) {
      setSelectedProject(destinationProjects[0]?.projectNo ?? '');
    }
  }, [activeProjectNo, destinationProjects, selectedProject]);

  const dispatchableItems = useMemo(() => {
    return stockItems.filter((item) => {
      const isReadyForDispatch =
        item.status === 'Pending Dispatch' &&
        item.location === 'Store Center' &&
        item.purchasedForProject === `Project ${activeProjectNo}`;
      const matchesQuery =
        !normalizedQuery ||
        [
          item.receiveNo,
          item.prNo,
          item.itemDescription,
          item.vendorName,
          item.purchasedForProject,
          item.itemNo,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      return isReadyForDispatch && matchesQuery;
    });
  }, [activeProjectNo, normalizedQuery, stockItems]);

  const pendingReceipts = useMemo(() => {
    return dispatchRecords.filter((record) => {
      const isRelatedToActiveProject =
        record.sourceProjectNo === activeProjectNo || record.destinationProjectNo === activeProjectNo;
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
      return isRelatedToActiveProject && record.status === 'Pending Receipt' && matchesQuery;
    });
  }, [activeProjectNo, dispatchRecords, normalizedQuery]);

  const receivedDispatches = useMemo(() => {
    return dispatchRecords.filter((record) => {
      const isRelatedToActiveProject =
        record.sourceProjectNo === activeProjectNo || record.destinationProjectNo === activeProjectNo;
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
          record.receivedByName,
          ...record.items.map((item) => `${item.receiveNo} ${item.prNo} ${item.itemDescription}`),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      return isRelatedToActiveProject && record.status === 'Received at Site' && matchesQuery;
    });
  }, [activeProjectNo, dispatchRecords, normalizedQuery]);

  const selectedDraftItems = useMemo(() => {
    return dispatchableItems
      .map((item) => ({
        item,
        qty: Number(dispatchQuantities[item.receiveNo] || 0),
      }))
      .filter(({ qty }) => Number.isFinite(qty) && qty > 0);
  }, [dispatchQuantities, dispatchableItems]);

  const selectedQtyTotal = useMemo(() => {
    return selectedDraftItems.reduce((sum, item) => sum + item.qty, 0);
  }, [selectedDraftItems]);

  const resetModalState = () => {
    photoUrls.forEach((url) => URL.revokeObjectURL(url));
    setTransport('');
    setNote('');
    setPhotoFiles([]);
    setPhotoUrls([]);
    setPhotoNames([]);
    setUploadError('');
    setDispatchQuantities(createDefaultQuantityMap(dispatchableItems.map((item) => item.receiveNo)));
    setSelectedProject(destinationProjects[0]?.projectNo ?? '');
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetModalState();
  };

  const handleOpenModal = () => {
    if (!canDispatch || dispatchableItems.length === 0) {
      return;
    }

    resetModalState();
    setIsModalOpen(true);
  };

  const handleQtyChange = (receiveNo: string, value: string) => {
    if (value !== '' && !/^\d+$/.test(value)) {
      return;
    }

    setDispatchQuantities((current) => ({
      ...current,
      [receiveNo]: value,
    }));
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
    if (!activeProjectNo || !selectedProject || !selectedDraftItems.length || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await createDispatch({
        sourceProjectNo: activeProjectNo,
        items: selectedDraftItems.map(({ item, qty }) => ({
          receiveNo: item.receiveNo,
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
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReceiveDispatch = async (dispatchId: string) => {
    if (receivingDispatchId) {
      return;
    }

    setReceivingDispatchId(dispatchId);
    try {
      await receiveDispatch(dispatchId);
    } catch (error) {
      console.error('Failed to receive dispatch:', error);
    } finally {
      setReceivingDispatchId(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Store"
        title="Dispatch"
        description={
          activeProject
            ? `Dispatch stock from Store of Project ${activeProject.projectNo} and receive incoming requests for the same active project.`
            : 'Dispatch stock between project stores and review completed dispatch history.'
        }
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={activeTab === 'dispatch' ? 'Search store stock or pending dispatches' : 'Search dispatch history'}
            />
            {activeTab === 'dispatch' ? (
              <button
                className={styles.primaryButton}
                type="button"
                disabled={!canDispatch || dispatchableItems.length === 0}
                onClick={handleOpenModal}
              >
                <Send size={16} />
                <span>Dispatch Selected</span>
              </button>
            ) : null}
          </>
        }
      />

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'dispatch' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('dispatch')}
        >
          Dispatch
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'log' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('log')}
        >
          Log Dispatch
        </button>
      </div>

      {!canDispatch && activeTab === 'dispatch' ? (
        <div className={styles.notice}>
          Dispatch creation is available for Store Center only, but every role can still receive items for the active destination project.
        </div>
      ) : null}

      {activeTab === 'dispatch' ? (
        <>
          <div className={styles.summaryGrid}>
            <article className={styles.summaryCard}>
              <div className={styles.summaryIcon}>
                <PackageCheck size={18} />
              </div>
              <div>
                <div className={styles.summaryLabel}>Ready in Active Store</div>
                <div className={styles.summaryValue}>{dispatchableItems.length}</div>
              </div>
            </article>
            <article className={styles.summaryCard}>
              <div className={styles.summaryIcon}>
                <Truck size={18} />
              </div>
              <div>
                <div className={styles.summaryLabel}>Waiting Receipt</div>
                <div className={styles.summaryValue}>{pendingReceipts.length}</div>
              </div>
            </article>
            <article className={styles.summaryCard}>
              <div className={styles.summaryIcon}>
                <CheckCircle2 size={18} />
              </div>
              <div>
                <div className={styles.summaryLabel}>Logged Dispatch</div>
                <div className={styles.summaryValue}>{receivedDispatches.length}</div>
              </div>
            </article>
          </div>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Store Items of Active Project</h2>
                <p>
                  {activeProject
                    ? `Only items in Store Center for Project ${activeProject.projectNo} are available to dispatch.`
                    : 'Select an active project from the mini sidebar to start dispatching.'}
                </p>
              </div>
              <div className={styles.selectionNote}>
                Active: {activeProject?.projectNo ?? '-'}
              </div>
            </div>

            <div className="tableScroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Receive No.</th>
                    <th>PR No.</th>
                    <th>Purchased For</th>
                    <th>Current Location</th>
                    <th>Vendor Name</th>
                    <th>Item Summary</th>
                    <th className="numeric">Available Qty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatchableItems.map((item) => (
                    <tr key={item.receiveNo}>
                      <td>{item.receiveNo}</td>
                      <td>{item.prNo}</td>
                      <td>{item.purchasedForProject}</td>
                      <td>{item.location}</td>
                      <td>{item.vendorName}</td>
                      <td>
                        <span className="itemSummary">
                          <strong>{item.itemDescription}</strong>
                          <span className="itemCode">{item.itemNo}</span>
                        </span>
                      </td>
                      <td className="numeric">{item.qty.toLocaleString()}</td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                    </tr>
                  ))}
                  {dispatchableItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className={styles.empty}>
                        No stock items in the active project store matched the current search.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Waiting for Receipt</h2>
                <p>Dispatch requests remain here until the destination project receives them into its store.</p>
              </div>
            </div>

            <div className="tableScroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Dispatch No.</th>
                    <th>Route</th>
                    <th>Dispatched At</th>
                    <th>Vehicle Plate</th>
                    <th>Items</th>
                    <th>Attachment</th>
                    <th>Sent By</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingReceipts.map((record) => {
                    const canReceiveForActiveProject = record.destinationProjectNo === activeProjectNo;
                    const sourceProjectNo = record.sourceProjectNo || '-';
                    const sourceProjectName = record.sourceProjectName || 'Unknown source project';

                    return (
                      <tr key={record.id}>
                        <td>
                          <span className={styles.dispatchCode}>{record.dispatchNo}</span>
                        </td>
                        <td>
                          <div className={styles.projectCell}>
                            <strong>
                              {sourceProjectNo} to {record.destinationProjectNo}
                            </strong>
                            <span>
                              {sourceProjectName} to {record.destinationProjectName}
                            </span>
                          </div>
                        </td>
                        <td>{formatDateTime(record.dispatchedAt)}</td>
                        <td>{record.transport || '-'}</td>
                        <td>
                          <div className={styles.itemStack}>
                            {record.items.map((item) => (
                              <span key={`${record.id}-${item.stockReceiveNo}`} className={styles.itemChip}>
                                {item.receiveNo} / {item.itemDescription} / Qty {item.qty}
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
                            <span className={styles.mutedText}>No photo</span>
                          )}
                        </td>
                        <td>{record.dispatchedByName}</td>
                        <td>
                          <StatusBadge status={record.status} />
                        </td>
                        <td>
                          {canReceiveForActiveProject ? (
                            <button
                              className={styles.secondaryButton}
                              type="button"
                              disabled={receivingDispatchId !== null}
                              onClick={() => handleReceiveDispatch(record.id)}
                            >
                              {receivingDispatchId === record.id ? (
                                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <CheckCircle2 size={16} />
                              )}
                              <span>{receivingDispatchId === record.id ? 'Receiving...' : 'Receive'}</span>
                            </button>
                          ) : (
                            <span className={styles.mutedText}>Waiting for destination project</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {pendingReceipts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className={styles.empty}>
                        No dispatch records are waiting for receipt in this active project view.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Dispatch History</h2>
              <p>Once the destination project receives a request, it is moved here automatically.</p>
            </div>
          </div>

          <div className="tableScroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Dispatch No.</th>
                  <th>Route</th>
                  <th>Item Summary</th>
                  <th>Sent By</th>
                  <th>Dispatched At</th>
                  <th>Received By</th>
                  <th>Received At</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {receivedDispatches.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <span className={styles.dispatchCode}>{record.dispatchNo}</span>
                    </td>
                    <td>
                      <div className={styles.projectCell}>
                        <strong>
                          {record.sourceProjectNo || '-'} to {record.destinationProjectNo}
                        </strong>
                        <span>
                          {record.sourceProjectName || 'Unknown source project'} to {record.destinationProjectName}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.itemStack}>
                        {record.items.map((item) => (
                          <span key={`${record.id}-${item.stockReceiveNo}`} className={styles.itemChip}>
                            {item.receiveNo} / {item.itemDescription} / Qty {item.qty}
                          </span>
                        ))}
                        {record.transport ? <span className={styles.noteText}>Vehicle Plate: {record.transport}</span> : null}
                        {record.note ? <span className={styles.noteText}>Note: {record.note}</span> : null}
                      </div>
                    </td>
                    <td>{record.dispatchedByName}</td>
                    <td>{formatDateTime(record.dispatchedAt)}</td>
                    <td>{record.receivedByName || '-'}</td>
                    <td>{formatDateTime(record.receivedAt)}</td>
                    <td>
                      <StatusBadge status={record.status} />
                    </td>
                  </tr>
                ))}
                {receivedDispatches.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.empty}>
                      No completed dispatch history matched the current search.
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
                <h3>Create Dispatch Record</h3>
                <p>Select store items from the active project, set quantities, then choose the destination project.</p>
              </div>
              <button type="button" className={styles.iconButton} onClick={closeModal} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalInfo}>
                <span>Source Project</span>
                <strong>{activeProject ? `Project ${activeProject.projectNo} - ${activeProject.projectName}` : '-'}</strong>
              </div>

              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Destination Project</span>
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
                </label>

                <label className={styles.field}>
                  <span>Vehicle Registration</span>
                  <input
                    className={styles.input}
                    type="text"
                    value={transport}
                    onChange={(event) => setTransport(event.target.value)}
                    placeholder="Truck plate or transport registration"
                  />
                </label>
              </div>

              <div className={styles.field}>
                <span>Select Items and Quantity</span>
                <div className={styles.dispatchPicker}>
                  <div className={styles.dispatchPickerHead}>
                    <span>Receive No.</span>
                    <span>Item</span>
                    <span>Available</span>
                    <span>Dispatch Qty</span>
                  </div>
                  <div className={styles.dispatchPickerBody}>
                    {dispatchableItems.map((item) => (
                      <div key={item.receiveNo} className={styles.dispatchPickerRow}>
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
                          value={dispatchQuantities[item.receiveNo] ?? ''}
                          onChange={(event) => handleQtyChange(item.receiveNo, event.target.value)}
                          placeholder="0"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <label className={styles.field}>
                <span>Remark / Note</span>
                <textarea
                  className={styles.textarea}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Add handling note, urgent request, or delivery instruction"
                  rows={4}
                />
              </label>

              <div className={styles.field}>
                <span>Product Photos</span>
                <label className={styles.uploadBox}>
                  <input type="file" accept="image/*" multiple onChange={handleFileChange} />
                  <ImagePlus size={18} />
                  <div>
                    <strong>Upload to Firebase Storage</strong>
                    <p>Attach up to 5 product or vehicle photos for this dispatch.</p>
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

              <div className={styles.selectedPanel}>
                <div className={styles.selectedHeader}>
                  <strong>Selected for Dispatch</strong>
                  <span>{selectedDraftItems.length} row(s)</span>
                  <span>Total Qty {selectedQtyTotal.toLocaleString()}</span>
                </div>
                <div className={styles.selectedList}>
                  {selectedDraftItems.map(({ item, qty }) => (
                    <div key={item.receiveNo} className={styles.selectedRow}>
                      <span>{item.receiveNo}</span>
                      <span>{item.itemDescription}</span>
                      <span>Qty {Math.min(qty, item.qty)}</span>
                    </div>
                  ))}
                  {selectedDraftItems.length === 0 ? (
                    <div className={styles.helperText}>Enter dispatch quantity for at least one item.</div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className={styles.ghostButton} onClick={closeModal} disabled={isSubmitting}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!selectedProject || selectedDraftItems.length === 0 || isSubmitting}
                onClick={handleDispatchSubmit}
              >
                {isSubmitting ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                <span>{isSubmitting ? 'Saving...' : 'Dispatch'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
