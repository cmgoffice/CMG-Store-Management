import { PackagePlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SearchField } from '../components/SearchField';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import type { StockItem } from '../types/models';
import '../styles/tables.css';
import styles from './StockListPage.module.css';

type InventoryAvailability = 'Available' | 'Unavailable';

export function StockListPage() {
  const { stockItems, activeProjects, receiveNewItem } = useInventory();
  const { canReceiveStock, isReadOnly } = useRole();
  const [query, setQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getProjectHeldQty = (item: StockItem, projectNo: string) => {
    const projectLocations = new Set([`Project ${projectNo}`, `Store ${projectNo}`]);
    const isHeldByProject =
      item.status === 'Received at Site' && projectLocations.has(item.location.trim());

    return isHeldByProject ? item.qty : 0;
  };

  const getAvailability = (item: StockItem): InventoryAvailability =>
    activeProjects.some((project) => getProjectHeldQty(item, project.projectNo) > 0)
      ? 'Available'
      : 'Unavailable';

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return stockItems.filter((item) => {
      const matchesQuery =
        !normalized ||
        [
          item.receiveDate,
          item.receiveNo,
          item.prNo,
          item.poNo,
          item.purchasedForProject,
          item.location,
          item.vendorName,
          item.itemDescription,
          item.itemNo,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalized);

      return matchesQuery;
    });
  }, [query, stockItems]);

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
              <th>Date-Sequence</th>
              <th>PR No.</th>
              <th>Purchased For Project</th>
              <th>Current Location</th>
              <th>Vendor Name</th>
              <th>Item Summary</th>
              {activeProjects.map((project) => (
                <th key={project.projectNo} className="numeric">
                  {project.projectNo} Qty
                </th>
              ))}
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
                      ({item.itemNo} / Qty {item.qty})
                    </span>
                  </span>
                </td>
                {activeProjects.map((project) => {
                  const heldQty = getProjectHeldQty(item, project.projectNo);

                  return (
                    <td
                      key={`${item.receiveNo}-${project.projectNo}`}
                      className={`numeric ${heldQty === 0 ? 'muted' : ''}`}
                    >
                      {heldQty === 0 ? '-' : heldQty.toLocaleString()}
                    </td>
                  );
                })}
                <td>
                  <span
                    className={`${styles.availabilityBadge} ${
                      getAvailability(item) === 'Available'
                        ? styles.available
                        : styles.unavailable
                    }`}
                  >
                    {getAvailability(item)}
                  </span>
                </td>
                <td className="numeric">{item.amount.toLocaleString()}</td>
              </tr>
            ))}
            {filteredItems.length === 0 && (
              <tr>
                <td
                  colSpan={8 + activeProjects.length}
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
