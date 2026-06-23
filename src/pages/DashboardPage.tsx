import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import '../styles/tables.css';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
  const { stockItems, projects } = useInventory();
  const { activeRole, canDispatch, canApproveReceipt } = useRole();

  const pending = stockItems.filter((item) => item.status === 'Pending Dispatch');
  const inTransit = stockItems.filter((item) => item.status === 'In Transit');
  const received = stockItems.filter((item) => item.status === 'Received at Site');
  const stockValue = stockItems.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div>
      <PageHeader
        eyebrow={`Active role: ${activeRole}`}
        title="Dashboard"
        description="Overview of central store inventory, dispatched goods, and site receiving activity."
        actions={
          <>
            {canDispatch ? (
              <Link className={styles.primaryAction} to="/store/dispatch">
                Dispatch to Site
              </Link>
            ) : null}
            {canApproveReceipt ? (
              <Link className={styles.secondaryAction} to="/receiving">
                Review Receipts
              </Link>
            ) : null}
          </>
        }
      />

      <section className={styles.stats}>
        <StatCard label="Stock Value" value={stockValue.toLocaleString()} detail="THB inventory" tone="pink" />
        <StatCard label="Pending" value={pending.length} detail="Store Center" tone="purple" />
        <StatCard label="In Transit" value={inTransit.length} detail="To project sites" tone="green" />
        <StatCard label="Received" value={received.length} detail={`${projects.length} active projects`} tone="yellow" />
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Recent Stock Movement</h2>
            {['MasterAdmin', 'SuperAdmin', 'Admin', 'Store Center'].includes(activeRole) && (
              <Link to="/store/stock">View stock</Link>
            )}
          </div>
          <div className="tableScroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date-Sequence</th>
                  <th>PR No.</th>
                  <th>Project</th>
                  <th>Location</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stockItems.slice(0, 5).map((item) => (
                  <tr key={item.receiveNo}>
                    <td>{item.receiveDate}</td>
                    <td>{item.prNo}</td>
                    <td>{item.purchasedForProject}</td>
                    <td>{item.location}</td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Role Permissions</h2>
          </div>
          <div className={styles.permissions}>
            <div>
              <strong>Store Center</strong>
              <span>Receive stock, view all inventory, dispatch to project sites.</span>
            </div>
            <div>
              <strong>Admin Site / Store Site</strong>
              <span>Review incoming in-transit items and approve site receipt.</span>
            </div>
            <div>
              <strong>Keeper</strong>
              <span>Read-only inventory checking with actions disabled.</span>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
