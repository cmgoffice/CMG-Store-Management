import type {
  DispatchRecordStatus,
  ReceivingRequestStatus,
  StockStatus,
  WithdrawRecordStatus,
} from '../types/models';
import styles from './StatusBadge.module.css';

interface StatusBadgeProps {
  status: StockStatus | DispatchRecordStatus | ReceivingRequestStatus | WithdrawRecordStatus;
}

function formatStatusLabel(status: StatusBadgeProps['status']) {
  const labels: Record<string, string> = {
    pending: 'รอดำเนินการ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิกแล้ว',
    'Pending Dispatch': 'รอจัดส่ง', 'Pending Receipt': 'รอรับเข้า', 'In Transit': 'กำลังขนส่ง',
    'Received at Site': 'รับเข้าหน้างานแล้ว', 'Waiting Return': 'รอคืน', Borrowed: 'ยืมมา',
    Overdue: 'เกินกำหนด', Issued: 'เบิกจ่ายแล้ว', Withdrawn: 'เบิกแล้ว', Returned: 'คืนแล้ว', Cancelled: 'ยกเลิกการเบิก', 'Dispatch Cancelled': 'ยกเลิกการจัดส่ง',
  };
  return labels[status] ?? status;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const className =
    status === 'Pending Dispatch' ||
    status === 'Pending Receipt' ||
    status === 'Waiting Return' ||
    status === 'pending'
      ? styles.pending
      : status === 'In Transit' || status === 'Borrowed'
        ? styles.transit
        : status === 'Overdue'
          ? styles.overdue
          : status === 'Issued' || status === 'Withdrawn' || status === 'Cancelled'
            ? styles.neutral
            : styles.received;

  return <span className={`${styles.badge} ${className}`}>{formatStatusLabel(status)}</span>;
}
