import { CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import '../styles/tables.css';
import styles from './ReceivingPage.module.css';

export function ReceivingPage() {
  const { stockItems, approveReceipt } = useInventory();
  const { activeRole, canApproveReceipt } = useRole();
  const [query, setQuery] = useState('');
  const [approvingItemNo, setApprovingItemNo] = useState<string | null>(null);

  const inTransitItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return stockItems.filter((item) => {
      const isInTransit = item.status === 'In Transit';
      const matchesQuery =
        !normalized ||
        [item.receiveNo, item.prNo, item.itemDescription, item.location, item.purchasedForProject]
          .join(' ')
          .toLowerCase()
          .includes(normalized);
      return isInTransit && matchesQuery;
    });
  }, [query, stockItems]);

  const handleApprove = async (receiveNo: string) => {
    if (approvingItemNo) return;
    setApprovingItemNo(receiveNo);
    try {
      await approveReceipt(receiveNo);
    } catch (error) {
      console.error('Failed to approve receipt:', error);
    } finally {
      setApprovingItemNo(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Site Receiving"
        title="Approve Incoming Items"
        description="Review in-transit goods and confirm receipt at the destination project site."
        actions={
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search incoming items"
          />
        }
      />

      {!canApproveReceipt ? (
        <div className={styles.notice}>
          Current role is <strong>{activeRole}</strong>. Receipt approval is available for Admin Site and Store Site.
        </div>
      ) : null}

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
            {inTransitItems.map((item) => (
              <tr key={item.receiveNo}>
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
                    disabled={!canApproveReceipt || approvingItemNo !== null}
                    onClick={() => handleApprove(item.receiveNo)}
                  >
                    {approvingItemNo === item.receiveNo ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />
                    ) : (
                      <CheckCircle2 size={16} />
                    )}
                    <span>{approvingItemNo === item.receiveNo ? 'Approving...' : 'Approve Receipt'}</span>
                  </button>
                </td>
              </tr>
            ))}
            {inTransitItems.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  No in-transit items matched the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
