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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function DispatchPage() {
  const {
    projects,
    stockItems,
    dispatchRecords,
    createDispatch,
    receiveDispatch,
  } = useInventory();
  const { canApproveReceipt, canDispatch, activeRole } = useRole();
  const [activeTab, setActiveTab] = useState<DispatchTab>('dispatch');
  const [query, setQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [transport, setTransport] = useState('');
  const [note, setNote] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receivingDispatchId, setReceivingDispatchId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    if (!selectedProject && projects.length > 0) {
      setSelectedProject(projects[0].projectNo);
    }
  }, [projects, selectedProject]);

  const normalizedQuery = query.trim().toLowerCase();

  const dispatchableItems = useMemo(() => {
    return stockItems.filter((item) => {
      const isPending = item.status === 'Pending Dispatch';
      const matchesQuery =
        !normalizedQuery ||
        [item.receiveNo, item.prNo, item.itemDescription, item.vendorName, item.purchasedForProject]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      return isPending && matchesQuery;
    });
  }, [normalizedQuery, stockItems]);

  const pendingReceipts = useMemo(() => {
    return dispatchRecords.filter((record) => {
      const matchesQuery =
        !normalizedQuery ||
        [
          record.dispatchNo,
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
      return record.status === 'Pending Receipt' && matchesQuery;
    });
  }, [dispatchRecords, normalizedQuery]);

  const receivedDispatches = useMemo(() => {
    return dispatchRecords.filter((record) => {
      const matchesQuery =
        !normalizedQuery ||
        [
          record.dispatchNo,
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
      return record.status === 'Received at Site' && matchesQuery;
    });
  }, [dispatchRecords, normalizedQuery]);

  const selectedStockItems = useMemo(() => {
    return stockItems.filter((item) => selectedItems.includes(item.receiveNo));
  }, [selectedItems, stockItems]);

  const toggleItem = (receiveNo: string) => {
    setSelectedItems((current) =>
      current.includes(receiveNo)
        ? current.filter((item) => item !== receiveNo)
        : [...current, receiveNo]
    );
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setTransport('');
    setNote('');
    setPhotoUrls([]);
    setPhotoNames([]);
    setUploadError('');
  };

  const handleOpenModal = () => {
    if (!canDispatch || selectedItems.length === 0) {
      return;
    }
    setIsModalOpen(true);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }

    setUploadError('');

    try {
      const nextUrls = await Promise.all(files.map((file) => readFileAsDataUrl(file)));
      setPhotoUrls((current) => [...current, ...nextUrls].slice(0, 5));
      setPhotoNames((current) => [...current, ...files.map((file) => file.name)].slice(0, 5));
    } catch (error) {
      console.error('Failed to load image attachments:', error);
      setUploadError('Unable to attach one or more images. Please try again.');
    } finally {
      event.target.value = '';
    }
  };

  const removePhoto = (index: number) => {
    setPhotoUrls((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setPhotoNames((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleDispatchSubmit = async () => {
    if (!selectedItems.length || !selectedProject || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await createDispatch({
        receiveNos: selectedItems,
        projectNo: selectedProject,
        transport,
        note,
        photoUrls,
      });
      setSelectedItems([]);
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
        description="Create transfer documents, track project receipts, and review completed dispatch history."
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={activeTab === 'dispatch' ? 'Search stock or pending receipts' : 'Search dispatch history'}
            />
            {activeTab === 'dispatch' ? (
              <button
                className={styles.primaryButton}
                type="button"
                disabled={!canDispatch || selectedItems.length === 0}
                onClick={handleOpenModal}
              >
                <Send size={16} />
                <span>Dispatch Selected ({selectedItems.length})</span>
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
          Dispatch to Site
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
          Current role is <strong>{activeRole}</strong>. Dispatch creation is available only for Store Center.
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
                <div className={styles.summaryLabel}>Ready to Dispatch</div>
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
                <div className={styles.summaryLabel}>Completed Dispatch</div>
                <div className={styles.summaryValue}>{receivedDispatches.length}</div>
              </div>
            </article>
          </div>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Available Stock for Dispatch</h2>
                <p>Select items that will be moved from the store to a project site.</p>
              </div>
              <div className={styles.selectionNote}>
                {selectedItems.length} item(s) selected
              </div>
            </div>

            <div className="tableScroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Date-Sequence</th>
                    <th>PR No.</th>
                    <th>Purchased For Project</th>
                    <th>Current Location</th>
                    <th>Vendor Name</th>
                    <th>Item Summary</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatchableItems.map((item) => (
                    <tr key={item.receiveNo}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedItems.includes(item.receiveNo)}
                          disabled={!canDispatch}
                          onChange={() => toggleItem(item.receiveNo)}
                          aria-label={`Select ${item.itemDescription}`}
                        />
                      </td>
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
                    </tr>
                  ))}
                  {dispatchableItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className={styles.empty}>
                        No stock items are ready for dispatch with the current search.
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
                <h2>Waiting for Site Receipt</h2>
                <p>Dispatch records will stay here until the destination project confirms receipt.</p>
              </div>
            </div>

            <div className="tableScroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Dispatch No.</th>
                    <th>Destination</th>
                    <th>Dispatched At</th>
                    <th>Transport</th>
                    <th>Items</th>
                    <th>Attachment</th>
                    <th>Sent By</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingReceipts.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <span className={styles.dispatchCode}>{record.dispatchNo}</span>
                      </td>
                      <td>
                        <div className={styles.projectCell}>
                          <strong>Project {record.destinationProjectNo}</strong>
                          <span>{record.destinationProjectName}</span>
                        </div>
                      </td>
                      <td>{formatDateTime(record.dispatchedAt)}</td>
                      <td>{record.transport || '-'}</td>
                      <td>
                        <div className={styles.itemStack}>
                          {record.items.map((item) => (
                            <span key={item.receiveNo} className={styles.itemChip}>
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
                        {canApproveReceipt ? (
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
                            <span>
                              {receivingDispatchId === record.id ? 'Receiving...' : 'Receive'}
                            </span>
                          </button>
                        ) : (
                          <span className={styles.mutedText}>Awaiting site team</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {pendingReceipts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className={styles.empty}>
                        No dispatch records are waiting for receipt.
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
              <p>Track who sent goods, when they were dispatched, and when the receiving project confirmed them.</p>
            </div>
          </div>

          <div className="tableScroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Dispatch No.</th>
                  <th>Destination</th>
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
                        <strong>Project {record.destinationProjectNo}</strong>
                        <span>{record.destinationProjectName}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.itemStack}>
                        {record.items.map((item) => (
                          <span key={item.receiveNo} className={styles.itemChip}>
                            {item.receiveNo} / {item.itemDescription} / Qty {item.qty}
                          </span>
                        ))}
                        {record.transport ? <span className={styles.noteText}>Transport: {record.transport}</span> : null}
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
                <p>Choose the destination project and add transport details before sending.</p>
              </div>
              <button type="button" className={styles.iconButton} onClick={closeModal} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Destination Project</span>
                  <select
                    className={styles.select}
                    value={selectedProject}
                    onChange={(event) => setSelectedProject(event.target.value)}
                  >
                    {projects.map((project) => (
                      <option key={project.projectNo} value={project.projectNo}>
                        Project {project.projectNo} - {project.projectName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span>Transport</span>
                  <input
                    className={styles.input}
                    type="text"
                    value={transport}
                    onChange={(event) => setTransport(event.target.value)}
                    placeholder="Truck, vendor, courier, or driver name"
                  />
                </label>
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
                <span>Dispatch Photos</span>
                <label className={styles.uploadBox}>
                  <input type="file" accept="image/*" multiple onChange={handleFileChange} />
                  <ImagePlus size={18} />
                  <div>
                    <strong>Upload photo evidence</strong>
                    <p>Attach up to 5 images of loading, packaging, or the vehicle.</p>
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
                  <strong>Selected Items</strong>
                  <span>{selectedStockItems.length} row(s)</span>
                </div>
                <div className={styles.selectedList}>
                  {selectedStockItems.map((item) => (
                    <div key={item.receiveNo} className={styles.selectedRow}>
                      <span>{item.receiveNo}</span>
                      <span>{item.itemDescription}</span>
                      <span>Qty {item.qty}</span>
                    </div>
                  ))}
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
                disabled={!selectedProject || selectedStockItems.length === 0 || isSubmitting}
                onClick={handleDispatchSubmit}
              >
                {isSubmitting ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                <span>{isSubmitting ? 'Saving...' : 'Create Dispatch'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
