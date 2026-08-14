import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { useInventory } from '../context/InventoryContext';
import { useRole } from '../context/RoleContext';
import { getStockItemId } from '../utils/stockItem';
import '../styles/tables.css';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
  const { stockItems, projects } = useInventory();
  const { roleLabel, canDispatch, canApproveReceipt, hasAnyRole } = useRole();
  const canViewStock = hasAnyRole(['MasterAdmin', 'Store Center']);

  const pending = stockItems.filter((item) => item.status === 'Pending Dispatch');
  const inTransit = stockItems.filter((item) => item.status === 'In Transit');
  const received = stockItems.filter((item) => item.status === 'Received at Site');
  const stockValue = stockItems.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div>
      <PageHeader
        eyebrow={`บทบาท: ${roleLabel}`}
        title="แดชบอร์ด"
        description="ภาพรวมสินค้าคงคลังส่วนกลาง การจัดส่ง และการรับสินค้าหน้างาน"
        actions={
          <>
            {canDispatch ? (
              <Link className={styles.primaryAction} to="/store/dispatch">
                จัดส่งไปยังหน้างาน
              </Link>
            ) : null}
            {canApproveReceipt ? (
              <Link className={styles.secondaryAction} to="/receiving">
                ตรวจสอบการรับสินค้า
              </Link>
            ) : null}
          </>
        }
      />

      <section className={styles.stats}>
        <StatCard label="มูลค่าสินค้าคงคลัง" value={stockValue.toLocaleString()} detail="มูลค่าสินค้า (บาท)" tone="pink" />
        <StatCard label="รอดำเนินการ" value={pending.length} detail="คลังกลาง" tone="purple" />
        <StatCard label="กำลังขนส่ง" value={inTransit.length} detail="ไปยังหน้างานโครงการ" tone="green" />
        <StatCard label="รับแล้ว" value={received.length} detail={`${projects.length} โครงการที่ใช้งานอยู่`} tone="yellow" />
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>ความเคลื่อนไหวสินค้าล่าสุด</h2>
            {canViewStock && (
              <Link to="/store/stock">ดูสินค้าคงคลัง</Link>
            )}
          </div>
          <div className="tableScroll">
            <table className="table">
              <thead>
                <tr>
                  <th>วันที่-ลำดับ</th><th>เลขที่ PR</th><th>โครงการ</th><th>สถานที่</th><th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {stockItems.slice(0, 5).map((item) => (
                  <tr key={getStockItemId(item)}>
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
            <h2>สิทธิ์ตามบทบาท</h2>
          </div>
          <div className={styles.permissions}>
            <div>
              <strong>Store Center</strong>
              <span>รับสินค้า ดูสินค้าคงคลังทั้งหมด และจัดส่งไปยังหน้างานโครงการ</span>
            </div>
            <div>
              <strong>ผู้ดูแลหน้างาน / คลังโครงการ</strong>
              <span>ตรวจสอบสินค้าระหว่างขนส่งและอนุมัติการรับสินค้าหน้างาน</span>
            </div>
            <div>
              <strong>Keeper</strong>
              <span>ตรวจสอบสินค้าคงคลังได้อย่างเดียว โดยไม่สามารถดำเนินการได้</span>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
