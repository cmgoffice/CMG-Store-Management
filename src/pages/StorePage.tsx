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
  const activeStoreLocations = useMemo(
    () => ['Store Center', activeProjectNo ? `Store ${activeProjectNo}` : ''].filter(Boolean),
    [activeProjectNo]
  );

  const storeItems = useMemo(() => {
    return stockItems.filter(
      (item) =>
        activeStoreLocations.includes(item.location) &&
        item.purchasedForProject === `Project ${activeProjectNo}`,
    );
  }, [activeProjectNo, activeStoreLocations, stockItems]);

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
        eyebrow="Project Store"
        title="Store Inventory"
        description={
          activeProjectNo
            ? `Detailed list of items currently held in the store of Project ${activeProjectNo}, including central stock and received dispatches.`
            : 'Detailed list of items currently held in the active project store.'
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
          detail="Total value of items in the active project store"
          tone="purple"
        />
        <StatCard
          label="Total Quantity"
          value={totalQty.toLocaleString()}
          detail="Total units of items in the active project store"
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
              <th>Store Location</th>
              <th>Vendor Name</th>
              <th>Item Summary</th>
              <th className="numeric">QTY</th>
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
                <td>{item.location}</td>
                <td>{item.vendorName}</td>
                <td>
                  <span className="itemSummaryCompact">
                    <strong>{item.itemDescription}</strong>
                    <span className="itemCodeCompact">
                      ({item.itemNo})
                    </span>
                  </span>
                </td>
                <td className="numeric">{item.qty.toLocaleString()}</td>
                <td>
                  <StatusBadge status={item.status} />
                </td>
                <td className="numeric">{item.amount.toLocaleString()}</td>
              </tr>
            ))}
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-on-surface-variant)' }}>
                  No items in the active project store match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
