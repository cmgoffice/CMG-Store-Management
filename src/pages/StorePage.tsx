import { PackagePlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import type { StockItem } from '../types/models';
import '../styles/tables.css';
import styles from './StockListPage.module.css'; // Reusing standard stock select & button layout styles

export function StorePage() {
  const { stockItems, receiveNewItem, activeProjectNo } = useInventory();
  const { canReceiveStock, isReadOnly } = useRole();
  const [query, setQuery] = useState('');

  // Filter items that are currently located in the central store ("Store Center") and belong to the active project
  const storeItems = useMemo(() => {
    return stockItems.filter(
      (item) => item.location === 'Store Center' && item.purchasedForProject.includes(activeProjectNo),
    );
  }, [stockItems, activeProjectNo]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return storeItems;
    }

    return storeItems.filter((item) => {
      return [
        item.receiveDate,
        item.receiveNo,
        item.prNo,
        item.poNo,
        item.purchasedForProject,
        item.vendorName,
        item.itemDescription,
        item.itemNo,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [query, storeItems]);

  // Compute metrics for the items in Store Center
  const stockValue = useMemo(() => {
    return filteredItems.reduce((sum, item) => sum + item.amount, 0);
  }, [filteredItems]);

  const totalQty = useMemo(() => {
    return filteredItems.reduce((sum, item) => sum + item.qty, 0);
  }, [filteredItems]);

  const [isSubmitting, setIsSubmitting] = useState(false);

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
      purchasedForProject: activeProjectNo ? `Project ${activeProjectNo}` : 'Project J74',
      receiveName: 'Narin Store',
      receiveDate: `2026-06-22-${sequence}`,
      status: 'Pending Dispatch',
    };

    try {
      await receiveNewItem(newItem);
    } catch (error) {
      console.error('Failed to receive item:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Central Store"
        title="Store Inventory"
        description={
          activeProjectNo
            ? `Detailed list of stock items held in central Store Center warehouse for Project ${activeProjectNo}.`
            : 'Detailed list of stock items held in the central Store Center warehouse.'
        }
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search store items"
            />
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

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '20px',
          marginBottom: '24px',
        }}
      >
        <StatCard
          label="Stock Value in Store"
          value={`${stockValue.toLocaleString()} THB`}
          detail="Total value of items in Store Center"
          tone="purple"
        />
        <StatCard
          label="Total Quantity"
          value={totalQty.toLocaleString()}
          detail="Total units of items in Store Center"
          tone="pink"
        />
        <StatCard
          label="Available Lines"
          value={filteredItems.length}
          detail="Distinct inventory line items"
          tone="blue"
        />
      </section>

      <div className="tableScroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>Date-Sequence</th>
              <th>PR No.</th>
              <th>Purchased For Project</th>
              <th>Vendor Name</th>
              <th>Item Summary</th>
              <th>Status</th>
              <th className="numeric">Amount</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.receiveNo}>
                <td>{item.receiveDate}</td>
                <td>{item.prNo}</td>
                <td>{item.purchasedForProject}</td>
                <td>{item.vendorName}</td>
                <td>
                  <span className="itemSummaryCompact">
                    <strong>{item.itemDescription}</strong>
                    <span className="itemCodeCompact">
                      ({item.itemNo} / Qty {item.qty})
                    </span>
                  </span>
                </td>
                <td>
                  <StatusBadge status={item.status} />
                </td>
                <td className="numeric">{item.amount.toLocaleString()}</td>
              </tr>
            ))}
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-on-surface-variant)' }}>
                  No items in Store Center match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
