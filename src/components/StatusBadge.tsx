import type { DispatchRecordStatus, ReceivingRequestStatus, StockStatus } from '../types/models';
import styles from './StatusBadge.module.css';

interface StatusBadgeProps {
  status: StockStatus | DispatchRecordStatus | ReceivingRequestStatus;
}

function formatStatusLabel(status: StatusBadgeProps['status']) {
  if (status === 'pending') return 'Pending';
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'cancelled') return 'Cancelled';
  return status;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const className =
    status === 'Pending Dispatch' || status === 'Pending Receipt' || status === 'pending'
      ? styles.pending
      : status === 'In Transit'
        ? styles.transit
        : styles.received;

  return <span className={`${styles.badge} ${className}`}>{formatStatusLabel(status)}</span>;
}
